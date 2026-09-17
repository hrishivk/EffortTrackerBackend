// Date-only windows, shared by GET /task-list and the report routes so the two
// cannot answer the same question differently.
//
// DATE-ONLY, never a timestamp. daily_task_logs.date is a DATEONLY column, and
// a window sent as an ISO timestamp shifts by the caller's UTC offset: a
// browser in IST asking for 2026-09-01 sends 2026-08-31T18:30:00Z, and the
// report quietly gains a day at one end and loses one at the other. Comparing
// 'YYYY-MM-DD' strings against a DATEONLY column has no timezone in it at all,
// which is the same fix already applied to the task timestamps.
//
// Both ends are INCLUSIVE. from=2026-09-01&to=2026-09-15 is fifteen days of
// work, not fourteen — a half-open window reads as an off-by-one to everyone
// reading the report.

// The only accepted spelling. A bare `new Date(value)` would happily take
// "2026-09-01T00:00:00Z" and "Sep 1 2026", which is exactly the timezone
// ambiguity this module exists to keep out.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 366 days: a full year plus the leap day, so "this year so far" and "the last
// twelve months" both fit. Past that the grouped daily query starts returning
// more rows than any chart draws, and the zero-fill below allocates them all.
export const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: string;
  to: string;
  // Inclusive length. 2026-09-01..2026-09-15 is 15, and it is what sizes the
  // `previous` window.
  days: number;
}

// Raised for anything the caller can fix by sending different params. Carries
// its own name so the controllers answer 400 without matching on message text
// — the message is written to be shown to the user as-is.
export class DateRangeError extends Error {
  public readonly name = "DateRangeError";
}

// Parses one 'YYYY-MM-DD' into a UTC midnight Date, rejecting a well-formed
// string that is not a real day. The round-trip check is what catches
// 2026-02-30: Date.UTC rolls it forward to March 2 rather than failing.
const parseDateOnly = (value: string, label: string): Date => {
  const raw = String(value ?? "").trim();
  if (!DATE_ONLY.test(raw)) {
    throw new DateRangeError(
      `${label} must be a date in YYYY-MM-DD form, for example 2026-09-01`
    );
  }
  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DateRangeError(`${label} is not a real date`);
  }
  return parsed;
};

export const toDateOnly = (value: Date): string =>
  value.toISOString().slice(0, 10);

const shiftDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * MS_PER_DAY);

// The one place the §4 rules live: both ends date-only, `to` not before
// `from`, and the span capped. A `to` in the future is deliberately fine — it
// just returns what exists, which is what "this month" does on the 15th.
export const parseDateRange = (
  from: unknown,
  to: unknown,
  maxDays: number = MAX_RANGE_DAYS
): DateRange => {
  if (from === undefined || from === null || String(from).trim() === "") {
    throw new DateRangeError("from is required");
  }
  if (to === undefined || to === null || String(to).trim() === "") {
    throw new DateRangeError("to is required");
  }

  const start = parseDateOnly(String(from), "from");
  const end = parseDateOnly(String(to), "to");

  if (end.getTime() < start.getTime()) {
    throw new DateRangeError("to must not be earlier than from");
  }

  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (days > maxDays) {
    throw new DateRangeError(
      `The date range is too large: ${days} days were requested and the maximum is ${maxDays}. Please choose a shorter period.`
    );
  }

  return { from: toDateOnly(start), to: toDateOnly(end), days };
};

// The same-length window ending the day before `range` starts. 2026-09-01..15
// (15 days) gives 2026-08-17..2026-08-31 — what the "+12% vs previous period"
// figures compare against. Computed here rather than on the client so the two
// windows can never be sized by different rules.
export const previousRange = (range: DateRange): DateRange => {
  const start = parseDateOnly(range.from, "from");
  const end = shiftDays(start, -1);
  const previousStart = shiftDays(end, -(range.days - 1));
  return {
    from: toDateOnly(previousStart),
    to: toDateOnly(end),
    days: range.days,
  };
};

// Every date in the window, ascending. This is what turns the grouped query's
// sparse result into the dense `daily` array: a chart that skips a silent
// weekend draws a straight line across it and reports a week that never
// happened.
export const eachDate = (range: DateRange): string[] => {
  const start = parseDateOnly(range.from, "from");
  const out: string[] = [];
  for (let i = 0; i < range.days; i += 1) {
    out.push(toDateOnly(shiftDays(start, i)));
  }
  return out;
};

// Today in the server's own timezone, as a date-only string. Used for
// `today_seconds`, which has to line up with the DATEONLY values the daily
// logs are written with — toISOString() here would roll over at UTC midnight
// and report "today" as tomorrow for half the evening in IST.
export const todayDateOnly = (): string => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return toDateOnly(local);
};

// An optional single date, for the task-list route's older `?date=` param.
//
// Deliberately LOOSER than parseDateRange: that param has always accepted a
// full ISO string and the board still sends one, so the time part is dropped
// rather than rejected. Tightening it would break the board to no purpose —
// from/to are the new, strict spelling and nothing sends them yet.
export const parseOptionalDateOnly = (
  value: unknown,
  label: string
): string | undefined => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const [datePart] = String(value).trim().split("T");
  return toDateOnly(parseDateOnly(datePart, label));
};
