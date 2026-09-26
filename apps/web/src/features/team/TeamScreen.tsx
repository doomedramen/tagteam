import type { EventDto, MemberDto, TaskDto } from "@tagteam/core";
import { NUDGE_INTERVAL_MS } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { BellRing, ChevronDown, UserRoundPlus } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { dayBounds, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { rowLabel } from "../today/labels";
import type { TodayRow, TodayView } from "../today/model";
import { InviteSheet } from "./InviteSheet";
import { buildTeam, type TeamMemberView } from "./model";

const GROUPS = [
	{ title: "Overdue", rows: (today: TodayView) => today.overdue },
	{ title: "Today", rows: (today: TodayView) => today.today },
	{ title: "Upcoming", rows: (today: TodayView) => today.upcoming },
] as const;

function latestNudge(events: EventDto[], taskId: string, userId: string) {
	return events.reduce<number | null>((latest, event) => {
		if (
			event.taskId !== taskId ||
			event.userId !== userId ||
			event.type !== "nudged"
		)
			return latest;
		return Math.max(latest ?? 0, event.at);
	}, null);
}

function nudgeLabel(at: number, now: number) {
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	return minutes < 1 ? "Nudged just now" : `Nudged ${minutes}m ago`;
}

function TaskRows({
	member,
	rows,
	currentUserId,
	events,
	now,
	onNudge,
}: {
	member: TeamMemberView;
	rows: TodayRow[];
	currentUserId: string;
	events: EventDto[];
	now: number;
	onNudge: (taskId: string) => void;
}) {
	return (
		<ul className="flex flex-col">
			{rows.map((row) => {
				const nudgeAt = latestNudge(events, row.task.id, currentUserId);
				const wasRecentlyNudged =
					nudgeAt !== null && now - nudgeAt < NUDGE_INTERVAL_MS;
				return (
					<li
						key={`${row.task.id}:${row.key}:${row.kind}`}
						className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-0"
					>
						<span
							aria-hidden
							className={
								row.kind === "overdue"
									? "size-2 shrink-0 rounded-full bg-danger"
									: row.kind === "done"
										? "size-2 shrink-0 rounded-full bg-success"
										: "size-2 shrink-0 rounded-full bg-text-3"
							}
						/>
						<Link
							to={`/tasks/${row.task.id}`}
							className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
						>
							<p className="truncate text-[14px] font-medium">
								{row.task.title}
							</p>
							<p className="text-[13px] text-text-2">
								{rowLabel(row, now, { tz: row.task.timezone })}
							</p>
						</Link>
						{row.kind === "overdue" &&
						member.member.userId !== currentUserId ? (
							wasRecentlyNudged && nudgeAt !== null ? (
								<span className="shrink-0 text-[12px] font-medium text-text-2">
									{nudgeLabel(nudgeAt, now)}
								</span>
							) : (
								<Button
									aria-label={`Nudge ${member.member.displayName} about ${row.task.title}`}
									className="min-h-10 shrink-0 rounded-full px-3 text-[13px]"
									onClick={() => onNudge(row.task.id)}
								>
									<BellRing aria-hidden className="size-4" />
									Nudge
								</Button>
							)
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

function MemberRow({
	view,
	currentUserId,
	expanded,
	onToggle,
	children,
}: {
	view: TeamMemberView;
	currentUserId: string;
	expanded: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	const { member, today } = view;
	const todayTotal = today.today.length;
	const progress =
		todayTotal === 0 ? 0 : Math.round((today.done / todayTotal) * 100);
	const id = `member-${member.userId}-tasks`;
	return (
		<li className="border-b border-line last:border-0">
			<Button
				variant="ghost"
				aria-expanded={expanded}
				aria-controls={id}
				onClick={onToggle}
				className="min-h-20 w-full justify-start gap-3 rounded-none px-0 py-3 text-left text-text hover:bg-transparent active:bg-transparent"
			>
				<Avatar name={member.displayName} color={member.avatarColor} />
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate text-[15px] font-semibold">
							{member.displayName}
						</span>
						{member.userId === currentUserId ? (
							<span className="shrink-0 text-[12px] text-text-2">You</span>
						) : null}
					</span>
					<span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-text-2">
						<span>
							{todayTotal > 0
								? `${today.done} of ${todayTotal} today`
								: "No tasks today"}
						</span>
						{today.overdue.length > 0 ? (
							<Badge
								variant="destructive"
								className="h-auto rounded-full border-0 bg-danger-soft px-2 py-0.5 text-danger"
							>
								{today.overdue.length} overdue
							</Badge>
						) : null}
					</span>
					{todayTotal > 0 ? (
						<Progress
							value={progress}
							aria-label={`${member.displayName} tasks completed today`}
							className="mt-2 gap-0"
							trackClassName="h-1"
							indicatorClassName="bg-success transition-[width] duration-200"
						/>
					) : null}
				</span>
				<ChevronDown
					aria-hidden
					className={`size-5 shrink-0 text-text-3 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
				/>
			</Button>
			{expanded ? (
				<div id={id} className="border-t border-line pb-3 pl-12 pr-1">
					{children}
				</div>
			) : null}
		</li>
	);
}

export function TeamScreen() {
	const { me, store, engine, activeGroupId } = useSession();
	const toast = useToast();
	const now = useNow();
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [inviteOpen, setInviteOpen] = useState(false);
	const inFlight = useRef(new Set<string>());
	const members = useLiveQuery(
		() =>
			activeGroupId
				? store.members.where("groupId").equals(activeGroupId).toArray()
				: Promise.resolve([] as MemberDto[]),
		[store, activeGroupId],
	);
	const tasks = useLiveQuery(
		() =>
			activeGroupId
				? store.tasks.where("groupId").equals(activeGroupId).toArray()
				: Promise.resolve([] as TaskDto[]),
		[store, activeGroupId],
	);
	const events = useLiveQuery(async () => {
		const taskIds = (tasks ?? []).map((task) => task.id);
		return taskIds.length > 0
			? store.events.where("taskId").anyOf(taskIds).toArray()
			: [];
	}, [store, tasks]);
	const group = me.groups.find((item) => item.id === activeGroupId);

	if (!activeGroupId || !members || !tasks || !events || !group) return null;
	const team = buildTeam({
		members,
		tasks,
		events,
		groupId: activeGroupId,
		userId: me.user.id,
		now,
		day: dayBounds(now),
	});

	const toggleMember = (userId: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});
	const nudge = async (taskId: string) => {
		if (inFlight.current.has(taskId)) return;
		inFlight.current.add(taskId);
		try {
			await engine.enqueue({
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "task.nudge",
				taskId,
			});
		} catch {
			toast.show({ message: "Could not nudge. Try again." });
		} finally {
			inFlight.current.delete(taskId);
		}
	};

	return (
		<div className="mt-3">
			<div className="mb-4 flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-[26px] font-semibold tracking-tight">Team</h1>
					<p className="text-[14px] text-text-2">Today’s shared progress</p>
				</div>
				<Button aria-label="Invite someone" onClick={() => setInviteOpen(true)}>
					<UserRoundPlus aria-hidden className="size-4" />
					Invite
				</Button>
			</div>

			{team.length > 0 ? (
				<Card className="gap-0 rounded-2xl p-0 ring-line">
					<CardContent className="px-4 py-0">
						<ul>
							{team.map((view) => {
								const isExpanded = expanded.has(view.member.userId);
								const hasRows = GROUPS.some(
									(grouping) => grouping.rows(view.today).length > 0,
								);
								return (
									<MemberRow
										key={view.member.userId}
										view={view}
										currentUserId={me.user.id}
										expanded={isExpanded}
										onToggle={() => toggleMember(view.member.userId)}
									>
										{hasRows ? (
											GROUPS.map((grouping) => {
												const groupRows = grouping.rows(view.today);
												if (groupRows.length === 0) return null;
												return (
													<section
														key={grouping.title}
														className="pt-3 first:pt-4"
													>
														<h3 className="mb-1 text-[12px] font-semibold text-text-2">
															{grouping.title}
														</h3>
														<TaskRows
															member={view}
															rows={groupRows}
															currentUserId={me.user.id}
															events={events}
															now={now}
															onNudge={(taskId) => void nudge(taskId)}
														/>
													</section>
												);
											})
										) : (
											<p className="py-4 text-[14px] text-text-2">
												No tasks to show.
											</p>
										)}
									</MemberRow>
								);
							})}
						</ul>
					</CardContent>
				</Card>
			) : (
				<Empty className="rounded-2xl border-0 bg-surface px-4 py-5 ring-1 ring-line">
					<EmptyHeader>
						<EmptyTitle className="text-[15px] font-semibold">
							No group members yet.
						</EmptyTitle>
					</EmptyHeader>
				</Empty>
			)}

			<InviteSheet
				open={inviteOpen}
				onClose={() => setInviteOpen(false)}
				groupId={activeGroupId}
				groupName={group.name}
				now={now}
			/>
		</div>
	);
}
