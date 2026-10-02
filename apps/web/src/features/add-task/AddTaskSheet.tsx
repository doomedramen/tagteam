import {
	DEFAULT_EMOJI_NAME,
	MAX_PENDING_SUGGESTIONS,
	type TaskDto,
	type Weekday,
} from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import {
	CalendarDays,
	Clock,
	Repeat as RepeatIcon,
	UserRound,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cx } from "../../lib/cx";
import { browserTimeZone, formatWhen, localDate } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { useToast } from "../../ui/Toast";
import { useEmojiName } from "../emoji/catalog";
import { EmojiPicker } from "../emoji/EmojiPicker";
import { ColorOptions } from "../look/ColorOptions";
import { TaskEmoji } from "../look/TaskEmoji";
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
	taskUpdateMutation,
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
// Option value for "Me" (no recipient); a member's option value is their user id.
const ME = "";
const chip =
	"min-w-11 rounded-full bg-task-swatch px-3.5 text-[14px] text-text transition-colors duration-200 motion-reduce:transition-none aria-pressed:bg-task-fg aria-pressed:text-task-sheet data-[state=on]:bg-task-fg data-[state=on]:text-task-sheet";
const toggleClass = cx("h-11", chip);

type RowId = "for" | "repeat" | "starts" | "due";

