import type { TaskDto, Weekday } from "@tagteam/core";
import { CalendarDays, Clock } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { browserTimeZone, formatWhen, localDate } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import {
	draftErrors,
	draftMutation,
	draftScheduleMutation,
	newDraft,
	type Repeat,
	type TaskDraft,
	taskDraft,
	type Unit,
} from "./draft";

const REPEATS: { value: Repeat; label: string }[] = [
	{ value: "once", label: "Once" },
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "custom", label: "Custom" },
];
const WEEKDAYS: { value: Weekday; short: string; name: string }[] = [
	{ value: 1, short: "M", name: "Monday" },
	{ value: 2, short: "T", name: "Tuesday" },
	{ value: 3, short: "W", name: "Wednesday" },
	{ value: 4, short: "T", name: "Thursday" },
	{ value: 5, short: "F", name: "Friday" },
	{ value: 6, short: "S", name: "Saturday" },
	{ value: 7, short: "S", name: "Sunday" },
];
const selectClass =
	"min-h-11 rounded-xl bg-surface px-3 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-accent";

export function AddTaskSheet({
	open,
	onClose,
	task,
}: {
	open: boolean;
	onClose: () => void;
	task?: TaskDto;
}) {
	const { engine, activeGroupId, me } = useSession();
	const toast = useToast();
	const today = localDate(Date.now(), task?.timezone);
	const [draft, setDraft] = useState<TaskDraft>(() => newDraft(today));
	const [errors, setErrors] = useState<ReturnType<typeof draftErrors>>({});
	const [showDate, setShowDate] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	useEffect(() => {
		if (!open) return;
		const effectiveFrom =
			task && today < task.startDate ? task.startDate : today;
		setDraft(task ? taskDraft(task, effectiveFrom) : newDraft(today));
		setErrors({});
		setShowDate(false);
	}, [open, task, today]);
	const update = (patch: Partial<TaskDraft>) =>
		setDraft((d) => ({ ...d, ...patch }));
	const close = () => {
		setDraft(newDraft(today));
		setErrors({});
		setShowDate(false);
		setSubmitting(false);
		onClose();
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (submitting) return;
		const problems = draftErrors(draft);
		setErrors(problems);
		if (Object.keys(problems).length > 0) return;
		if (task && task.ownerId !== me.user.id) return;
		if (!task && !activeGroupId) return;
		setSubmitting(true);
		try {
			if (task) {
				const at = Date.now();
				const title = draft.title.trim();
				const schedule = draftScheduleMutation(draft, task, at);
				const titleChanged = title !== task.title;
				if (titleChanged) {
					await engine.enqueue({
						id: crypto.randomUUID(),
						at,
						type: "task.update",
						taskId: task.id,
						title,
					});
				}
				if (schedule) await engine.enqueue(schedule);
				toast.show({
					message:
						titleChanged || schedule ? "Task updated" : "No changes to save",
				});
			} else {
				await engine.enqueue(
					draftMutation(draft, {
						groupId: activeGroupId as string,
						timezone: browserTimeZone(),
						at: Date.now(),
					}),
				);
				toast.show({ message: `Added · ${draft.title.trim()}` });
			}
			close();
		} catch {
			toast.show({
				message: task
					? "Could not update task. Try again."
					: "Could not add task. Try again.",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const startLabel = task
		? draft.startDate === today
			? "Changes today"
			: `Changes ${formatWhen(Date.parse(`${draft.startDate}T12:00:00`), Date.now()).toLowerCase()}`
		: draft.startDate === today
			? "Starts today"
			: `Starts ${formatWhen(Date.parse(`${draft.startDate}T12:00:00`), Date.now()).toLowerCase()}`;

	return (
		<Sheet open={open} onClose={close} label={task ? "Edit task" : "Add task"}>
			<form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<label htmlFor="task-title" className="sr-only">
						Task
					</label>
					<input
						id="task-title"
						data-autofocus
						enterKeyHint="done"
						placeholder="Brush teeth"
						value={draft.title}
						onChange={(e) => update({ title: e.target.value })}
						aria-invalid={errors.title ? true : undefined}
						aria-describedby={errors.title ? "task-title-error" : undefined}
						className="min-h-12 w-full rounded-xl bg-surface px-3.5 text-xl text-text ring-1 ring-line outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent aria-invalid:ring-danger"
					/>
					{errors.title ? (
						<p id="task-title-error" className="text-[13px] text-danger">
							{errors.title}
						</p>
					) : null}
				</div>

				<div>
					<p
						id="repeat-label"
						className="mb-2 text-[13px] font-medium text-text-2"
					>
						Repeat
					</p>
					<div
						role="radiogroup"
						aria-labelledby="repeat-label"
						className="flex flex-wrap gap-2"
					>
						{REPEATS.map((r) => (
							<Chip
								key={r.value}
								selected={draft.repeat === r.value}
								onClick={() => update({ repeat: r.value })}
							>
								{r.label}
							</Chip>
						))}
					</div>
				</div>

				{draft.repeat === "custom" ? (
					<div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
						<div className="flex items-center gap-2">
							<label htmlFor="every" className="text-[15px]">
								Every
							</label>
							<input
								id="every"
								type="number"
								inputMode="numeric"
								min={1}
								max={366}
								value={Number.isNaN(draft.every) ? "" : draft.every}
								onChange={(e) => update({ every: e.target.valueAsNumber })}
								className={`${selectClass} w-20 text-center`}
							/>
							<label htmlFor="unit" className="sr-only">
								Unit
							</label>
							<select
								id="unit"
								value={draft.unit}
								onChange={(e) => update({ unit: e.target.value as Unit })}
								className={selectClass}
							>
								<option value="day">days</option>
								<option value="week">weeks</option>
								<option value="month">months</option>
							</select>
						</div>
						{errors.every ? (
							<p className="text-[13px] text-danger">{errors.every}</p>
						) : null}
						{draft.unit === "week" ? (
							<div className="flex justify-between">
								{WEEKDAYS.map((d) => {
									const on = draft.weekdays.includes(d.value);
									return (
										<button
											key={d.value}
											type="button"
											aria-label={d.name}
											aria-pressed={on}
											onClick={() =>
												update({
													weekdays: on
														? draft.weekdays.filter((w) => w !== d.value)
														: [...draft.weekdays, d.value],
												})
											}
											className={`size-11 rounded-full text-[14px] font-medium ${on ? "bg-accent text-on-accent" : "bg-surface ring-1 ring-line"}`}
										>
											{d.short}
										</button>
									);
								})}
							</div>
						) : null}
						{draft.unit === "month" ? (
							<div className="flex items-center gap-2">
								<label htmlFor="month-day" className="text-[15px]">
									On
								</label>
								<select
									id="month-day"
									value={String(draft.monthDay)}
									onChange={(e) =>
										update({
											monthDay:
												e.target.value === "last"
													? "last"
													: Number(e.target.value),
										})
									}
									className={selectClass}
								>
									{Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
										<option key={day} value={day}>
											Day {day}
										</option>
									))}
									<option value="last">Last day</option>
								</select>
							</div>
						) : null}
					</div>
				) : null}

				<div className="flex flex-wrap items-center gap-2">
					<Chip
						role="checkbox"
						selected={showDate}
						onClick={() => setShowDate((v) => !v)}
					>
						<CalendarDays aria-hidden className="size-4" />
						{startLabel}
					</Chip>
					{draft.dueTime === null ? (
						<Button
							variant="secondary"
							className="rounded-full"
							onClick={() => update({ dueTime: "08:00" })}
						>
							<Clock aria-hidden className="size-4" />
							Add time
						</Button>
					) : (
						<div className="flex flex-col gap-1">
							<div className="flex items-center gap-2">
								<label htmlFor="due-time" className="text-[14px] text-text-2">
									Due by
								</label>
								<input
									id="due-time"
									type="time"
									value={draft.dueTime}
									onChange={(e) => update({ dueTime: e.target.value })}
									aria-invalid={errors.dueTime ? true : undefined}
									aria-describedby={
										errors.dueTime ? "due-time-error" : undefined
									}
									className={selectClass}
								/>
								<Button
									variant="ghost"
									onClick={() => update({ dueTime: null })}
								>
									Remove time
								</Button>
							</div>
							{errors.dueTime ? (
								<p id="due-time-error" className="text-[13px] text-danger">
									{errors.dueTime}
								</p>
							) : null}
						</div>
					)}
				</div>
				{showDate ? (
					<div className="flex items-center gap-2">
						<label htmlFor="start-date" className="text-[14px] text-text-2">
							{task ? "Effective date" : "Start date"}
						</label>
						<input
							id="start-date"
							type="date"
							min={
								task
									? task.startDate > today
										? task.startDate
										: today
									: undefined
							}
							value={draft.startDate}
							onChange={(e) =>
								e.target.value &&
								update({
									startDate: e.target.value,
									monthDay: Number(e.target.value.slice(8)),
								})
							}
							className={selectClass}
						/>
					</div>
				) : null}

				<Button type="submit" variant="primary" block busy={submitting}>
					{task ? "Save changes" : "Add task"}
				</Button>
			</form>
		</Sheet>
	);
}
