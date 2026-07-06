// Date helpers for CareMan API payloads.
//
// CareMan expects from/to as UTC timestamps that represent local midnight in
// Europe/Berlin. This requires DST-aware conversion.

export function berlinMidnightUTC(year, month /* 1-12 */, day) {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);

  const m = {};
  parts.forEach((p) => {
    m[p.type] = p.value;
  });

  const localAsUTC = new Date(
    Date.UTC(
      Number(m.year),
      Number(m.month) - 1,
      Number(m.day),
      Number(m.hour) === 24 ? 0 : Number(m.hour),
      Number(m.minute),
      Number(m.second)
    )
  );

  const offsetMs = localAsUTC - guess;
  return new Date(guess.getTime() - offsetMs);
}

export function monthRange(year, month /* 1-12 */) {
  const from = berlinMidnightUTC(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = berlinMidnightUTC(year, month, daysInMonth);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function currentAndNextMonth() {
  const now = new Date();
  const y1 = now.getFullYear();
  const m1 = now.getMonth() + 1;
  const next = new Date(y1, m1, 1);
  return [
    [y1, m1],
    [next.getFullYear(), next.getMonth() + 1],
  ];
}
