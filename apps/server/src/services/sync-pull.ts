import type { RuleVersion } from "@tagteam/core";
import { and, eq, gt, inArray, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { groups, membership, profile, task, taskEvent } from "../db/schema";
import { currentSeq } from "../db/seq";

export interface GroupDto {
	id: string;
	name: string;
}
export interface MemberDto {
	groupId: string;
	userId: string;
	displayName: string;
	avatarColor: string;
	role: "admin" | "member";
	joinedAt: number;
	leftAt: number | null;
}
export interface TaskDto {
	id: string;
	groupId: string;
	ownerId: string;
	title: string;
	notes: string | null;
	timezone: string;
	startDate: string;
	rules: RuleVersion[];
	archivedAt: number | null;
	createdAt: number;
}
export interface EventDto {
	id: string;
	taskId: string;
	userId: string;
	type: "completed" | "uncompleted" | "nudged";
	occurrenceKey: string | null;
	refEventId: string | null;
	at: number;
}
export interface PullResponse {
	cursor: number;
	groups: GroupDto[];
	members: MemberDto[];
	tasks: TaskDto[];
	events: EventDto[];
	removedGroupIds: string[];
}

/** Everything visible to `userId` that changed after `cursor`, plus full snapshots of newly joined groups. */
export function pull(db: Db, userId: string, cursor: number): PullResponse {
	return db.transaction((tx): PullResponse => {
		const now = currentSeq(tx);
		const mine = tx
			.select({
				groupId: membership.groupId,
				leftAt: membership.leftAt,
				seq: membership.seq,
			})
			.from(membership)
			.where(eq(membership.userId, userId))
			.all();
		const active = mine.filter((m) => m.leftAt === null).map((m) => m.groupId);
		const fresh = mine
			.filter((m) => m.leftAt === null && m.seq > cursor)
			.map((m) => m.groupId);
		const removedGroupIds = mine
			.filter((m) => m.leftAt !== null && m.seq > cursor)
			.map((m) => m.groupId);
		const empty: PullResponse = {
			cursor: now,
			groups: [],
			members: [],
			tasks: [],
			events: [],
			removedGroupIds,
		};
		if (active.length === 0) return empty;

		/** In an active group, and either the group is fresh or one of `seqs` moved past the cursor. */
		const visible = (
			groupColumn: SQLiteColumn,
			...seqs: SQLiteColumn[]
		): SQL => {
			const changed = seqs.map((s) => gt(s, cursor));
			const freshOrChanged =
				fresh.length > 0
					? or(inArray(groupColumn, fresh), ...changed)
					: or(...changed);
			// biome-ignore lint/style/noNonNullAssertion: `changed` always has at least one clause, so `or` is never undefined.
			return and(inArray(groupColumn, active), freshOrChanged!)!;
		};

		return {
			...empty,
			groups: tx
				.select({ id: groups.id, name: groups.name })
				.from(groups)
				.where(visible(groups.id, groups.seq))
				.all(),
			members: tx
				.select({
					groupId: membership.groupId,
					userId: membership.userId,
					displayName: profile.displayName,
					avatarColor: profile.avatarColor,
					role: membership.role,
					joinedAt: membership.joinedAt,
					leftAt: membership.leftAt,
				})
				.from(membership)
				.innerJoin(profile, eq(profile.userId, membership.userId))
				.where(visible(membership.groupId, membership.seq, profile.seq))
				.orderBy(membership.joinedAt)
				.all(),
			tasks: tx
				.select({
					id: task.id,
					groupId: task.groupId,
					ownerId: task.ownerId,
					title: task.title,
					notes: task.notes,
					timezone: task.timezone,
					startDate: task.startDate,
					rules: task.rules,
					archivedAt: task.archivedAt,
					createdAt: task.createdAt,
				})
				.from(task)
				.where(visible(task.groupId, task.seq))
				.orderBy(task.seq)
				.all(),
			events: tx
				.select({
					id: taskEvent.id,
					taskId: taskEvent.taskId,
					userId: taskEvent.userId,
					type: taskEvent.type,
					occurrenceKey: taskEvent.occurrenceKey,
					refEventId: taskEvent.refEventId,
					at: taskEvent.at,
				})
				.from(taskEvent)
				.where(visible(taskEvent.groupId, taskEvent.seq))
				.orderBy(taskEvent.seq)
				.all(),
		};
	});
}
