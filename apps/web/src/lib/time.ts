import type { LocalDate } from "@tagteam/core";
import { useEffect, useState } from "react";

export const browserTimeZone = (): string =>
	Intl.DateTimeFormat().resolvedOptions().timeZone;

export function localDate(ms: number, tz = browserTimeZone()): LocalDate {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ms);
}

/** Local midnight today → local midnight tomorrow, in the browser's timezone. */
export function dayBounds(now: number): { start: number; end: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start: start.getTime(), end: end.getTime() };
}

export function formatTime(
	ms: number,
	opts: { tz?: string; locale?: string } = {},
): string {
	return new Intl.DateTimeFormat(opts.locale, {
		timeZone: opts.tz,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(ms);
}

export function formatWhen(
	ms: number,
	now: number,
	opts: { time?: boolean; tz?: string; locale?: string } = {},
): string {
	const tz = opts.tz ?? browserTimeZone();
	const days = Math.round(
		(Date.parse(localDate(ms, tz)) - Date.parse(localDate(now, tz))) /
			86_400_000,
	);
	const time = opts.time ? formatTime(ms, { tz, locale: opts.locale }) : "";
	const withTime = (label: string) => (time ? `${label} ${time}` : label);
	if (days === 0) return time || "Today";
	if (days === 1) return withTime("Tomorrow");
	if (days === -1) return withTime("Yesterday");
	if (Math.abs(days) < 7)
		return withTime(
			new Intl.DateTimeFormat(opts.locale, {
				timeZone: tz,
				weekday: "short",
			}).format(ms),
		);
	return withTime(
		new Intl.DateTimeFormat(opts.locale, {
			timeZone: tz,
			day: "numeric",
			month: "short",
		}).format(ms),
	);
}

/** Current time, refreshed every `intervalMs` so relative labels stay correct. */
export function useNow(intervalMs = 30_000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
}
