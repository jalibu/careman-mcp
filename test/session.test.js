import test from "node:test";
import assert from "node:assert/strict";

import { CareManSession } from "../src/session.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function textResponse(text, status = 500, headers = {}) {
  return new Response(text, {
    status,
    headers,
  });
}

function withMockedFetch(t, handler) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

test("ensureAuth performs a single shared auth flow for concurrent callers", async (t) => {
  let loginCalls = 0;
  let preloadCalls = 0;

  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login")) {
      loginCalls += 1;
      return jsonResponse({ data: "invalid.jwt.token" });
    }

    if (String(url).endsWith("/api/-/app/initial-preload")) {
      preloadCalls += 1;
      return jsonResponse({ contracts: { data: [{ dbId: 42 }] } });
    }

    return textResponse("unexpected url", 404);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  await Promise.all([session.ensureAuth(), session.ensureAuth(), session.ensureAuth()]);

  assert.equal(loginCalls, 1);
  assert.equal(preloadCalls, 1);
  assert.equal(session.employeeId, 42);
});

test("get retries once after 401 by re-authenticating", async (t) => {
  let loginCalls = 0;
  let preloadCalls = 0;
  let dataCalls = 0;

  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login")) {
      loginCalls += 1;
      return jsonResponse({ data: "invalid.jwt.token" });
    }

    if (String(url).endsWith("/api/-/app/initial-preload")) {
      preloadCalls += 1;
      return jsonResponse({ contracts: { data: [{ dbId: 7 }] } });
    }

    if (String(url).endsWith("/api/-/rosters/preload")) {
      dataCalls += 1;
      if (dataCalls === 1) {
        return textResponse("expired", 401);
      }
      return jsonResponse({ ok: true });
    }

    return textResponse("unexpected url", 404);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  const result = await session.get("/api/-/rosters/preload");

  assert.deepEqual(result, { ok: true });
  assert.equal(loginCalls, 2);
  assert.equal(preloadCalls, 2);
  assert.equal(dataCalls, 2);
});

test("CareManSession constructor throws when required config is missing", () => {
  assert.throws(
    () => new CareManSession({ baseUrl: "", username: "u", password: "p" }),
    /Missing required env vars/
  );
  assert.throws(
    () => new CareManSession({ baseUrl: "https://x", username: "", password: "p" }),
    /Missing required env vars/
  );
  assert.throws(
    () => new CareManSession({ baseUrl: "https://x", username: "u", password: "" }),
    /Missing required env vars/
  );
});

test("CareManSession strips trailing slash from baseUrl", () => {
  const session = new CareManSession({
    baseUrl: "https://careman.example/",
    username: "u",
    password: "p",
  });
  assert.equal(session.baseUrl, "https://careman.example");
});

test("login failure throws a descriptive error with HTTP status", async (t) => {
  withMockedFetch(t, async () => jsonResponse({ error: "bad credentials" }, 401));

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "wrong",
    password: "wrong",
  });

  await assert.rejects(
    () => session.ensureAuth(),
    /CareMan login failed \(HTTP 401\)/
  );
});

test("GET throws when server returns a non-401 error", async (t) => {
  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login"))
      return jsonResponse({ data: "invalid.jwt.token" });
    if (String(url).endsWith("/api/-/app/initial-preload"))
      return jsonResponse({ contracts: { data: [{ dbId: 1 }] } });
    return textResponse("forbidden", 403);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  await assert.rejects(
    () => session.get("/api/-/some-endpoint"),
    /HTTP 403/
  );
});

test("post retries once after 401 by re-authenticating", async (t) => {
  let loginCalls = 0;
  let dataCalls = 0;

  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login")) {
      loginCalls += 1;
      return jsonResponse({ data: "invalid.jwt.token" });
    }
    if (String(url).endsWith("/api/-/app/initial-preload"))
      return jsonResponse({ contracts: { data: [{ dbId: 5 }] } });
    if (String(url).endsWith("/api/-/some-data")) {
      dataCalls += 1;
      if (dataCalls === 1) return textResponse("expired", 401);
      return jsonResponse({ posted: true });
    }
    return textResponse("unexpected", 404);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  const result = await session.post("/api/-/some-data", { foo: "bar" });
  assert.deepEqual(result, { posted: true });
  assert.equal(loginCalls, 2);
  assert.equal(dataCalls, 2);
});

test("token is reused — no re-login for second ensureAuth call", async (t) => {
  let loginCalls = 0;

  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login")) {
      loginCalls += 1;
      // JWT with exp far in the future (year 2100 = Unix 4102444800)
      const payload = Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url");
      return jsonResponse({ data: `header.${payload}.sig` });
    }
    if (String(url).endsWith("/api/-/app/initial-preload"))
      return jsonResponse({ contracts: { data: [{ dbId: 99 }] } });
    return textResponse("unexpected", 404);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  await session.ensureAuth();
  await session.ensureAuth();

  assert.equal(loginCalls, 1, "should only login once when token is still valid");
});

test("post includes response snippet in thrown errors", async (t) => {
  withMockedFetch(t, async (url) => {
    if (String(url).endsWith("/api/-/auth/login")) {
      return jsonResponse({ data: "invalid.jwt.token" });
    }

    if (String(url).endsWith("/api/-/app/initial-preload")) {
      return jsonResponse({ contracts: { data: [{ dbId: 99 }] } });
    }

    if (String(url).endsWith("/api/-/team-duty/roster/99")) {
      return textResponse("backend exploded", 500);
    }

    return textResponse("unexpected url", 404);
  });

  const session = new CareManSession({
    baseUrl: "https://careman.example",
    username: "u",
    password: "p",
  });

  await assert.rejects(
    () => session.post("/api/-/team-duty/roster/99", { test: true }),
    (error) => {
      assert.match(String(error.message), /HTTP 500/);
      assert.match(String(error.message), /backend exploded/);
      return true;
    }
  );
});
