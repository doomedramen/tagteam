import type { MemberDto, TaskDto } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { BellRing, CircleAlert, CircleCheck, Clock3, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
	browserTimeZone,
	dayBounds,
	formatTime,
	localDate,
	useNow,
} from "../../lib/time";
import { useSession } from "../../session/session";
import {
	type ActivityItem,
	buildActivityFeed,
	groupActivityByDay,
} from "./model";

function dayLabel(date: string, now: number): string {
	const today = localDate(now);
	const yesterday = localDate(dayBounds(now).start - 1);
	if (date === today) return "Today";
	if (date === yesterday) return "Yesterday";
	const [year, month, day] = date.split("-").map(Number);
	return new Intl.DateTimeFormat(undefined, {
		weekday: "long",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function activityText(item: ActivityItem, currentUserId: string) {
	const actor = item.actorId === currentUserId ? "You" : item.actorName;
	switch (item.kind) {
		case "completed": {
			const status = item.completionStatus
				? ` ${item.completionStatus === "late" ? "late" : "on time"}`
				: "";
			return `${actor} completed ${item.taskTitle}${status}.`;
		}
		case "missed":
			return `${actor} missed ${item.taskTitle}.`;
		case "nudged": {
			const target = item.targetId === currentUserId ? "you" : item.targetName;
			return `${actor} nudged ${target} about ${item.taskTitle}.`;
		}
		case "created":
			return `${actor} added ${item.taskTitle}.`;
	}
}

function ActivityIcon({ item }: { item: ActivityItem }) {
	if (item.kind === "completed" && item.completionStatus === "late")
		return <Clock3 aria-hidden className="size-5 text-warning" />;
	if (item.kind === "completed")
		return <CircleCheck aria-hidden className="size-5 text-success" />;
	if (item.kind === "missed")
		return <CircleAlert aria-hidden className="size-5 text-danger" />;
	if (item.kind === "nudged")
		return <BellRing aria-hidden className="size-5 text-accent" />;
	return <Plus aria-hidden className="size-5 text-text-2" />;
}

function MemberFilter({
	members,
	value,
	onChange,
}: {
	members: MemberDto[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="flex min-h-11 items-center gap-2 rounded-xl bg-surface px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
			<span className="shrink-0 text-[13px] text-text-2">Member</span>
			<select
				aria-label="Filter by member"
				className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-text outline-none"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="all">All members</option>
				{[...members]
					.sort((a, b) => a.displayName.localeCompare(b.displayName))
					.map((member) => (
						<option key={member.userId} value={member.userId}>
							{member.displayName}
						</option>
					))}
			</select>
		</label>
	);
}

export function HistoryScreen() {
	const { store, activeGroupId, me } = useSession();
	const now = useNow();
	const [memberFilter, setMemberFilter] = useState("all");
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

	if (!activeGroupId || !members || !tasks || !events) return null;
	const selectedMember = members.some(
		(member) => member.userId === memberFilter,
	)
		? memberFilter
		: "all";
	const activities = buildActivityFeed({
		tasks,
		events,
		members,
		groupId: activeGroupId,
		now,
	}).filter(
		(item) =>
			selectedMember === "all" ||
			item.actorId === selectedMember ||
			item.targetId === selectedMember,
	);
	const days = groupActivityByDay(activities, browserTimeZone());
	const selectedName = members.find(
		(member) => member.userId === selectedMember,
	)?.displayName;

	return (
		<div className="mt-3 flex flex-col gap-5">
			<div className="flex items-end justify-between gap-3">
				<div>
					<h1 className="text-[26px] font-semibold tracking-tight">History</h1>
					<p className="text-[14px] text-text-2">Recent group activity</p>
				</div>
				<MemberFilter
					members={members}
					value={selectedMember}
					onChange={setMemberFilter}
				/>
			</div>

			{days.length > 0 ? (
				<div className="flex flex-col gap-5">
					{days.map((day) => (
						<section key={day.date}>
							<h2 className="mb-2 text-[14px] font-semibold text-text-2">
								{dayLabel(day.date, now)}
							</h2>
							<ul className="overflow-hidden rounded-2xl bg-surface px-4 ring-1 ring-line">
								{day.items.map((item) => (
									<li
										key={item.id}
										className="flex min-h-16 items-start gap-3 border-b border-line py-3 last:border-0"
									>
										<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
											<ActivityIcon item={item} />
										</span>
										<div className="min-w-0 flex-1">
											<p className="text-[14px] font-medium leading-5">
												<Link
													to={`/tasks/${item.taskId}`}
													className="rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
												>
													{activityText(item, me.user.id)}
												</Link>
											</p>
											<p className="mt-1 text-[12px] text-text-2">
												{formatTime(item.at)}
											</p>
										</div>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			) : (
				<p className="rounded-2xl bg-surface px-4 py-5 text-[14px] text-text-2 ring-1 ring-line">
					{selectedName
						? `No activity for ${selectedName} yet.`
						: "No group activity yet."}
				</p>
			)}
		</div>
	);
}
