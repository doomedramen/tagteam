import type {
	EventDto,
	GroupDto,
	MemberDto,
	PullResponse,
	SuggestionDto,
	TaskDto,
} from "@tagteam/core";
import { and, eq, gt, inArray, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import {
	groups,
	membership,
	profile,
	suggestion,
	task,
	taskEvent,
} from "../db/schema";
import { currentSeq } from "../db/seq";

export type {
	EventDto,
	GroupDto,
	MemberDto,
	PullResponse,
	SuggestionDto,
	TaskDto,
};

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
			suggestions: [],
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
				.orderBy(groups.name)
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
					emoji: task.emoji,
					color: task.color,
					timezone: task.timezone,
					startDate: task.startDate,
					rules: task.rules,
					archivedAt: task.archivedAt,
					createdAt: task.createdAt,
					suggestedBy: task.suggestedBy,
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
			// The only per-user filter in pull, and the only place the privacy rule lives:
			// a suggestion belongs to its sender and recipient, not to the group.
			suggestions: tx
				.select({
					id: suggestion.id,
					groupId: suggestion.groupId,
					fromUserId: suggestion.fromUserId,
					toUserId: suggestion.toUserId,
					title: suggestion.title,
					notes: suggestion.notes,
					emoji: suggestion.emoji,
					color: suggestion.color,
					startDate: suggestion.startDate,
					dueTime: suggestion.dueTime,
					rule: suggestion.rule,
					status: suggestion.status,
					taskId: suggestion.taskId,
					createdAt: suggestion.createdAt,
					resolvedAt: suggestion.resolvedAt,
				})
				.from(suggestion)
				.where(
					and(
						visible(suggestion.groupId, suggestion.seq),
						or(
							eq(suggestion.fromUserId, userId),
							eq(suggestion.toUserId, userId),
						),
					),
				)
				.orderBy(suggestion.seq)
				.all(),
		};
	});
}
