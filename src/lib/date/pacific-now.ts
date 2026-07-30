/** Live Pacific clock for the chatbot system prompt (DBS shop timezone). */
export function pacificNowContext(now = new Date()): string {
  const timeZone = "America/Los_Angeles";

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(now);

  const dateLong = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(now);

  const isoDay = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // en-CA yields YYYY-MM-DD
  const [y, m, d] = isoDay.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = utcNoon.getUTCDay(); // 0 Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(utcNoon);
  monday.setUTCDate(utcNoon.getUTCDate() + mondayOffset);
  const weekStart = monday.toISOString().slice(0, 10);
  const monthStart = `${isoDay.slice(0, 8)}01`;

  return `## Current time (source of truth for "today" / "this week")
- Now: ${weekday}, ${dateLong}, ${time}
- Today (Pacific YYYY-MM-DD): ${isoDay}
- This week starts (Monday Pacific): ${weekStart}
- This month starts: ${monthStart}
- Shop timezone: America/Los_Angeles (Pacific).
- When the user says today / yesterday / this week / this month, resolve dates from this clock — do not invent a calendar.`;
}
