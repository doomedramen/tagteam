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
const UNCOMPLETE_DRAIN_DELAY_MS = 150;

type HoldFill = {
	amount: number;
	phase: number;
	shape: number;
	cycles: number;
	visible: boolean;
};

function waveTopPath(
	progress: number,
	phase: number,
	shape: number,
	cycles: number,
) {
	const amount = Math.min(1, Math.max(0, progress));
	const top = (1 - amount) * 100;
	const amplitude = 3 * Math.min(1, amount * 4, (1 - amount) * 4);
	const segmentWidth = 125;
	const angularRate = (Math.PI * 2 * cycles) / 1000;
	const angleAt = (x: number) => x * angularRate + phase;
	const yAt = (x: number) => {
		const angle = angleAt(x);
		return (
			top +
			(amplitude * (Math.sin(angle) + 0.35 * Math.sin(angle / 2 + shape))) /
				1.35
		);
	};
	const slopeAt = (x: number) =>
		((amplitude * angularRate) / 1.35) *
		(Math.cos(angleAt(x)) + 0.175 * Math.cos(angleAt(x) / 2 + shape));
	const path = [`M 0 ${yAt(0)}`];
	for (let x = 0; x < 1000; x += segmentWidth) {
		const next = x + segmentWidth;
		path.push(
			`C ${x + segmentWidth / 3} ${yAt(x) + (slopeAt(x) * segmentWidth) / 3} ${next - segmentWidth / 3} ${yAt(next) - (slopeAt(next) * segmentWidth) / 3} ${next} ${yAt(next)}`,
		);
	}
	return path.join(" ");
}

function holdFillPath(
	progress: number,
	phase: number,
	shape: number,
	cycles: number,
) {
	return `${waveTopPath(progress, phase, shape, cycles)} L 1000 100 L 0 100 Z`;
}

