import { formatTime, formatWhen } from "../../lib/time";
import type { TodayRow } from "./model";

const relative = /^(Today|Tomorrow|Yesterday)/;
const inline = (label: string) =>
	label.replace(relative, (word) => word.toLowerCase());

export function rowLabel(
	row: TodayRow,
	now: number,
	opts: { tz?: string; locale?: string } = {},
): string {
	switch (row.kind) {
		case "overdue": {
			const since = row.timed
				? formatWhen(row.dueAt, now, { ...opts, time: true })
				: formatWhen(row.periodStart, now, opts);
			return `Since ${inline(since)}${row.missed > 0 ? ` · ${row.missed} missed` : ""}`;
		}
		case "open": {
			if (row.timed) {
				const when = formatWhen(row.dueAt, now, { ...opts, time: true });
				return /^\d/.test(when) ? `By ${when}` : `Due ${inline(when)}`;
			}
			const lastDay = formatWhen(row.dueAt - 1, now, opts);
			return lastDay === "Today" ? "Today" : `Due ${inline(lastDay)}`;
		}
		case "done":
			return `Done ${formatTime(row.completedAt ?? now, opts)}`;
		case "upcoming":
			return row.timed
				? formatWhen(row.dueAt, now, { ...opts, time: true })
				: formatWhen(row.periodStart, now, opts);
	}
}