/** One line of the settings card: icon, label, value in a pill. Tapping it opens its controls beneath. */
function SettingRow({
	id,
	icon,
	label,
	value,
	open,
	onToggle,
	children,
}: {
	id: string;
	icon: ReactNode;
	label: string;
	value: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={`${id}-panel`}
				onClick={onToggle}
				className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-1.5 py-1 text-left"
			>
				<span
					aria-hidden="true"
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-task-swatch text-task-fg transition-colors duration-200 motion-reduce:transition-none [&_svg]:size-[18px]"
				>
					{icon}
				</span>
				<span className="min-w-0 flex-1 text-[15px] font-medium">{label}</span>
				<span className="max-w-[55%] truncate rounded-full bg-task-swatch px-3 py-1.5 text-[14px] text-text transition-colors duration-200 motion-reduce:transition-none">
					{value}
				</span>
			</button>
			{open ? (
				<div id={`${id}-panel`} className="px-1.5 pb-2 pt-2">
					{children}
				</div>
			) : null}
		</div>
	);
}

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
	const today = localDate(Date.now(), task?.timezone);
	const [draft, setDraft] = useState<TaskDraft>(() => newDraft(today));
	const [errors, setErrors] = useState<ReturnType<typeof draftErrors>>({});
	const [openRow, setOpenRow] = useState<RowId | null>(task ? "repeat" : null);
	const [pickerOpen, setPickerOpen] = useState(false);
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
	const emojiName = useEmojiName(draft.emoji);
	const emojiLabel =
		draft.emoji === null
			? `${DEFAULT_EMOJI_NAME}, default`
			: (emojiName ?? draft.emoji);
	useEffect(() => {
		if (!open || !task) return;
		const effectiveFrom =
			task && today < task.startDate ? task.startDate : today;
		setDraft(taskDraft(task, effectiveFrom));
		setOpenRow("repeat");
		setErrors({});
		setSaveError(null);
	}, [open, task, today]);
	useEffect(() => {
		if (task || !activeGroupId) return;
		setDraft(newDraft(today));
		setErrors({});
		setSaveError(null);
		setOpenRow(null);
	}, [activeGroupId, task, today]);
	const update = (patch: Partial<TaskDraft>) =>
		setDraft((d) => ({ ...d, ...patch }));
	const toggleRow = (id: RowId) =>
		setOpenRow((current) => (current === id ? null : id));
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
			if (problems.every) setOpenRow("repeat");
			else if (problems.dueTime) setOpenRow("due");
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
				const change = taskUpdateMutation(draft, task, at);
				const schedule = draftScheduleMutation(draft, task, at);
				if (change) await engine.enqueue(change);
				if (schedule) await engine.enqueue(schedule);
				toast.show({
					message: change || schedule ? "Task updated" : "No changes to save",
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
				setOpenRow(null);
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

	const startValue = formatWhen(
		Date.parse(`${draft.startDate}T12:00:00`),
		Date.now(),
	);
	const repeatValue =
		REPEATS.find((repeat) => repeat.value === draft.repeat)?.label ?? "Once";
	const actionLabel = task
		? "Save"
		: recipient
			? `Suggest to ${recipient.displayName}`
			: "Create";

	return (
		<Sheet
			open={open}
			onClose={close}
			label={task ? "Edit task" : "New task"}
			focusOnTouch
			tint={draft.color}
			action={
				<button
					type="submit"
					form={formId}
					disabled={submitting}
					aria-busy={submitting || undefined}
					className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-task-fg px-5 text-[15px] font-semibold text-task-sheet transition-colors duration-200 active:opacity-90 disabled:opacity-60 motion-reduce:transition-none"
				>
					{submitting ? <Spinner /> : null}
					{actionLabel}
				</button>
			}
			notice={
				saveError ? (
					<p role="alert" className="text-[13px] text-danger">
						{saveError}
					</p>
				) : null
			}
		>
			<form
				id={formId}
				onSubmit={(e) => void submit(e)}
				className="flex flex-col gap-4 pb-2"
			>
				{/* The visible action sits in the header, outside this form. A submit button
				    inside the form keeps Enter in the title submitting in every browser. */}
				<button
					type="submit"
					tabIndex={-1}
					aria-hidden="true"
					className="sr-only"
				/>
				<button
					type="button"
					aria-label={`Emoji: ${emojiLabel}, change`}
					aria-haspopup="dialog"
					onClick={() => setPickerOpen(true)}
					className="mx-auto block rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-task-ring"
				>
					<TaskEmoji emoji={draft.emoji} size="sheet" />
				</button>

				<Field data-invalid={errors.title ? true : undefined} className="gap-1">
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
						className="h-auto min-h-14 rounded-none border-0 border-b-2 border-task-ring/40 bg-transparent px-2 text-center text-[26px] font-semibold tracking-tight placeholder:font-normal placeholder:text-text-3 focus-visible:border-task-ring focus-visible:ring-0"
					/>
					{errors.title ? (
						<FieldError
							id="task-title-error"
							className="text-center text-[13px]"
						>
							{errors.title}
						</FieldError>
					) : null}
				</Field>

				<ColorOptions
					value={draft.color}
					onChange={(color) => update({ color })}
				/>

				<div className="flex flex-col gap-1 rounded-[26px] bg-task-card p-2 transition-colors duration-200 motion-reduce:transition-none">
					{recipients.length > 0 ? (
						<SettingRow
							id={`${formId}-for`}
							icon={<UserRound />}
							label="For"
							value={recipient?.displayName ?? "Me"}
							open={openRow === "for"}
							onToggle={() => toggleRow("for")}
						>
							<NativeSelect
								className="w-full"
								aria-label="For"
								selectClassName="bg-task-sheet ring-0"
								value={recipient?.userId ?? ME}
								onChange={(e) => {
									update({
										forUserId: e.target.value === ME ? null : e.target.value,
									});
									setSaveError(null);
								}}
							>
								<NativeSelectOption value={ME}>Me</NativeSelectOption>
								{recipients.map((member) => (
									<NativeSelectOption key={member.userId} value={member.userId}>
										{member.displayName}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</SettingRow>
					) : null}

					<SettingRow
						id={`${formId}-repeat`}
						icon={<RepeatIcon />}
						label="Repeat"
						value={repeatValue}
						open={openRow === "repeat"}
						onToggle={() => toggleRow("repeat")}
					>
						<FieldGroup className="gap-4">
							<FieldSet className="gap-2">
								<FieldLegend variant="label" className="sr-only">
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
								<div className="flex flex-col gap-3 rounded-2xl bg-task-sheet p-3">
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
												className="w-20 bg-task-card text-center"
											/>
											<FieldLabel htmlFor="unit" className="sr-only">
												Unit
											</FieldLabel>
											<NativeSelect
												id="unit"
												value={draft.unit}
												selectClassName="min-w-24 bg-task-card ring-0"
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
															className={cx("size-11 px-0", chip)}
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
													selectClassName="w-full bg-task-card ring-0"
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
						</FieldGroup>
					</SettingRow>

					<SettingRow
						id={`${formId}-starts`}
						icon={<CalendarDays />}
						label={task ? "Changes from" : "Starts"}
						value={startValue}
						open={openRow === "starts"}
						onToggle={() => toggleRow("starts")}
					>
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
								className="min-h-11 w-auto bg-task-sheet"
							/>
						</Field>
					</SettingRow>

					<SettingRow
						id={`${formId}-due`}
						icon={<Clock />}
						label="Due by"
						value={draft.dueTime ?? "No time"}
						open={openRow === "due"}
						onToggle={() => toggleRow("due")}
					>
						{draft.dueTime === null ? (
							<Button
								className="rounded-full bg-task-sheet text-text ring-0"
								onClick={() => update({ dueTime: "08:00" })}
							>
								<Clock aria-hidden data-icon="inline-start" />
								Add time
							</Button>
						) : (
							<div className="flex flex-col gap-1">
								<Field orientation="horizontal" className="items-center gap-2">
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
										className="min-h-11 w-auto bg-task-sheet"
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
					</SettingRow>
				</div>
			</form>

			<EmojiPicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				value={draft.emoji}
				title={draft.title}
				onPick={(emoji) => update({ emoji, emojiChosen: true })}
			/>
		</Sheet>
	);
}