type ActiveHold = {
	pointerId: number;
	startedAt: number;
	durationMs: number;
	startX: number;
	startY: number;
	reducedMotion: boolean;
	phaseOffset: number;
	shapeOffset: number;
	cycles: number;
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
			aria-description={
				done ? "Hold for 5 seconds to undo" : "Hold for 2 seconds to complete"
			}
			aria-pressed={done}
			onClick={onClick}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onLostPointerCapture={onLostPointerCapture}
			className="-m-2 relative size-11 shrink-0 touch-pan-y rounded-full p-0 text-text-2 hover:bg-surface-2"
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
	const suppressPointerClick = useRef(false);
	const suppressPointerClickTimer = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const [holdFill, setHoldFill] = useState<HoldFill>({
		amount: 0,
		phase: 0,
		shape: 0,
		cycles: 2,
		visible: false,
	});
	const clearPointerClickSuppression = () => {
		suppressPointerClick.current = false;
		if (suppressPointerClickTimer.current) {
			clearTimeout(suppressPointerClickTimer.current);
			suppressPointerClickTimer.current = null;
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
		setHoldFill({ amount: 0, phase: 0, shape: 0, cycles: 2, visible: false });
		cancelTaskHoldHaptics();
	};
	const completeHold = (activeHold: ActiveHold) => {
		if (hold.current !== activeHold) return;
		if (activeHold.interval !== null) clearInterval(activeHold.interval);
		hold.current = null;
		setHoldFill(
			done
				? { amount: 0, phase: 0, shape: 0, cycles: 2, visible: false }
				: { amount: 1, phase: 0, shape: 0, cycles: 2, visible: true },
		);
		cancelTaskHoldHaptics();
		onToggle(row);
	};
	const updateHold = (activeHold: ActiveHold) => {
		if (hold.current !== activeHold) return;
		const elapsedMs = Date.now() - activeHold.startedAt;
		const progress = Math.min(1, elapsedMs / activeHold.durationMs);
		const phase =
			activeHold.phaseOffset +
			(activeHold.reducedMotion ? 0 : (elapsedMs / 900) * Math.PI * 2);
		const uncompleteDrain = Math.min(
			1,
			Math.max(
				0,
				(elapsedMs - UNCOMPLETE_DRAIN_DELAY_MS) /
					(activeHold.durationMs - UNCOMPLETE_DRAIN_DELAY_MS),
			),
		);
		setHoldFill(
			done
				? {
						amount: 1 - uncompleteDrain,
						phase,
						shape: activeHold.shapeOffset,
						cycles: activeHold.cycles,
						visible: true,
					}
				: {
						amount: progress,
						phase,
						shape: activeHold.shapeOffset,
						cycles: activeHold.cycles,
						visible: true,
					},
		);
		if (progress >= 1) completeHold(activeHold);
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		if (hold.current) return;

		suppressPointerClick.current = true;
		if (suppressPointerClickTimer.current)
			clearTimeout(suppressPointerClickTimer.current);
		suppressPointerClickTimer.current = setTimeout(
			clearPointerClickSuppression,
			UNCOMPLETE_HOLD_MS + 1000,
		);
		const reducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const activeHold: ActiveHold = {
			pointerId: event.pointerId,
			startedAt: Date.now(),
			durationMs: done ? UNCOMPLETE_HOLD_MS : COMPLETE_HOLD_MS,
			startX: event.clientX,
			startY: event.clientY,
			reducedMotion,
			phaseOffset: Math.random() * Math.PI * 2,
			shapeOffset: Math.random() * Math.PI * 2,
			cycles: 1.5 + Math.random() * 0.75,
			interval: null,
		};
		hold.current = activeHold;
		setHoldFill(
			done
				? {
						amount: 1,
						phase: activeHold.phaseOffset,
						shape: activeHold.shapeOffset,
						cycles: activeHold.cycles,
						visible: true,
					}
				: {
						amount: 0,
						phase: activeHold.phaseOffset,
						shape: activeHold.shapeOffset,
						cycles: activeHold.cycles,
						visible: true,
					},
		);
		startTaskHoldHapticRamp(done ? "undo" : "complete", activeHold.durationMs);
		try {
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} catch {
			// The hold still works if the browser cannot capture this pointer.
		}

		const intervalMs = reducedMotion
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
			clearPointerClickSuppression();
			onToggle(row);
			return;
		}
		if (suppressPointerClick.current) {
			event.preventDefault();
			event.stopPropagation();
			clearPointerClickSuppression();
			return;
		}
		// Assistive technology can dispatch a click without pointer events.
		onToggle(row);
	};
	useEffect(
		() => () => {
			if (hold.current) {
				if (hold.current.interval !== null)
					clearInterval(hold.current.interval);
				cancelTaskHoldHaptics();
			}
			if (suppressPointerClickTimer.current)
				clearTimeout(suppressPointerClickTimer.current);
		},
		[],
	);
	return (
		<li className="-mx-4 relative overflow-hidden px-4 touch-pan-y">
			<svg
				aria-hidden="true"
				data-hold-fill
				className={cx(
					"pointer-events-none absolute inset-0 z-0 size-full",
					!holdFill.visible && "hidden",
				)}
				viewBox="0 0 1000 100"
				preserveAspectRatio="none"
			>
				<path
					className={done ? "fill-danger-soft" : "fill-success-soft"}
					d={holdFillPath(
						holdFill.amount,
						holdFill.phase,
						holdFill.shape,
						holdFill.cycles,
					)}
				/>
				<path
					data-wave-edge
					className={done ? "stroke-danger" : "stroke-success"}
					d={waveTopPath(
						holdFill.amount,
						holdFill.phase,
						holdFill.shape,
						holdFill.cycles,
					)}
					fill="none"
					strokeWidth="2"
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
							row.kind === "done" && "text-text-2 line-through",
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
			<Card className="gap-0 overflow-hidden rounded-2xl p-0 ring-line">
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
