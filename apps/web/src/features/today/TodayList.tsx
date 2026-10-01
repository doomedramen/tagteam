import { ArrowRight, Check, Repeat, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
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
import { rowLabel } from "./labels";
import type { TodayRow, TodayView } from "./model";

const SWIPE_THRESHOLD_PX = 88;
const SWIPE_MAX_PX = 120;
const SWIPE_DIRECTION_SLOP_PX = 10;

type ActiveSwipe = {
	pointerId: number;
	startX: number;
	startY: number;
	dragging: boolean;
};

function CheckCircle({
	row,
	celebrating,
	onClick,
}: {
	row: TodayRow;
	celebrating: boolean;
	onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
	const done = row.kind === "done";
	return (
		<Button
			variant="ghost"
			aria-label={
				done ? `Undo ${row.task.title}` : `Complete ${row.task.title}`
			}
			aria-description={
				done
					? "Tap to mark incomplete. You can also swipe right."
					: "Tap to complete. You can also swipe right."
			}
			aria-pressed={done}
			onClick={onClick}
			className="-m-2 relative size-12 shrink-0 touch-pan-y rounded-full p-0 text-text-2 hover:bg-surface-2"
		>
			{done && celebrating ? <ConfettiBurst /> : null}
			<span
				className={cx(
					"flex size-[26px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 motion-safe:active:scale-90",
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
	const swipe = useRef<ActiveSwipe | null>(null);
	const suppressClick = useRef(false);
	const [offset, setOffset] = useState(0);
	const [dragging, setDragging] = useState(false);
	const cancelSwipe = (pointerId: number) => {
		if (swipe.current?.pointerId !== pointerId) return;
		swipe.current = null;
		setOffset(0);
		setDragging(false);
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>) => {
		if (event.button !== 0 || event.isPrimary === false || swipe.current)
			return;
		suppressClick.current = false;
		swipe.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			dragging: false,
		};
	};
	const updateSwipe = (event: ReactPointerEvent<HTMLLIElement>) => {
		const active = swipe.current;
		if (!active || active.pointerId !== event.pointerId) return 0;
		const dx = event.clientX - active.startX;
		const dy = Math.abs(event.clientY - active.startY);
		if (!active.dragging) {
			if (Math.max(Math.abs(dx), dy) < SWIPE_DIRECTION_SLOP_PX) return 0;
			suppressClick.current = true;
			if (dx <= dy) {
				cancelSwipe(event.pointerId);
				return 0;
			}
			active.dragging = true;
			setDragging(true);
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Pointer events still bubble from the row if capture is unavailable.
			}
		}
		const distance = Math.min(SWIPE_MAX_PX, Math.max(0, dx));
		setOffset(distance);
		return distance;
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
		updateSwipe(event);
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLLIElement>) => {
		if (swipe.current?.pointerId !== event.pointerId) return;
		const distance = updateSwipe(event);
		cancelSwipe(event.pointerId);
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (distance >= SWIPE_THRESHOLD_PX) onToggle(row);
	};
	const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
		// Drag-generated clicks are suppressed by the row before reaching this button.
		if (!event.defaultPrevented) onToggle(row);
	};
	const ready = offset >= SWIPE_THRESHOLD_PX;
	return (
		<li
			className="-mx-4 relative touch-pan-y overflow-hidden select-none"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={(event) => cancelSwipe(event.pointerId)}
			onPointerLeave={(event) => {
				if (!swipe.current?.dragging && event.pointerType === "mouse") {
					cancelSwipe(event.pointerId);
				}
			}}
			onLostPointerCapture={(event) => {
				// Touch capture transfers from the pressed child to the row during a swipe.
				if (event.target === event.currentTarget) cancelSwipe(event.pointerId);
			}}
			onClickCapture={(event) => {
				if (suppressClick.current && event.detail !== 0) {
					event.preventDefault();
					event.stopPropagation();
					suppressClick.current = false;
				}
			}}
		>
			<div
				aria-hidden="true"
				data-swipe-action
				data-ready={ready}
				className={cx(
					"pointer-events-none absolute inset-0 flex items-center gap-2 px-4 text-text",
					done ? "bg-accent-soft" : "bg-success-soft",
				)}
			>
				{ready ? (
					done ? (
						<Undo2 className="size-4" />
					) : (
						<Check className="size-4" />
					)
				) : (
					<ArrowRight className="size-4" />
				)}
				<span className="text-[13px] font-medium">
					{done ? "Reopen" : "Done"}
				</span>
			</div>
			<div
				data-swipe-content
				className={cx(
					"relative z-10 flex items-center gap-3 border-b border-line bg-card px-4 py-3",
					!dragging &&
						"motion-safe:transition-transform motion-safe:duration-150",
				)}
				style={{ transform: `translateX(${offset}px)` }}
			>
				<CheckCircle row={row} celebrating={celebrating} onClick={onClick} />
				<Link
					to={`/tasks/${row.task.id}`}
					draggable={false}
					className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
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
	hasIncoming = false,
	incoming,
	outgoing,
}: {
	view: TodayView;
	now: number;
	showUpcoming: boolean;
	onToggleUpcoming: () => void;
	onToggle: (row: TodayRow) => void;
	celebratingKey: string | null;
	onAdd: () => void;
	/** Whether `incoming` renders any cards; they replace the empty-state prompt. */
	hasIncoming?: boolean;
	/** Suggestion cards addressed to me, shown above the task sections. */
	incoming?: ReactNode;
	/** The "Suggested by you" section, shown at the bottom. */
	outgoing?: ReactNode;
}) {
	const percent =
		view.total === 0 ? 100 : Math.round((view.done / view.total) * 100);
	const allDone =
		view.total > 0 &&
		view.overdue.length === 0 &&
		view.today.every((r) => r.kind === "done");
	return (
		<AnimatePresence initial={false} mode="sync">
			{!view.hasTasks ? (
				<motion.div
					key="empty"
					initial={{ opacity: 0, transform: "translateY(8px)" }}
					animate={{ opacity: 1, transform: "translateY(0px)" }}
					exit={{ opacity: 0, transform: "translateY(-4px)" }}
					transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
				>
					{incoming}
					{hasIncoming ? null : (
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
					)}
					{outgoing}
				</motion.div>
			) : (
				<motion.div
					key="populated"
					initial={{ opacity: 0, transform: "translateY(8px)" }}
					animate={{ opacity: 1, transform: "translateY(0px)" }}
					exit={{ opacity: 0, transform: "translateY(-4px)" }}
					transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
				>
					<div className="mt-2">
						<h1 className="text-[26px] font-semibold tracking-tight">
							{new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
								now,
							)}
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
							indicatorClassName="bg-success motion-safe:transition-transform duration-300 ease-[var(--ease-in-out)]"
						/>
					</div>
					<p className="mt-3 text-[13px] text-text-2">
						Tap a circle to complete or reopen. Swipe right works too.
					</p>
					{incoming}
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
					<AnimatePresence initial={false}>
						{showUpcoming && view.upcoming.length > 0 ? (
							<motion.div
								key="upcoming"
								initial={{ opacity: 0, transform: "translateY(8px)" }}
								animate={{ opacity: 1, transform: "translateY(0px)" }}
								exit={{ opacity: 0, transform: "translateY(-4px)" }}
								transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
							>
								<Section
									title="Upcoming"
									rows={view.upcoming}
									now={now}
									onToggle={onToggle}
									celebratingKey={celebratingKey}
								/>
							</motion.div>
						) : null}
					</AnimatePresence>
					{outgoing}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
