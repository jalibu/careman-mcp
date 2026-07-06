import test from "node:test";
import assert from "node:assert/strict";

import { berlinMidnightUTC, monthRange, currentAndNextMonth } from "../src/dates.js";

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

test("berlinMidnightUTC - January 1st (CET, year boundary)", () => {
  const iso = berlinMidnightUTC(2026, 1, 1).toISOString();
  assert.equal(iso, "2025-12-31T23:00:00.000Z");
});

test("monthRange - February non-leap year ends on day 28", () => {
  const { from, to } = monthRange(2026, 2);
  assert.equal(from, "2026-01-31T23:00:00.000Z");
  assert.equal(to, "2026-02-27T23:00:00.000Z");
});

test("monthRange - February leap year ends on day 29", () => {
  const { from, to } = monthRange(2024, 2);
  assert.equal(from, "2024-01-31T23:00:00.000Z");
  assert.equal(to, "2024-02-28T23:00:00.000Z");
});

test("monthRange - December ends on day 31 (CET)", () => {
  const { from, to } = monthRange(2026, 12);
  assert.equal(from, "2026-11-30T23:00:00.000Z");
  assert.equal(to, "2026-12-30T23:00:00.000Z");
});

test("monthRange - October spans DST transition (CEST → CET)", () => {
  // Oct 1 is CEST (UTC+2), Oct 31 is CET (UTC+1)
  const { from, to } = monthRange(2026, 10);
  assert.equal(from, "2026-09-30T22:00:00.000Z"); // CEST
  assert.equal(to, "2026-10-30T23:00:00.000Z");   // CET
});

test("currentAndNextMonth returns two consecutive [year, month] pairs", () => {
  const result = currentAndNextMonth();
  assert.equal(result.length, 2);
  const [[y1, m1], [y2, m2]] = result;
  assert.ok(y1 >= 2024, "year should be reasonable");
  assert.ok(m1 >= 1 && m1 <= 12, "current month in valid range");
  assert.ok(m2 >= 1 && m2 <= 12, "next month in valid range");
  if (m1 === 12) {
    assert.equal(m2, 1);
    assert.equal(y2, y1 + 1);
  } else {
    assert.equal(m2, m1 + 1);
    assert.equal(y2, y1);
  }
});
