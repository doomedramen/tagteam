import { type LocalDate, localDate } from "./localDate";
import { expandSlots, type Slot, type TaskSchedule } from "./schedule";

export type TaskEvent =
	| { id: string; type: "completed"; at: number; occurrenceKey: LocalDate }
	| { id: string; type: "uncompleted"; at: number; refEventId: string }
	| { id: string; type: "nudged"; at: number };

type Completion = Extract<TaskEvent, { type: "completed" }>;

export type EntryStatus =
	| "on_time"
	| "late"
	| "missed"
	| "open"
	| "overdue"
	| "upcoming";

export interface HistoryEntry {
	key: LocalDate;
	dueAt: number;
	status: EntryStatus;
	completedAt?: number;
	completionId?: string;
	lateByMs?: number;
	/** For `missed`: the occurrence that was still open at the time. */
	blockedBy?: LocalDate;
}

export interface DerivedTask {
	/** Ascending by key. */
	entries: HistoryEntry[];
	/** The single open occurrence (`open`, `overdue` or `upcoming`), or null when nothing is left. */
	current: HistoryEntry | null;
	/** Occurrences that came due while `current` stayed open. */
	missedWhileOpen: number;
}

const missed = (slot: Slot, blockedBy?: LocalDate): HistoryEntry => ({
	key: slot.key,
	dueAt: slot.dueAt,
	status: "missed",
	...(blockedBy ? { blockedBy } : {}),
});

/** Derive a task's full history and current state. Pure: same inputs, same output. */
export function deriveTask(
	schedule: TaskSchedule,
	events: TaskEvent[],
	now: number,
): DerivedTask {
	const undone = new Set(
		events.flatMap((e) => (e.type === "uncompleted" ? [e.refEventId] : [])),
	);
	const completions = events
		.filter((e): e is Completion => e.type === "completed" && !undone.has(e.id))
		.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

	const until = Math.max(now, ...completions.map((c) => c.at));
	// Early completions can consume upcoming slots, so look ahead one per completion.
	const slots = expandSlots(schedule, until, completions.length + 1);

	const entries: HistoryEntry[] = [];
	const closed = new Set<LocalDate>();
	let open = 0;

	for (const c of completions) {
		const completedOn = localDate(c.at, schedule.timezone);
		const completedOnIndex = slots.findIndex(
			(slot) => slot.key === completedOn,
		);
		const targetKey =
			c.occurrenceKey < completedOn && completedOnIndex >= 0
				? completedOn
				: c.occurrenceKey;
		const requestedIndex = slots.findIndex((slot) => slot.key === targetKey);
		if (closed.has(targetKey)) continue;
		if (requestedIndex >= 0 && requestedIndex < open) continue;

		// A late action counts for a scheduled occurrence on its completion day.
		// Keep legacy or stale keys usable after a schedule edit by using current open slot.
		let targetIndex = requestedIndex >= 0 ? requestedIndex : open;
		const currentOpen = slots[open];
		// An early completion cannot skip an occurrence that is still in progress.
		if (targetIndex > open && currentOpen && currentOpen.dueAt > c.at)
			targetIndex = open;
		const slot = slots[targetIndex];
		if (!slot || closed.has(slot.key)) continue;

		const firstOpenKey = slots[open]?.key;
		for (let i = open; i < targetIndex; i++) {
			const skipped = slots[i];
			if (skipped)
				entries.push(missed(skipped, i === open ? undefined : firstOpenKey));
		}

		const entry: HistoryEntry = {
			key: slot.key,
			dueAt: slot.dueAt,
			status: c.at <= slot.dueAt ? "on_time" : "late",
			completedAt: c.at,
			completionId: c.id,
		};
		if (entry.status === "late") entry.lateByMs = c.at - slot.dueAt;
		entries.push(entry);
		closed.add(slot.key);

		let next = targetIndex + 1;
		for (let i = slots.length - 1; i > targetIndex; i--) {
			const later = slots[i];
			if (later && later.periodStart <= c.at) {
				next = i;
				break;
			}
		}
		for (let i = targetIndex + 1; i < next; i++) {
			const later = slots[i];
			if (later) entries.push(missed(later, slot.key));
		}
		open = next;
	}

	const slot = slots[open];
	if (!slot) return { entries, current: null, missedWhileOpen: 0 };

	const status: EntryStatus =
		slot.periodStart > now ? "upcoming" : now > slot.dueAt ? "overdue" : "open";
	const current: HistoryEntry = { key: slot.key, dueAt: slot.dueAt, status };
	const missedNow = slots
		.slice(open + 1)
		.filter((later) => later.dueAt <= now)
		.map((later) => missed(later, slot.key));

	return {
		entries: [...entries, current, ...missedNow],
		current,
		missedWhileOpen: missedNow.length,
	};
}
