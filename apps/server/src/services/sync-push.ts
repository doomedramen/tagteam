import {
	MAX_CLOCK_SKEW_MS,
	type Mutation,
	type MutationResult,
	mutationErrors,
	NUDGE_INTERVAL_MS,
	type RuleVersion,
	withScheduleVersion,
} from "@tagteam/core";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { appliedMutation, task, taskEvent } from "../db/schema";
import { nextSeq } from "../db/seq";
import { isActiveMember } from "./groups";

export type { MutationResult };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Outcome = { groupId: string } | { reason: string } | { groupId: null };

const OWNER_ONLY = new Set<Mutation["type"]>([
	"task.update",
	"task.schedule",
	"task.archive",
	"task.complete",
	"task.uncomplete",
]);

/** Applies client mutations in order, each atomically. Returns per-mutation results and the groups that changed. */
export function applyMutations(
	db: Db,
	userId: string,
	inputs: unknown[],
	now: number,
): { results: MutationResult[]; groupIds: Set<string> } {
	const results: MutationResult[] = [];
	const groupIds = new Set<string>();
	for (const input of inputs) {
		const errors = mutationErrors(input);
		const id =
			typeof (input as { id?: unknown } | null)?.id === "string"
				? (input as { id: string }).id
				: "";
		if (errors.length > 0) {
			results.push({
				id,
				status: "rejected",
				reason: `invalid: ${errors.join("; ")}`,
			});
			continue;
		}
		const m = input as Mutation;
		const result = db.transaction((tx): MutationResult => {
			if (
				tx
					.select({ id: appliedMutation.id })
					.from(appliedMutation)
					.where(eq(appliedMutation.id, m.id))
					.get()
			) {
				return { id: m.id, status: "duplicate" };
			}
			const at = Math.min(m.at, now + MAX_CLOCK_SKEW_MS);
			const outcome = applyOne(tx, userId, m, at, now);
			if ("reason" in outcome)
				return { id: m.id, status: "rejected", reason: outcome.reason };
			tx.insert(appliedMutation)
				.values({ id: m.id, userId, appliedAt: now })
				.run();
			if (outcome.groupId) groupIds.add(outcome.groupId);
			return { id: m.id, status: "applied" };
		});
		results.push(result);
	}
	return { results, groupIds };
}

function applyOne(
	tx: Tx,
	userId: string,
	m: Mutation,
	at: number,
	now: number,
): Outcome {
	if (m.type === "task.create") {
		if (!isActiveMember(tx, m.groupId, userId))
			return { reason: "not a member of this group" };
		if (
			tx.select({ id: task.id }).from(task).where(eq(task.id, m.taskId)).get()
		)
			return { reason: "task already exists" };
		tx.insert(task)
			.values({
				id: m.taskId,
				groupId: m.groupId,
				ownerId: userId,
				title: m.title.trim(),
				notes: m.notes,
				timezone: m.timezone,
				startDate: m.startDate,
				rules: [
					{ effectiveFrom: m.startDate, rule: m.rule, dueTime: m.dueTime },
				],
				archivedAt: null,
				createdAt: at,
				clocks: { title: at, notes: at, schedule: at, archive: at },
				seq: nextSeq(tx),
			})
			.run();
		return { groupId: m.groupId };
	}

	const current = tx.select().from(task).where(eq(task.id, m.taskId)).get();
	if (!current) return { reason: "task not found" };
	if (!isActiveMember(tx, current.groupId, userId))
		return { reason: "not a member of this group" };
	if (OWNER_ONLY.has(m.type) && current.ownerId !== userId)
		return { reason: "not your task" };

	const clocks = { ...current.clocks };
	const writeTask = (changes: Partial<typeof task.$inferInsert>) => {
		tx.update(task)
			.set({ ...changes, clocks, seq: nextSeq(tx) })
			.where(eq(task.id, current.id))
			.run();
		return { groupId: current.groupId };
	};
	const addEvent = (
		event: Pick<
			typeof taskEvent.$inferInsert,
			"type" | "occurrenceKey" | "refEventId"
		>,
	) => {
		tx.insert(taskEvent)
			.values({
				id: m.id,
				taskId: current.id,
				groupId: current.groupId,
				userId,
				at,
				receivedAt: now,
				seq: nextSeq(tx),
				...event,
			})
			.run();
		return { groupId: current.groupId };
	};

	switch (m.type) {
		case "task.update": {
			const changes: Partial<typeof task.$inferInsert> = {};
			if (m.title !== undefined && at >= clocks.title) {
				changes.title = m.title.trim();
				clocks.title = at;
			}
			if (m.notes !== undefined && at >= clocks.notes) {
				changes.notes = m.notes;
				clocks.notes = at;
			}
			return Object.keys(changes).length > 0
				? writeTask(changes)
				: { groupId: null };
		}
		case "task.schedule": {
			if (m.effectiveFrom < current.startDate)
				return { reason: "effectiveFrom is before the task starts" };
			if (at < clocks.schedule) return { groupId: null };
			const version: RuleVersion = {
				effectiveFrom: m.effectiveFrom,
				rule: m.rule,
				dueTime: m.dueTime,
			};
			const rules = withScheduleVersion(
				current.startDate,
				current.rules,
				version,
			);
			clocks.schedule = at;
			return writeTask({ rules });
		}
		case "task.archive": {
			if (at < clocks.archive) return { groupId: null };
			clocks.archive = at;
			return writeTask({ archivedAt: m.archived ? at : null });
		}
		case "task.complete":
			return addEvent({ type: "completed", occurrenceKey: m.occurrenceKey });
		case "task.uncomplete": {
			const ref = tx
				.select({ id: taskEvent.id })
				.from(taskEvent)
				.where(
					and(
						eq(taskEvent.id, m.refEventId),
						eq(taskEvent.taskId, current.id),
						eq(taskEvent.type, "completed"),
					),
				)
				.get();
			if (!ref)
				return { reason: "refEventId is not a completion of this task" };
			return addEvent({ type: "uncompleted", refEventId: m.refEventId });
		}
		case "task.nudge": {
			if (current.ownerId === userId)
				return { reason: "you can't nudge your own task" };
			const recent = tx
				.select({ id: taskEvent.id })
				.from(taskEvent)
				.where(
					and(
						eq(taskEvent.taskId, current.id),
						eq(taskEvent.userId, userId),
						eq(taskEvent.type, "nudged"),
						gt(taskEvent.receivedAt, now - NUDGE_INTERVAL_MS),
					),
				)
				.get();
			if (recent) return { reason: "rate_limited" };
			return addEvent({ type: "nudged" });
		}
	}
}
