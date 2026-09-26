import { Check, Repeat } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { cx } from "../../lib/cx";
import { Button } from "../../ui/Button";
import { ConfettiBurst } from "../../ui/ConfettiBurst";
import {
	cancelTaskHoldHaptics,
	startTaskHoldHapticRamp,
} from "../../ui/haptics";
import { rowLabel } from "./labels";
import type { TodayRow, TodayView } from "./model";

const COMPLETE_HOLD_MS = 2000;
const UNCOMPLETE_HOLD_MS = 5000;
const HOLD_PROGRESS_INTERVAL_MS = 25;
const REDUCED_MOTION_PROGRESS_INTERVAL_MS = 100;
const HOLD_MOVEMENT_TOLERANCE_PX = 20;
const UNCOMPLETE_FADE_IN_MS = 150;

type HoldFill = { amount: number; opacity: number };

function holdFillPath(progress: number) {
	const amount = Math.min(1, Math.max(0, progress));
	const top = (1 - amount) * 100;
	const amplitude = 8 * Math.min(1, amount * 4, (1 - amount) * 4);
	const crest = top + amplitude;
	const trough = top - amplitude;
	return [
		"M 0 100",
		`L 0 ${top}`,
		`C 138 ${top} 250 ${crest} 250 ${crest}`,
		`C 388 ${crest} 500 ${top} 500 ${top}`,
		`C 638 ${top} 750 ${trough} 750 ${trough}`,
		`C 888 ${trough} 1000 ${top} 1000 ${top}`,
		"L 1000 100 Z",
	].join(" ");
}

type ActiveHold = {
	pointerId: number;
	startedAt: number;
	durationMs: number;
	startX: number;
	startY: number;
	interval: ReturnType<typeof setInterval> | null;
};

