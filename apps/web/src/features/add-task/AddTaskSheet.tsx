import {
	MAX_PENDING_SUGGESTIONS,
	type TaskDto,
	type Weekday,
} from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, ChevronDown, Clock, Plus, Send } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { browserTimeZone, formatWhen, localDate } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import { pendingSuggestionCount } from "../suggestions/model";
import {
	draftErrors,
	draftMutation,
	draftScheduleMutation,
	newDraft,
	type Repeat,
	suggestionMutation,
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
const toggleClass =
	"h-11 min-w-11 rounded-full bg-surface px-3.5 text-[14px] text-text ring-1 ring-line aria-pressed:bg-accent aria-pressed:text-on-accent data-[state=on]:bg-accent data-[state=on]:text-on-accent";

export function AddTaskSheet({
	open,
	onClose,
	task,
}: {
	open: boolean;
	onClose: () => void;
	task?: TaskDto;
}) {
	const { store, engine, activeGroupId, me } = useSession();
	const toast = useToast();
	const formId = useId();
	const submittingRef = useRef(false);
	const [showSchedule, setShowSchedule] = useState(Boolean(task));
	const today = localDate(Date.now(), task?.timezone);
	const [draft, setDraft] = useState<TaskDraft>(() => newDraft(today));
	const [errors, setErrors] = useState<ReturnType<typeof draftErrors>>({});
	const [showDate, setShowDate] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const members = useLiveQuery(
		() =>
			store.members
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const suggestions = useLiveQuery(
		() =>
			store.suggestions
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	// Other active members I could suggest this task to. Editing never offers it.
	const recipients = task
		? []
		: (members ?? [])
				.filter((m) => m.leftAt === null && m.userId !== me.user.id)
				.sort((a, b) => a.displayName.localeCompare(b.displayName));
	const recipient =
		recipients.find((m) => m.userId === draft.forUserId) ?? null;
	useEffect(() => {
		if (!open || !task) return;
		const effectiveFrom =
			task && today < task.startDate ? task.startDate : today;
		setDraft(taskDraft(task, effectiveFrom));
		setShowSchedule(true);
		setErrors({});
		setSaveError(null);
		setShowDate(false);
	}, [open, task, today]);
	useEffect(() => {
		if (task || !activeGroupId) return;
		setDraft(newDraft(today));
		setErrors({});
		setSaveError(null);
		setShowSchedule(false);
		setShowDate(false);
	}, [activeGroupId, task, today]);
	const update = (patch: Partial<TaskDraft>) =>
		setDraft((d) => ({ ...d, ...patch }));
	const close = () => {
		if (submittingRef.current) return;
		onClose();
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (submittingRef.current) return;
		const problems = draftErrors(draft);
		setErrors(problems);
		if (Object.keys(problems).length > 0) {
			if (problems.every || problems.dueTime) setShowSchedule(true);
			return;
		}
		if (task && task.ownerId !== me.user.id) return;
		if (!task && !activeGroupId) return;
		if (
			recipient &&
			pendingSuggestionCount(
				suggestions ?? [],
				activeGroupId as string,
				me.user.id,
				recipient.userId,
			) >= MAX_PENDING_SUGGESTIONS
		) {
			setSaveError(
				`You already have ${MAX_PENDING_SUGGESTIONS} suggestions waiting for ${recipient.displayName}. Wait for an answer or withdraw one.`,
			);
			return;
		}
		setSaveError(null);
		submittingRef.current = true;
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
			} else if (recipient) {
				await engine.enqueue(
					suggestionMutation(draft, {
						groupId: activeGroupId as string,
						toUserId: recipient.userId,
						at: Date.now(),
					}),
				);
				toast.show({
					message: `Suggested to ${recipient.displayName} · ${draft.title.trim()}`,
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
			if (!task) {
				setDraft(newDraft(today));
				setShowSchedule(false);
				setShowDate(false);
			}
			onClose();
		} catch {
			setSaveError(
				task
					? "Could not update task. Try again."
					: recipient
						? "Could not send suggestion. Try again."
						: "Could not add task. Try again.",
			);
		} finally {
			submittingRef.current = false;
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
		<Sheet
			open={open}
			onClose={close}
			label={task ? "Edit task" : "New task"}
			showTitle
			focusOnTouch
			footer={
				<>
					{saveError ? (
						<p role="alert" className="mb-2 text-[13px] text-danger">
							{saveError}
						</p>
					) : null}
					<Button
						type="submit"
						form={formId}
						variant="primary"
						block
						busy={submitting}
						className="min-h-12 rounded-2xl"
					>
						{!task && !submitting ? (
							recipient ? (
								<Send aria-hidden className="size-5" />
							) : (
								<Plus aria-hidden className="size-5" />
							)
						) : null}
						{task
							? "Save changes"
							: recipient
								? `Suggest to ${recipient.displayName}`
								: "Add task"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={(e) => void submit(e)}>
				<FieldGroup className="gap-4">
					<Field
						data-invalid={errors.title ? true : undefined}
						className="gap-1"
					>
						<FieldLabel htmlFor="task-title" className="sr-only">
							Task
						</FieldLabel>
						<Input
							id="task-title"
							data-autofocus
							enterKeyHint="done"
							autoComplete="off"
							autoCapitalize="sentences"
							onKeyDown={(event) => {
								if (event.key === "Enter" && event.nativeEvent.isComposing)
									event.preventDefault();
							}}
							placeholder="What needs doing?"
							value={draft.title}
							onChange={(e) => update({ title: e.target.value })}
							aria-invalid={errors.title ? true : undefined}
							aria-describedby={errors.title ? "task-title-error" : undefined}
							className="min-h-14 rounded-2xl bg-surface-2 text-xl"
						/>
						{errors.title ? (
							<FieldError id="task-title-error" className="text-[13px]">
								{errors.title}
							</FieldError>
						) : null}
					</Field>

					{recipients.length > 0 ? (
						<FieldSet className="gap-2">
							<FieldLegend
								variant="label"
								className="mb-2 text-[13px] font-medium text-text-2"
							>
								For
							</FieldLegend>
							<ToggleGroup
								value={[recipient?.userId ?? me.user.id]}
								aria-label="For"
								onValueChange={([value]) => {
									if (!value) return;
									update({ forUserId: value === me.user.id ? null : value });
									setSaveError(null);
								}}
								className="w-full flex-wrap justify-start gap-2 rounded-none"
							>
								<ToggleGroupItem value={me.user.id} className={toggleClass}>
									Me
								</ToggleGroupItem>
								{recipients.map((member) => (
									<ToggleGroupItem
										key={member.userId}
										value={member.userId}
										className={toggleClass}
									>
										{member.displayName}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</FieldSet>
					) : null}

					<button
						type="button"
						aria-expanded={showSchedule}
						aria-controls={`${formId}-schedule`}
						onClick={() => setShowSchedule((shown) => !shown)}
						className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left active:bg-surface-2"
					>
						<CalendarDays aria-hidden className="size-5 shrink-0 text-accent" />
						<span className="min-w-0 flex-1">
							<span className="block text-[15px] font-medium">Schedule</span>
							<span className="block text-[13px] text-text-2">
								{REPEATS.find((repeat) => repeat.value === draft.repeat)?.label}{" "}
								· {startLabel}
								{draft.dueTime ? ` · By ${draft.dueTime}` : ""}
							</span>
						</span>
						<ChevronDown
							aria-hidden
							className={`size-4 text-text-2 motion-safe:transition-transform ${showSchedule ? "rotate-180" : ""}`}
						/>
					</button>
					<div id={`${formId}-schedule`} hidden={!showSchedule}>
						<FieldGroup className="gap-4 border-t border-line pt-4">
							<FieldSet className="gap-2">
								<FieldLegend
									variant="label"
									className="mb-2 text-[13px] font-medium text-text-2"
								>
									Repeat
								</FieldLegend>
								<ToggleGroup
									value={[draft.repeat]}
									aria-label="Repeat"
									onValueChange={([value]) => {
										if (value) update({ repeat: value as Repeat });
									}}
									className="w-full flex-wrap justify-start gap-2 rounded-none"
								>
									{REPEATS.map((r) => (
										<ToggleGroupItem
											key={r.value}
											value={r.value}
											className={toggleClass}
										>
											{r.label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</FieldSet>

							{draft.repeat === "custom" ? (
								<div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
									<FieldGroup className="gap-2">
										<Field
											orientation="horizontal"
											className="items-center gap-2"
										>
											<FieldLabel
												htmlFor="every"
												className="w-auto text-[15px]"
											>
												Every
											</FieldLabel>
											<Input
												id="every"
												type="number"
												inputMode="numeric"
												min={1}
												max={366}
												value={Number.isNaN(draft.every) ? "" : draft.every}
												onChange={(e) =>
													update({ every: e.target.valueAsNumber })
												}
												className="w-20 text-center"
											/>
											<FieldLabel htmlFor="unit" className="sr-only">
												Unit
											</FieldLabel>
											<NativeSelect
												id="unit"
												value={draft.unit}
												selectClassName="min-w-24"
												onChange={(e) =>
													update({ unit: e.target.value as Unit })
												}
											>
												<NativeSelectOption value="day">
													days
												</NativeSelectOption>
												<NativeSelectOption value="week">
													weeks
												</NativeSelectOption>
												<NativeSelectOption value="month">
													months
												</NativeSelectOption>
											</NativeSelect>
										</Field>
										{errors.every ? (
											<Field data-invalid>
												<FieldError className="text-[13px]">
													{errors.every}
												</FieldError>
											</Field>
										) : null}
										{draft.unit === "week" ? (
											<FieldSet className="gap-2">
												<FieldLegend
													variant="label"
													className="text-[13px] text-text-2"
												>
													On these days
												</FieldLegend>
												<ToggleGroup
													multiple
													value={draft.weekdays.map(String)}
													aria-label="Repeat days"
													onValueChange={(values) =>
														update({
															weekdays: values.map(Number) as Weekday[],
														})
													}
													className="w-full flex-wrap justify-start gap-1 rounded-none"
												>
													{WEEKDAYS.map((d) => (
														<ToggleGroupItem
															key={d.value}
															value={String(d.value)}
															aria-label={d.name}
															className="size-11 min-w-11 rounded-full bg-surface px-0 text-[14px] text-text ring-1 ring-line aria-pressed:bg-accent aria-pressed:text-on-accent data-[state=on]:bg-accent data-[state=on]:text-on-accent"
														>
															{d.short}
														</ToggleGroupItem>
													))}
												</ToggleGroup>
											</FieldSet>
										) : null}
										{draft.unit === "month" ? (
											<Field
												orientation="horizontal"
												className="items-center gap-2"
											>
												<FieldLabel
													htmlFor="month-day"
													className="w-auto text-[15px]"
												>
													On
												</FieldLabel>
												<NativeSelect
													id="month-day"
													className="min-w-0 flex-1"
													selectClassName="w-full"
													value={String(draft.monthDay)}
													onChange={(e) =>
														update({
															monthDay:
																e.target.value === "last"
																	? "last"
																	: Number(e.target.value),
														})
													}
												>
													{Array.from({ length: 31 }, (_, i) => i + 1).map(
														(day) => (
															<NativeSelectOption key={day} value={day}>
																Day {day}
															</NativeSelectOption>
														),
													)}
													<NativeSelectOption value="last">
														Last day
													</NativeSelectOption>
												</NativeSelect>
											</Field>
										) : null}
									</FieldGroup>
								</div>
							) : null}

							<div className="flex flex-wrap items-center gap-2">
								<Toggle
									pressed={showDate}
									onPressedChange={setShowDate}
									className={toggleClass}
								>
									<CalendarDays aria-hidden data-icon="inline-start" />
									{startLabel}
								</Toggle>
								{draft.dueTime === null ? (
									<Button
										variant="secondary"
										className="rounded-full"
										onClick={() => update({ dueTime: "08:00" })}
									>
										<Clock aria-hidden data-icon="inline-start" />
										Add time
									</Button>
								) : (
									<div className="flex flex-col gap-1">
										<Field
											orientation="horizontal"
											className="items-center gap-2"
										>
											<FieldLabel
												htmlFor="due-time"
												className="w-auto text-[14px] text-text-2"
											>
												Due by
											</FieldLabel>
											<Input
												id="due-time"
												type="time"
												value={draft.dueTime}
												onChange={(e) => update({ dueTime: e.target.value })}
												aria-invalid={errors.dueTime ? true : undefined}
												aria-describedby={
													errors.dueTime ? "due-time-error" : undefined
												}
												className="min-h-11 w-auto"
											/>
											<Button
												variant="ghost"
												onClick={() => update({ dueTime: null })}
											>
												Remove time
											</Button>
										</Field>
										{errors.dueTime ? (
											<FieldError id="due-time-error" className="text-[13px]">
												{errors.dueTime}
											</FieldError>
										) : null}
									</div>
								)}
							</div>
							{showDate ? (
								<Field orientation="horizontal" className="items-center gap-2">
									<FieldLabel
										htmlFor="start-date"
										className="w-auto text-[14px] text-text-2"
									>
										{task ? "Effective date" : "Start date"}
									</FieldLabel>
									<Input
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
										className="min-h-11 w-auto"
									/>
								</Field>
							) : null}
						</FieldGroup>
					</div>
				</FieldGroup>
			</form>
		</Sheet>
	);
}
