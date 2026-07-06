import test from "node:test";
import assert from "node:assert/strict";

import { berlinMidnightUTC, monthRange } from "../src/dates.js";

test("berlinMidnightUTC handles CEST correctly", () => {
  const iso = berlinMidnightUTC(2026, 7, 1).toISOString();
  assert.equal(iso, "2026-06-30T22:00:00.000Z");
});

test("berlinMidnightUTC handles CET correctly", () => {
  const iso = berlinMidnightUTC(2026, 11, 1).toISOString();
  assert.equal(iso, "2026-10-31T23:00:00.000Z");
});

test("monthRange returns DST-aware UTC boundaries", () => {
  const range = monthRange(2026, 7);
  assert.deepEqual(range, {
    from: "2026-06-30T22:00:00.000Z",
    to: "2026-07-30T22:00:00.000Z",
  });
});
