import {
	atTime,
	deriveTask,
	type EntryStatus,
	type EventDto,
	type HistoryEntry,
	type MemberDto,
	NUDGE_INTERVAL_MS,
	startOfDay,
	summarize,
	type TaskDto,
	type TaskEvent,
} from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	BellRing,
	CalendarDays,
	Check,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	Clock3,
	MoreHorizontal,
	Pencil,
	Undo2,
} from "lucide-react";
import { type TouchEvent, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { formatTime, formatWhen, localDate, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { AddTaskSheet } from "../add-task/AddTaskSheet";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = [
	{ key: "mon", label: "Mo" },
	{ key: "tue", label: "Tu" },
	{ key: "wed", label: "We" },
	{ key: "thu", label: "Th" },
	{ key: "fri", label: "Fr" },
	{ key: "sat", label: "Sa" },
	{ key: "sun", label: "Su" },
];

function formatDate(
	date: string,
	options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Intl.DateTimeFormat(undefined, {
		...options,
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function formatDuration(durationMs: number): string {
	const totalMinutes = Math.floor(Math.max(0, durationMs) / 60_000);
	const days = Math.floor(totalMinutes / (24 * 60));
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function formatStamp(at: number, timezone: string): string {
	return new Intl.DateTimeFormat(undefined, {
		timeZone: timezone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(at);
}

function ruleSummary(task: TaskDto, now: number): string {
	const today = localDate(now, task.timezone);
	const version = [...task.rules]
		.reverse()
		.find((item) => item.effectiveFrom <= today);
	if (!version) return `Since ${formatDate(task.startDate)}`;

	const rule = version.rule;
	let repeat = "Once";
	if (rule?.freq === "day")
		repeat = rule.interval === 1 ? "Daily" : `Every ${rule.interval} days`;
	if (rule?.freq === "week") {
		const days = [...rule.weekdays]
			.sort((a, b) => a - b)
			.map((day) =>
				new Intl.DateTimeFormat(undefined, {
					weekday: "short",
					timeZone: "UTC",
				}).format(Date.UTC(2024, 0, day)),
			)
			.join(", ");
		repeat = `${rule.interval === 1 ? "Weekly" : `Every ${rule.interval} weeks`} · ${days}`;
	}
	if (rule?.freq === "month") {
		const day = rule.monthDay === "last" ? "last day" : `day ${rule.monthDay}`;
		repeat = `${rule.interval === 1 ? "Monthly" : `Every ${rule.interval} months`} · ${day}`;
	}
	const due = version.dueTime
		? `by ${formatTime(atTime(today, version.dueTime, task.timezone), { tz: task.timezone })}`
		: null;
	return [repeat, due, `since ${formatDate(task.startDate)}`]
		.filter(Boolean)
		.join(" · ");
}

function monthShift(month: string, amount: number): string {
	const [year, index] = month.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1 + amount, 1))
		.toISOString()
		.slice(0, 7);
}

function monthCells(
	month: string,
): Array<{ date: string; day: number } | null> {
	const [year, monthNumber] = month.split("-").map(Number);
	const first = new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1));
	const leading = (first.getUTCDay() + 6) % 7;
	const count = new Date(
		Date.UTC(year ?? 1970, monthNumber ?? 1, 0),
	).getUTCDate();
	const cells = Math.ceil((leading + count) / 7) * 7;
	return Array.from({ length: cells }, (_, index) => {
		const day = index - leading + 1;
		if (day < 1 || day > count) return null;
		return {
			date: `${month}-${String(day).padStart(2, "0")}`,
			day,
		};
	});
}

function statusLabel(
	entry: HistoryEntry,
	now: number,
	timezone: string,
): string {
	switch (entry.status) {
		case "on_time":
			return `Done ${formatTime(entry.completedAt ?? entry.dueAt, { tz: timezone })}`;
		case "late":
			return `Done late · ${formatStamp(entry.completedAt ?? entry.dueAt, timezone)} (+${formatDuration(entry.lateByMs ?? 0)})`;
		case "missed":
			return `Missed · ${formatDate(entry.blockedBy ?? entry.key, { weekday: "short" })} still open`;
		case "overdue":
			return `Overdue · ${formatDuration(now - entry.dueAt)}`;
		case "open":
			return `Open · due ${formatTime(entry.dueAt, { tz: timezone })}`;
		case "upcoming":
			return `Upcoming · ${formatWhen(startOfDay(entry.key, timezone), now, { tz: timezone })}`;
	}
}

function StatusIcon({ status }: { status: EntryStatus }) {
	if (status === "on_time")
		return <Check aria-hidden className="size-4 text-success" />;
	if (status === "late")
		return <Clock3 aria-hidden className="size-4 text-warning" />;
	if (status === "missed" || status === "overdue")
		return <CircleAlert aria-hidden className="size-4 text-danger" />;
	return <CalendarDays aria-hidden className="size-4 text-text-3" />;
}

function calendarDotClass(status: EntryStatus): string {
	switch (status) {
		case "on_time":
			return "bg-success";
		case "late":
			return "bg-warning";
		case "missed":
			return "bg-danger";
		case "open":
			return "bg-surface border-2 border-dashed border-warning";
		case "overdue":
			return "bg-surface border-2 border-dashed border-danger";
		case "upcoming":
			return "bg-surface border-2 border-dashed border-text-3";
	}
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col rounded-2xl bg-surface px-3 py-3 ring-1 ring-line">
			<p className="text-[12px] font-medium text-text-2">{label}</p>
			<p className="mt-1 text-[20px] font-semibold tracking-tight">{value}</p>
		</div>
	);
}

function latestNudge(events: EventDto[], userId: string): number | null {
	return events.reduce<number | null>((latest, event) => {
		if (event.userId !== userId || event.type !== "nudged") return latest;
		return Math.max(latest ?? 0, event.at);
	}, null);
}

function nudgeLabel(at: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	return minutes < 1 ? "Nudged just now" : `Nudged ${minutes}m ago`;
}

export function TaskDetailScreen() {
	const { taskId } = useParams();
	const navigate = useNavigate();
	const { store, engine, me, activeGroupId } = useSession();
	const toast = useToast();
	const now = useNow();
	const [monthSelection, setMonthSelection] = useState<{
		taskId: string | undefined;
		month: string;
	} | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [actionsOpen, setActionsOpen] = useState(false);
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const task = useLiveQuery(
		async () => (taskId ? await store.tasks.get(taskId) : undefined),
		[store, taskId],
	);
	const events = useLiveQuery(
		async () =>
			taskId ? await store.events.where("taskId").equals(taskId).toArray() : [],
		[store, taskId],
	);
	const members = useLiveQuery(
		async () =>
			activeGroupId
				? await store.members.where("groupId").equals(activeGroupId).toArray()
				: ([] as MemberDto[]),
		[store, activeGroupId],
	);

	if (!task || !events || !members || !activeGroupId) return null;
	if (task.groupId !== activeGroupId) {
		return (
			<div className="mt-6 rounded-2xl bg-surface p-4 text-[14px] text-text-2 ring-1 ring-line">
				Task not found in this group.
			</div>
		);
	}

	const owner = task.ownerId === me.user.id;
	const ownerName =
		members.find((member) => member.userId === task.ownerId)?.displayName ??
		"Former member";
	const derived = deriveTask(
		{
			startDate: task.startDate,
			timezone: task.timezone,
			rules: task.rules,
			archivedAt: task.archivedAt,
		},
		events as unknown as TaskEvent[],
		now,
	);
	const stats = summarize(derived.entries, now - 30 * DAY_MS, now + 1);
	const currentMonth = localDate(now, task.timezone).slice(0, 7);
	const month =
		monthSelection && monthSelection.taskId === task.id
			? monthSelection.month
			: currentMonth;
	const monthDate = new Date(`${month}-01T00:00:00Z`);
	const monthLabel = new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(monthDate);
	const entriesByDate = new Map(
		derived.entries.map((entry) => [entry.key, entry]),
	);
	const cells = monthCells(month);
	const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
		cells.slice(index * 7, index * 7 + 7),
	);
	const myNudgeAt = latestNudge(events, me.user.id);
	const nudgedRecently =
		myNudgeAt !== null && now - myNudgeAt < NUDGE_INTERVAL_MS;
	const canNudge =
		!owner &&
		task.archivedAt === null &&
		derived.current?.status === "overdue" &&
		!nudgedRecently;
	const entries = [...derived.entries].sort((a, b) =>
		b.key.localeCompare(a.key),
	);
	const monthEntries = entries.filter((entry) => entry.key.startsWith(month));

	const changeMonth = (amount: number) => {
		setMonthSelection({ taskId: task.id, month: monthShift(month, amount) });
	};
	const undo = async (entry: HistoryEntry) => {
		if (!entry.completionId || busyAction) return;
		setBusyAction(entry.completionId);
		try {
			await engine.enqueue({
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "task.uncomplete",
				taskId: task.id,
				refEventId: entry.completionId,
			});
			toast.show({ message: "Completion undone" });
		} catch {
			toast.show({ message: "Could not undo completion. Try again." });
		} finally {
			setBusyAction(null);
		}
	};
	const nudge = async () => {
		if (!canNudge || busyAction) return;
		setBusyAction("nudge");
		try {
			await engine.enqueue({
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "task.nudge",
				taskId: task.id,
			});
			toast.show({ message: `Nudged ${ownerName}` });
		} catch {
			toast.show({ message: "Could not nudge. Try again." });
		} finally {
			setBusyAction(null);
		}
	};
	const toggleArchive = async () => {
		if (!owner || busyAction) return;
		const archived = task.archivedAt === null;
		setBusyAction("archive");
		try {
			await engine.enqueue({
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "task.archive",
				taskId: task.id,
				archived,
			});
			toast.show({ message: archived ? "Task archived" : "Task restored" });
		} catch {
			toast.show({ message: "Could not update task. Try again." });
		} finally {
			setBusyAction(null);
		}
	};
	const back = () => {
		if (Number(window.history.state?.idx) > 0) navigate(-1);
		else navigate("/");
	};
	const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
		const touch = event.touches[0];
		if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
	};
	const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
		const origin = touchStart.current;
		const touch = event.changedTouches[0];
		touchStart.current = null;
		if (!origin || !touch) return;
		const dx = touch.clientX - origin.x;
		const dy = touch.clientY - origin.y;
		if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy))
			changeMonth(dx < 0 ? 1 : -1);
	};

	return (
		<div className="mt-3 flex flex-col gap-5">
			<div className="flex items-center justify-between">
				<Button
					aria-label="Back"
					className="size-11 shrink-0 px-0"
					onClick={back}
				>
					<ArrowLeft aria-hidden className="size-5" />
				</Button>
				{owner ? (
					<div className="relative">
						<Button
							aria-label="Task actions"
							aria-expanded={actionsOpen}
							aria-haspopup="menu"
							className="size-11 px-0"
							onClick={() => setActionsOpen((value) => !value)}
						>
							<MoreHorizontal aria-hidden className="size-5" />
						</Button>
						{actionsOpen ? (
							<div
								role="menu"
								className="absolute right-0 top-12 z-10 min-w-44 rounded-xl bg-surface p-1 shadow-xl ring-1 ring-line"
							>
								<button
									role="menuitem"
									type="button"
									className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] hover:bg-surface-2"
									onClick={() => {
										setActionsOpen(false);
										setEditing(true);
									}}
								>
									<Pencil aria-hidden className="size-4" />
									Edit task
								</button>
								<button
									role="menuitem"
									type="button"
									className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] hover:bg-surface-2"
									disabled={busyAction !== null}
									onClick={() => {
										setActionsOpen(false);
										void toggleArchive();
									}}
								>
									{task.archivedAt === null ? (
										<Archive aria-hidden className="size-4" />
									) : (
										<ArchiveRestore aria-hidden className="size-4" />
									)}
									{task.archivedAt === null ? "Archive task" : "Restore task"}
								</button>
							</div>
						) : null}
					</div>
				) : null}
			</div>
			<div className="min-w-0">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="min-w-0 break-words text-[25px] font-semibold tracking-tight">
							{task.title}
						</h1>
						{task.archivedAt !== null ? (
							<span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] font-medium text-text-2">
								Archived
							</span>
						) : null}
					</div>
					<p className="text-[14px] text-text-2">{ruleSummary(task, now)}</p>
					{!owner ? (
						<p className="mt-1 text-[12px] text-text-3">Owned by {ownerName}</p>
					) : null}
					{canNudge ? (
						<Button
							className="mt-2 min-h-10 rounded-full px-3 text-[13px]"
							onClick={() => void nudge()}
							busy={busyAction === "nudge"}
						>
							<BellRing aria-hidden className="size-4" />
							Nudge {ownerName}
						</Button>
					) : !owner && nudgedRecently && myNudgeAt !== null ? (
						<p className="mt-2 text-[13px] text-text-2">
							{nudgeLabel(myNudgeAt, now)}
						</p>
					) : null}
				</div>
			</div>

			<section aria-labelledby="task-stats-heading">
				<div className="mb-2 flex items-baseline justify-between gap-2">
					<h2 id="task-stats-heading" className="text-[15px] font-semibold">
						Last 30 days
					</h2>
					<p className="text-[12px] text-text-2">By due date</p>
				</div>
				<div className="grid grid-cols-3 gap-2">
					<Stat
						label="On time"
						value={
							stats.onTimeRate === null
								? "—"
								: `${Math.round(stats.onTimeRate * 100)}%`
						}
					/>
					<Stat label="Late" value={String(stats.late)} />
					<Stat label="Missed" value={String(stats.missed)} />
				</div>
			</section>

			<section aria-labelledby="task-calendar-heading">
				<div className="mb-2 flex min-h-11 items-center justify-between">
					<h2
						id="task-calendar-heading"
						aria-live="polite"
						className="text-[15px] font-semibold"
					>
						{monthLabel}
					</h2>
					<div className="flex gap-1">
						<Button
							aria-label="Previous month"
							className="size-11 px-0"
							onClick={() => changeMonth(-1)}
						>
							<ChevronLeft aria-hidden className="size-5" />
						</Button>
						<Button
							aria-label="Next month"
							className="size-11 px-0"
							onClick={() => changeMonth(1)}
						>
							<ChevronRight aria-hidden className="size-5" />
						</Button>
					</div>
				</div>
				<div
					className="rounded-2xl bg-surface p-3 ring-1 ring-line"
					onTouchStart={onTouchStart}
					onTouchEnd={onTouchEnd}
				>
					<table className="w-full table-fixed border-collapse text-center">
						<caption className="sr-only">{monthLabel} task history</caption>
						<thead>
							<tr>
								{WEEKDAYS.map((day) => (
									<th
										key={day.key}
										scope="col"
										className="pb-2 text-[12px] font-medium text-text-3"
									>
										{day.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{weeks.map((week) => {
								const weekKey = week.find((cell) => cell !== null)?.date;
								return (
									<tr key={weekKey}>
										{week.map((cell, index) => {
											if (!cell)
												return (
													<td
														key={`${weekKey}-${WEEKDAYS[index]?.key ?? "empty"}`}
													/>
												);
											const entry = entriesByDate.get(cell.date);
											const today = localDate(now, task.timezone) === cell.date;
											return (
												<td key={cell.date} className="p-0.5">
													<div
														role="img"
														aria-label={`${formatDate(cell.date, { weekday: "long", month: "long", day: "numeric" })}${entry ? ` · ${statusLabel(entry, now, task.timezone)}` : " · No occurrence"}`}
														className={`relative mx-auto flex size-10 items-center justify-center rounded-full text-[13px] font-medium text-text ${today ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
													>
														{cell.day}
														{entry ? (
															<span
																aria-hidden
																className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${calendarDotClass(entry.status)}`}
															/>
														) : null}
													</div>
												</td>
											);
										})}
									</tr>
								);
							})}
						</tbody>
					</table>
					<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 text-[12px] text-text-2">
						{(
							[
								["on_time", "On time"],
								["late", "Late"],
								["missed", "Missed"],
								["open", "Open"],
								["overdue", "Overdue"],
								["upcoming", "Upcoming"],
							] as const
						).map(([status, label]) => (
							<span key={status} className="flex items-center gap-1.5">
								<span
									aria-hidden
									className={`size-3 rounded-full ${calendarDotClass(status)}`}
								/>
								{label}
							</span>
						))}
						<span className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-3 rounded-full ring-2 ring-accent ring-offset-1 ring-offset-surface"
							/>
							Today
						</span>
					</div>
				</div>
			</section>

			<section aria-labelledby="task-history-heading">
				<h2
					id="task-history-heading"
					className="mb-2 text-[15px] font-semibold"
				>
					History for {monthLabel}
				</h2>
				{monthEntries.length > 0 ? (
					<ul className="overflow-hidden rounded-2xl bg-surface px-4 ring-1 ring-line">
						{monthEntries.map((entry) => (
							<li
								key={entry.key}
								className="flex min-h-16 items-center gap-3 border-b border-line py-3 last:border-0"
							>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
									<StatusIcon status={entry.status} />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-[13px] font-medium">
										{formatDate(entry.key, {
											weekday: "short",
											month: "short",
											day: "numeric",
										})}
									</p>
									<p className="text-[13px] text-text-2">
										{statusLabel(entry, now, task.timezone)}
									</p>
								</div>
								{owner && entry.completionId ? (
									<Button
										aria-label={`Undo completion for ${formatDate(entry.key)}`}
										busy={busyAction === entry.completionId}
										disabled={
											busyAction !== null && busyAction !== entry.completionId
										}
										variant="ghost"
										className="min-h-10 shrink-0 px-2 text-[13px]"
										onClick={() => void undo(entry)}
									>
										<Undo2 aria-hidden className="size-4" />
										Undo
									</Button>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="rounded-2xl bg-surface px-4 py-5 text-[14px] text-text-2 ring-1 ring-line">
						No history for {monthLabel}.
					</p>
				)}
			</section>
			{owner ? (
				<AddTaskSheet
					open={editing}
					onClose={() => setEditing(false)}
					task={task}
				/>
			) : null}
		</div>
	);
}
