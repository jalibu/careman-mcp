// Session Manager
// Handles login, token caching, and employeeId resolution.
// All CareMan API endpoints are undocumented and were reverse-engineered
// by observing network traffic in the browser.

const LOGIN_ENDPOINT = "/api/-/auth/login";
const INITIAL_PRELOAD_ENDPOINT = "/api/-/app/initial-preload";
const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 1 min before expiry
const DEFAULT_TIMEOUT_MS = 15_000;
const NETWORK_RETRIES = 2;
const AUTH_RETRIES = 1;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return asSeconds * 1000;
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
  }
  return 300 * (attempt + 1);
}

function toErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "request timed out";
  }
  return error?.message || String(error);
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) return "";
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "";
  }
}

function decodeJwtExp(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    const obj = JSON.parse(json);
    // CareMan JWT uses string timestamps (seconds)
    return obj.exp ? Number(obj.exp) * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchResilient(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= NETWORK_RETRIES) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      const shouldRetryStatus =
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599);

      if (shouldRetryStatus && attempt < NETWORK_RETRIES) {
        await delay(getRetryDelayMs(response, attempt));
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= NETWORK_RETRIES) {
        throw new Error(`Network error for ${url}: ${toErrorMessage(error)}`);
      }
      await delay(250 * (attempt + 1));
      attempt += 1;
    }
  }
  throw new Error(`Network error for ${url}: ${toErrorMessage(lastError)}`);
}

export class CareManSession {
  constructor({ baseUrl, username, password }) {
    if (!baseUrl || !username || !password) {
      throw new Error(
        "Missing required env vars: CAREMAN_URL, CAREMAN_USERNAME, CAREMAN_PASSWORD"
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.employeeId = null;
    this.authPromise = null;
  }

  async ensureAuth() {
    if (
      this.token &&
      this.employeeId &&
      Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return;
    }
    if (!this.authPromise) {
      this.authPromise = (async () => {
        await this._login();
        await this._loadEmployeeId();
      })().finally(() => {
        this.authPromise = null;
      });
    }
    await this.authPromise;
  }

  async _login() {
    // Request format reverse-engineered from the minified JS bundle:
    // postLoginUserNamePassword(e) → POST /api/-/auth/login with body {item1, item2}
    // where item1 = username, item2 = password (generic tuple wrapper used throughout the app).
    const res = await fetchResilient(`${this.baseUrl}${LOGIN_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item1: this.username, item2: this.password }),
    });

    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(
        `CareMan login failed (HTTP ${res.status}). ` +
          `Check CAREMAN_USERNAME and CAREMAN_PASSWORD. ` +
          `If credentials are correct, the login request format may have changed — ` +
          `verify POST /api/-/auth/login body via browser DevTools.` +
          (body ? ` Response snippet: ${body}` : "")
      );
    }

    const json = await res.json();

    // The response envelope is {data, text, type, isSuccess}.
    // Token location is inferred; check multiple plausible fields.
    const token =
      (typeof json.data === "string" && json.data) ||
      json.token ||
      json.accessToken ||
      json.data?.token ||
      json.data?.accessToken;

    if (!token || typeof token !== "string") {
      throw new Error(
        `CareMan login response did not contain a recognizable token. ` +
          `Raw response keys: ${Object.keys(json).join(", ")}. ` +
          `The response format may have changed — check browser DevTools for the actual token field.`
      );
    }

    this.token = token;
    this.tokenExpiresAt =
      decodeJwtExp(token) || Date.now() + 8 * 60 * 60 * 1000; // fallback: 8h
  }

  async _loadEmployeeId() {
    // POST /api/-/app/initial-preload returns contracts.data[0].dbId = employeeId.
    // This ID is required for team-duty/roster and rosters/preload calls.
      const res = await fetchResilient(
      `${this.baseUrl}${INITIAL_PRELOAD_ENDPOINT}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({}),
      }
    );

    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(
          `Failed to load employee ID (HTTP ${res.status}).` +
            (body ? ` Response snippet: ${body}` : "")
      );
    }

    const json = await res.json();
    const dbId = json?.contracts?.data?.[0]?.dbId;

    if (!dbId) {
      throw new Error(
        `Could not extract employeeId from initial-preload response. ` +
          `Available keys: ${Object.keys(json).join(", ")}`
      );
    }

    this.employeeId = dbId;
  }

  // Core HTTP helpers — always call ensureAuth() before using these.

  async get(path) {
    await this.ensureAuth();
    for (let attempt = 0; attempt <= AUTH_RETRIES; attempt += 1) {
      const res = await fetchResilient(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (res.status === 401 && attempt < AUTH_RETRIES) {
        await this._login();
        await this._loadEmployeeId();
        continue;
      }

      if (!res.ok) {
        const body = await readErrorBody(res);
        throw new Error(
          `GET ${path} failed (HTTP ${res.status}).` +
            (body ? ` Response snippet: ${body}` : "")
        );
      }

      return res.json();
    }

    throw new Error(`GET ${path} failed after auth retries.`);
  }

  async post(path, body) {
    await this.ensureAuth();
    for (let attempt = 0; attempt <= AUTH_RETRIES; attempt += 1) {
      const res = await fetchResilient(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 401 && attempt < AUTH_RETRIES) {
        await this._login();
        await this._loadEmployeeId();
        continue;
      }

      if (!res.ok) {
        const responseBody = await readErrorBody(res);
        throw new Error(
          `POST ${path} failed (HTTP ${res.status}).` +
            (responseBody ? ` Response snippet: ${responseBody}` : "")
        );
      }

      return res.json();
    }

    throw new Error(`POST ${path} failed after auth retries.`);
  }
}
