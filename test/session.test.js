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
