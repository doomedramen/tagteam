import { Check, Repeat } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type TouchEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link } from "react-router";
import { cx } from "../../lib/cx";
import { Button } from "../../ui/Button";
import { ConfettiBurst } from "../../ui/ConfettiBurst";
import { rowLabel } from "./labels";
import type { TodayRow, TodayView } from "./model";

function CheckCircle({
	row,
	onToggle,
	celebrating,
}: {
	row: TodayRow;
	onToggle: (row: TodayRow) => void;
	celebrating: boolean;
}) {
	const done = row.kind === "done";
	return (
		<button
			type="button"
			aria-label={
				done ? `Undo ${row.task.title}` : `Complete ${row.task.title}`
			}
			aria-pressed={done}
			onClick={() => onToggle(row)}
			className="-m-2 relative flex size-11 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
		>
			{done && celebrating ? <ConfettiBurst /> : null}
			<span
				className={cx(
					"flex size-[26px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
					done && "border-success bg-success text-bg",
					row.kind === "overdue" && "border-danger",
					row.kind === "open" && "border-text-3",
					row.kind === "upcoming" && "border-dashed border-text-3",
				)}
			>
				{done ? <Check aria-hidden className="size-4" strokeWidth={3} /> : null}
			</span>
		</button>
	);
}

function Row({
	row,
	now,
	onToggle,
	celebrating,
}: {
	row: TodayRow;
	now: number;
	onToggle: (row: TodayRow) => void;
	celebrating: boolean;
}) {
	const done = row.kind === "done";
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const suppressClick = useRef(false);
	const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [swipeOffset, setSwipeOffset] = useState(0);
	useEffect(
		() => () => {
			if (suppressTimer.current) clearTimeout(suppressTimer.current);
		},
		[],
	);
	const onTouchStart = (event: TouchEvent<HTMLLIElement>) => {
		const touch = event.touches[0];
		if (!touch) return;
		touchStart.current = { x: touch.clientX, y: touch.clientY };
		suppressClick.current = false;
	};
	const onTouchMove = (event: TouchEvent<HTMLLIElement>) => {
		const origin = touchStart.current;
		const touch = event.touches[0];
		if (!origin || !touch) return;
		const dx = touch.clientX - origin.x;
		const dy = touch.clientY - origin.y;
		if (!done && dx > 8 && Math.abs(dx) > Math.abs(dy))
			setSwipeOffset(Math.min(dx, 96));
		else if (!done && dx <= 8) setSwipeOffset(0);
	};
	const onTouchEnd = (event: TouchEvent<HTMLLIElement>) => {
		const origin = touchStart.current;
		const touch = event.changedTouches[0];
		touchStart.current = null;
		setSwipeOffset(0);
		if (!origin || !touch || done) return;
		const dx = touch.clientX - origin.x;
		const dy = touch.clientY - origin.y;
		if (dx < 72 || Math.abs(dx) <= Math.abs(dy)) return;
		suppressClick.current = true;
		if (suppressTimer.current) clearTimeout(suppressTimer.current);
		suppressTimer.current = setTimeout(() => {
			suppressClick.current = false;
		}, 500);
		onToggle(row);
	};
	const onClickCapture = (event: ReactMouseEvent<HTMLLIElement>) => {
		if (!suppressClick.current) return;
		event.preventDefault();
		event.stopPropagation();
		suppressClick.current = false;
		if (suppressTimer.current) clearTimeout(suppressTimer.current);
	};
	return (
		<li
			className="relative overflow-hidden touch-pan-y"
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
			onTouchCancel={() => {
				touchStart.current = null;
				setSwipeOffset(0);
			}}
			onClickCapture={onClickCapture}
		>
			{swipeOffset > 0 ? (
				<span
					aria-hidden
					className="absolute inset-y-0 left-0 flex items-center gap-2 pl-4 text-[13px] font-medium text-success"
				>
					<Check className="size-4" />
					Done
				</span>
			) : null}
			<div
				className="relative flex items-center gap-3 border-b border-line bg-surface py-3 transition-transform duration-150 last:border-0"
				style={{ transform: `translateX(${swipeOffset}px)` }}
			>
				<CheckCircle row={row} onToggle={onToggle} celebrating={celebrating} />
				<Link
					to={`/tasks/${row.task.id}`}
					className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
				>
					<p
						className={cx(
							"truncate text-[15px]",
							row.kind === "done" && "text-text-3 line-through",
							row.kind === "upcoming" && "text-text-2",
						)}
					>
						{row.task.title}
					</p>
					<p
						className={cx(
							"text-[13px]",
							row.kind === "overdue" ? "text-danger" : "text-text-2",
						)}
					>
						{rowLabel(row, now)}
					</p>
				</Link>
				{row.recurring ? (
					<Repeat
						role="img"
						aria-label="Repeats"
						className="size-4 shrink-0 text-text-3"
					/>
				) : null}
			</div>
		</li>
	);
}

