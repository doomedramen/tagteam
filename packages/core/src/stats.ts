import type { HistoryEntry } from "./derive";

export interface Summary {
	onTime: number;
	late: number;
	missed: number;
	/** onTime / (onTime + late + missed), or null when there is nothing to rate. */
	onTimeRate: number | null;
}

/** Counts occurrences with `from <= dueAt < to`. Open, overdue and upcoming are not counted. */
export function summarize(
	entries: HistoryEntry[],
	from: number,
	to: number,
): Summary {
	let onTime = 0;
	let late = 0;
	let missed = 0;
	for (const e of entries) {
		if (e.dueAt < from || e.dueAt >= to) continue;
		if (e.status === "on_time") onTime++;
		else if (e.status === "late") late++;
		else if (e.status === "missed") missed++;
	}
	const total = onTime + late + missed;
	return { onTime, late, missed, onTimeRate: total ? onTime / total : null };
}
