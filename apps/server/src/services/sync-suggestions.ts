import {
	MAX_PENDING_SUGGESTIONS,
	type SuggestionMutation,
} from "@tagteam/core";
import { and, count, eq } from "drizzle-orm";
import { suggestion, task } from "../db/schema";
import { nextSeq } from "../db/seq";
import { isActiveMember } from "./groups";
import type { Outcome, Tx } from "./sync-push";

/** The suggestion, but only to its sender or recipient: for anyone else it does not exist. */
function visibleSuggestion(tx: Tx, suggestionId: string, userId: string) {
	const row = tx
		.select()
		.from(suggestion)
		.where(eq(suggestion.id, suggestionId))
		.get();
	return row && (row.fromUserId === userId || row.toUserId === userId)
		? row
		: undefined;
}

/** Applies one suggestion mutation inside the caller's push transaction. */
export function applySuggestionMutation(
	tx: Tx,
	userId: string,
	m: SuggestionMutation,
	at: number,
): Outcome {
	if (m.type === "suggestion.create") {
		if (!isActiveMember(tx, m.groupId, userId))
			return { reason: "not a member of this group" };
		if (m.toUserId === userId)
			return { reason: "you can't suggest a task to yourself" };
		if (!isActiveMember(tx, m.groupId, m.toUserId))
			return { reason: "recipient is not a member of this group" };
		if (
			tx
				.select({ id: suggestion.id })
				.from(suggestion)
				.where(eq(suggestion.id, m.suggestionId))
				.get()
		)
			return { reason: "suggestion already exists" };
		const pending =
			tx
				.select({ value: count() })
				.from(suggestion)
				.where(
					and(
						eq(suggestion.groupId, m.groupId),
						eq(suggestion.fromUserId, userId),
						eq(suggestion.toUserId, m.toUserId),
						eq(suggestion.status, "pending"),
					),
				)
				.get()?.value ?? 0;
		if (pending >= MAX_PENDING_SUGGESTIONS)
			return { reason: "too many pending suggestions" };
		tx.insert(suggestion)
			.values({
				id: m.suggestionId,
				groupId: m.groupId,
				fromUserId: userId,
				toUserId: m.toUserId,
				title: m.title.trim(),
				notes: m.notes,
				emoji: m.emoji ?? null,
				color: m.color ?? null,
				startDate: m.startDate,
				dueTime: m.dueTime,
				rule: m.rule,
				status: "pending",
				taskId: null,
				createdAt: at,
				resolvedAt: null,
				seq: nextSeq(tx),
			})
			.run();
		return { groupId: null, pokeUserIds: [userId, m.toUserId] };
	}

	const current = visibleSuggestion(tx, m.suggestionId, userId);
	if (!current) return { reason: "suggestion not found" };
	const pair = [current.fromUserId, current.toUserId];
	const resolve = (changes: Partial<typeof suggestion.$inferInsert>) =>
		tx
			.update(suggestion)
			.set({ ...changes, resolvedAt: at, seq: nextSeq(tx) })
			.where(eq(suggestion.id, current.id))
			.run();

	switch (m.type) {
		case "suggestion.accept": {
			if (current.toUserId !== userId)
				return { reason: "suggestion is not addressed to you" };
			if (current.status !== "pending")
				return { reason: "suggestion is no longer pending" };
			if (!isActiveMember(tx, current.groupId, userId))
				return { reason: "not a member of this group" };
			if (m.startDate < current.startDate)
				return { reason: "startDate is before the suggested start" };
			if (
				tx.select({ id: task.id }).from(task).where(eq(task.id, m.taskId)).get()
			)
				return { reason: "task already exists" };
			tx.insert(task)
				.values({
					id: m.taskId,
					groupId: current.groupId,
					ownerId: userId,
					title: current.title,
					notes: current.notes,
					emoji: current.emoji,
					color: current.color,
					timezone: m.timezone,
					startDate: m.startDate,
					rules: [
						{
							effectiveFrom: m.startDate,
							rule: current.rule,
							dueTime: current.dueTime,
						},
					],
					archivedAt: null,
					createdAt: at,
					clocks: {
						title: at,
						notes: at,
						schedule: at,
						archive: at,
						emoji: at,
						color: at,
					},
					suggestedBy: current.fromUserId,
					seq: nextSeq(tx),
				})
				.run();
			resolve({ status: "accepted", taskId: m.taskId });
			return { groupId: current.groupId, pokeUserIds: pair };
		}
		case "suggestion.decline": {
			if (current.toUserId !== userId)
				return { reason: "suggestion is not addressed to you" };
			if (current.status !== "pending")
				return { reason: "suggestion is no longer pending" };
			resolve({ status: "declined" });
			return { groupId: null, pokeUserIds: pair };
		}
		case "suggestion.withdraw": {
			if (current.fromUserId !== userId)
				return { reason: "not your suggestion" };
			if (current.status !== "pending" && current.status !== "declined")
				return { reason: "suggestion can no longer be withdrawn" };
			resolve({ status: "withdrawn" });
			return { groupId: null, pokeUserIds: pair };
		}
	}
}
