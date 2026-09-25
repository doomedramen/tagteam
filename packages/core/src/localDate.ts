import { DateTime } from "luxon";

/** Calendar date in a task's timezone, `YYYY-MM-DD`. Sorts lexicographically. */
export type LocalDate = string;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Pure calendar arithmetic is done in UTC so it never sees DST.
const utc = (date: LocalDate) => DateTime.fromISO(date, { zone: "utc" });
const iso = (dt: DateTime): LocalDate => dt.toISODate() as LocalDate;

export const isLocalDate = (v: unknown): v is LocalDate =>
	typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && utc(v).isValid;

export const isTimeOfDay = (v: unknown): v is string =>
	typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const isTimeZone = (v: unknown): v is string =>
	typeof v === "string" && DateTime.now().setZone(v).isValid;

export const addDays = (date: LocalDate, days: number): LocalDate =>
	iso(utc(date).plus({ days }));

export const firstOfMonth = (date: LocalDate, monthsAhead = 0): LocalDate =>
	iso(utc(date).startOf("month").plus({ months: monthsAhead }));

export const weekdayOf = (date: LocalDate): Weekday =>
	utc(date).weekday as Weekday;

export const daysInMonth = (date: LocalDate): number =>
	utc(date).daysInMonth as number;

export const isoMonday = (date: LocalDate): LocalDate =>
	addDays(date, 1 - weekdayOf(date));

/** Epoch ms of midnight at the start of `date` in `zone`. */
export const startOfDay = (date: LocalDate, zone: string): number =>
	DateTime.fromISO(date, { zone }).startOf("day").toMillis();

/** Epoch ms of `date` at `time` (`HH:MM`) in `zone`. */
export const atTime = (date: LocalDate, time: string, zone: string): number =>
	DateTime.fromISO(`${date}T${time}`, { zone }).toMillis();