function Section({
	title,
	rows,
	now,
	onToggle,
	celebratingKey,
}: {
	title: string;
	rows: TodayRow[];
	now: number;
	onToggle: (row: TodayRow) => void;
	celebratingKey: string | null;
}) {
	if (rows.length === 0) return null;
	return (
		<section aria-label={title} className="mt-5">
			<h2 className="mb-1 text-[13px] font-medium text-text-2">{title}</h2>
			<ul className="rounded-2xl bg-surface px-4 ring-1 ring-line">
				{rows.map((row) => (
					<Row
						key={`${row.kind}-${row.task.id}-${row.key}`}
						row={row}
						now={now}
						onToggle={onToggle}
						celebrating={celebratingKey === `${row.task.id}:${row.key}`}
					/>
				))}
			</ul>
		</section>
	);
}

export function TodayList({
	view,
	now,
	showUpcoming,
	onToggleUpcoming,
	onToggle,
	celebratingKey,
	onAdd,
}: {
	view: TodayView;
	now: number;
	showUpcoming: boolean;
	onToggleUpcoming: () => void;
	onToggle: (row: TodayRow) => void;
	celebratingKey: string | null;
	onAdd: () => void;
}) {
	if (!view.hasTasks) {
		return (
			<div className="mt-20 flex flex-col items-center gap-3 text-center">
				<p className="text-lg font-semibold">Add your first task</p>
				<p className="max-w-64 text-[14px] text-text-2">
					Things you want to do every day, week or month — or just once.
				</p>
				<Button variant="primary" onClick={onAdd}>
					Add task
				</Button>
			</div>
		);
	}
	const percent =
		view.total === 0 ? 100 : Math.round((view.done / view.total) * 100);
	const allDone =
		view.total > 0 &&
		view.overdue.length === 0 &&
		view.today.every((r) => r.kind === "done");
	return (
		<div>
			<div className="mt-2">
				<h1 className="text-[26px] font-semibold tracking-tight">
					{new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now)}
				</h1>
				<p className="min-h-5 text-[14px] text-text-2">
					{allDone
						? "All done for today"
						: `${view.done} of ${view.total} done today`}
				</p>
				<div
					role="progressbar"
					aria-label="Done today"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percent}
					className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
				>
					<div
						className="h-full rounded-full bg-success transition-[width] duration-300"
						style={{ width: `${percent}%` }}
					/>
				</div>
			</div>
			<Section
				title="Overdue"
				rows={view.overdue}
				now={now}
				onToggle={onToggle}
				celebratingKey={celebratingKey}
			/>
			<Section
				title="Today"
				rows={view.today}
				now={now}
				onToggle={onToggle}
				celebratingKey={celebratingKey}
			/>
			{view.upcoming.length > 0 ? (
				<div className="mt-4 flex justify-center">
					<Button variant="ghost" onClick={onToggleUpcoming}>
						{showUpcoming
							? "Hide upcoming"
							: `Show upcoming (${view.upcoming.length})`}
					</Button>
				</div>
			) : null}
			{showUpcoming ? (
				<Section
					title="Upcoming"
					rows={view.upcoming}
					now={now}
					onToggle={onToggle}
					celebratingKey={celebratingKey}
				/>
			) : null}
		</div>
	);
}