function CheckCircle({
	row,
	celebrating,
	onClick,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onLostPointerCapture,
}: {
	row: TodayRow;
	celebrating: boolean;
	onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerCancel: () => void;
	onLostPointerCapture: () => void;
}) {
	const done = row.kind === "done";
	return (
		<Button
			variant="ghost"
			aria-label={
				done ? `Undo ${row.task.title}` : `Complete ${row.task.title}`
			}
			aria-pressed={done}
			onClick={onClick}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onLostPointerCapture={onLostPointerCapture}
			className="-m-2 relative size-11 shrink-0 touch-pan-y rounded-full p-0 text-text-2 hover:bg-surface-2 active:scale-90"
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
		</Button>
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
	const hold = useRef<ActiveHold | null>(null);
	const suppressTouchClick = useRef(false);
	const suppressTouchClickTimer = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [holdFill, setHoldFill] = useState<HoldFill>({ amount: 0, opacity: 0 });
	const clearTouchClickSuppression = () => {
		suppressTouchClick.current = false;
		if (suppressTouchClickTimer.current) {
			clearTimeout(suppressTouchClickTimer.current);
			suppressTouchClickTimer.current = null;
		}
	};
	const cancelHold = (pointerId?: number) => {
		const activeHold = hold.current;
		if (
			!activeHold ||
			(pointerId !== undefined && pointerId !== activeHold.pointerId)
		)
			return;
		if (activeHold.interval !== null) clearInterval(activeHold.interval);
		hold.current = null;
		setHoldFill({ amount: 0, opacity: 0 });
		cancelTaskHoldHaptics();
	};
	const completeHold = (activeHold: ActiveHold) => {
		if (hold.current !== activeHold) return;
		if (activeHold.interval !== null) clearInterval(activeHold.interval);
		hold.current = null;
		setHoldFill(done ? { amount: 0, opacity: 0 } : { amount: 1, opacity: 1 });
		cancelTaskHoldHaptics();
		onToggle(row);
	};
	const updateHold = (activeHold: ActiveHold) => {
		if (hold.current !== activeHold) return;
		const progress = Math.min(
			1,
			(Date.now() - activeHold.startedAt) / activeHold.durationMs,
		);
		const elapsedMs = Date.now() - activeHold.startedAt;
		const uncompleteDrain = Math.min(
			1,
			Math.max(
				0,
				(elapsedMs - UNCOMPLETE_FADE_IN_MS) /
					(activeHold.durationMs - UNCOMPLETE_FADE_IN_MS),
			),
		);
		setHoldFill(
			done
				? {
						amount: 1 - uncompleteDrain,
						opacity: Math.min(1, elapsedMs / UNCOMPLETE_FADE_IN_MS),
					}
				: { amount: progress, opacity: 1 },
		);
		if (progress >= 1) completeHold(activeHold);
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.pointerType !== "touch") {
			clearTouchClickSuppression();
			return;
		}
		if (hold.current) return;

		suppressTouchClick.current = true;
		if (suppressTouchClickTimer.current)
			clearTimeout(suppressTouchClickTimer.current);
		suppressTouchClickTimer.current = setTimeout(
			clearTouchClickSuppression,
			UNCOMPLETE_HOLD_MS + 1000,
		);

		const activeHold: ActiveHold = {
			pointerId: event.pointerId,
			startedAt: Date.now(),
			durationMs: done ? UNCOMPLETE_HOLD_MS : COMPLETE_HOLD_MS,
			startX: event.clientX,
			startY: event.clientY,
			interval: null,
		};
		hold.current = activeHold;
		setHoldFill(done ? { amount: 1, opacity: 0 } : { amount: 0, opacity: 1 });
		startTaskHoldHapticRamp(done ? "undo" : "complete", activeHold.durationMs);
		event.currentTarget.setPointerCapture?.(event.pointerId);

		const prefersReducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const intervalMs = prefersReducedMotion
			? REDUCED_MOTION_PROGRESS_INTERVAL_MS
			: HOLD_PROGRESS_INTERVAL_MS;
		activeHold.interval = setInterval(() => updateHold(activeHold), intervalMs);
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const activeHold = hold.current;
		if (!activeHold || activeHold.pointerId !== event.pointerId) return;
		updateHold(activeHold);
		if (hold.current === activeHold) cancelHold(event.pointerId);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const activeHold = hold.current;
		if (!activeHold || activeHold.pointerId !== event.pointerId) return;
		if (
			Math.hypot(
				event.clientX - activeHold.startX,
				event.clientY - activeHold.startY,
			) > HOLD_MOVEMENT_TOLERANCE_PX
		)
			cancelHold(event.pointerId);
	};
	const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
		if (event.detail === 0) {
			clearTouchClickSuppression();
			onToggle(row);
			return;
		}
		if (suppressTouchClick.current) {
			event.preventDefault();
			event.stopPropagation();
			clearTouchClickSuppression();
			return;
		}
		onToggle(row);
	};
	useEffect(
		() => () => {
			if (hold.current) {
				if (hold.current.interval !== null)
					clearInterval(hold.current.interval);
				cancelTaskHoldHaptics();
			}
			if (suppressTouchClickTimer.current)
				clearTimeout(suppressTouchClickTimer.current);
		},
		[],
	);
	return (
		<li className="relative overflow-hidden touch-pan-y">
			<svg
				aria-hidden="true"
				data-hold-fill
				className="pointer-events-none absolute inset-0 z-0 size-full"
				viewBox="0 0 1000 100"
				preserveAspectRatio="none"
			>
				<path
					className={done ? "fill-danger/15" : "fill-success/15"}
					d={holdFillPath(holdFill.amount)}
					style={{ opacity: holdFill.opacity }}
				/>
			</svg>
			<div className="relative z-10 flex items-center gap-3 border-b border-line py-3 last:border-0">
				<CheckCircle
					row={row}
					celebrating={celebrating}
					onClick={onClick}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={() => cancelHold()}
					onLostPointerCapture={() => cancelHold()}
				/>
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
			<Card className="gap-0 rounded-2xl p-0 ring-line">
				<CardContent className="px-4 py-0">
					<ul>
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
				</CardContent>
			</Card>
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
			<Empty className="mt-20 gap-3 border-0 p-0">
				<EmptyHeader>
					<EmptyTitle className="text-lg font-semibold">
						Add your first task
					</EmptyTitle>
					<EmptyDescription className="max-w-64 text-[14px] text-text-2">
						Things you want to do every day, week or month — or just once.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent className="w-auto">
					<Button variant="primary" onClick={onAdd}>
						Add task
					</Button>
				</EmptyContent>
			</Empty>
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
				<Progress
					value={percent}
					aria-label="Done today"
					className="mt-2 gap-0"
					trackClassName="h-1.5"
					indicatorClassName="bg-success transition-[width] duration-300"
				/>
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
