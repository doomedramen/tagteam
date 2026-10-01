import {
	type EventDto,
	type Mutation,
	type PullResponse,
	withScheduleVersion,
} from "@tagteam/core";
import { setMeta, type TagTeamDb } from "./db";

export interface LocalUser {
	userId: string;
}

/** Applies one of the user's own mutations to the local mirror (optimistic update). */
export async function applyLocal(
	store: TagTeamDb,
	m: Mutation,
	me: LocalUser,
): Promise<void> {
	const event = (
		taskId: string,
		fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">,
	) =>
		store.events.put({
			id: m.id,
			taskId,
			userId: me.userId,
			at: m.at,
			...fields,
		});

	switch (m.type) {
		case "task.create":
			await store.tasks.put({
				id: m.taskId,
				groupId: m.groupId,
				ownerId: me.userId,
				title: m.title.trim(),
				notes: m.notes,
				timezone: m.timezone,
				startDate: m.startDate,
				rules: [
					{ effectiveFrom: m.startDate, rule: m.rule, dueTime: m.dueTime },
				],
				archivedAt: null,
				createdAt: m.at,
				suggestedBy: null,
			});
			return;
		case "task.update": {
			const changes: { title?: string; notes?: string | null } = {};
			if (m.title !== undefined) changes.title = m.title.trim();
			if (m.notes !== undefined) changes.notes = m.notes;
			await store.tasks.update(m.taskId, changes);
			return;
		}
		case "task.schedule": {
			const task = await store.tasks.get(m.taskId);
			if (!task) return;
			const rules = withScheduleVersion(task.startDate, task.rules, {
				effectiveFrom: m.effectiveFrom,
				rule: m.rule,
				dueTime: m.dueTime,
			});
			await store.tasks.update(m.taskId, { rules });
			return;
		}
		case "task.archive":
			await store.tasks.update(m.taskId, {
				archivedAt: m.archived ? m.at : null,
			});
			return;
		case "task.complete":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "completed",
					occurrenceKey: m.occurrenceKey,
					refEventId: null,
				});
			return;
		case "task.uncomplete":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "uncompleted",
					occurrenceKey: null,
					refEventId: m.refEventId,
				});
			return;
		case "task.nudge":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "nudged",
					occurrenceKey: null,
					refEventId: null,
				});
			return;
		case "suggestion.create":
			await store.suggestions.put({
				id: m.suggestionId,
				groupId: m.groupId,
				fromUserId: me.userId,
				toUserId: m.toUserId,
				title: m.title.trim(),
				notes: m.notes,
				startDate: m.startDate,
				dueTime: m.dueTime,
				rule: m.rule,
				status: "pending",
				taskId: null,
				createdAt: m.at,
				resolvedAt: null,
			});
			return;
		case "suggestion.accept": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (suggestion?.status !== "pending") return;
			await store.tasks.put({
				id: m.taskId,
				groupId: suggestion.groupId,
				ownerId: me.userId,
				title: suggestion.title,
				notes: suggestion.notes,
				timezone: m.timezone,
				startDate: m.startDate,
				rules: [
					{
						effectiveFrom: m.startDate,
						rule: suggestion.rule,
						dueTime: suggestion.dueTime,
					},
				],
				archivedAt: null,
				createdAt: m.at,
				suggestedBy: suggestion.fromUserId,
			});
			await store.suggestions.update(suggestion.id, {
				status: "accepted",
				taskId: m.taskId,
				resolvedAt: m.at,
			});
			return;
		}
		case "suggestion.decline": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (suggestion?.status === "pending")
				await store.suggestions.update(suggestion.id, {
					status: "declined",
					resolvedAt: m.at,
				});
			return;
		}
		case "suggestion.withdraw": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (suggestion?.status === "pending" || suggestion?.status === "declined")
				await store.suggestions.update(suggestion.id, {
					status: "withdrawn",
					resolvedAt: m.at,
				});
			return;
		}
	}
}

async function removeGroup(store: TagTeamDb, groupId: string): Promise<void> {
	const taskIds = await store.tasks
		.where("groupId")
		.equals(groupId)
		.primaryKeys();
	await store.events.where("taskId").anyOf(taskIds).delete();
	await store.tasks.bulkDelete(taskIds);
	await store.suggestions.where("groupId").equals(groupId).delete();
	await store.members.where("groupId").equals(groupId).delete();
	await store.groups.delete(groupId);
}

/** Writes a pull response into the mirror, then re-applies still-pending local mutations on top. */
export async function applyPull(
	store: TagTeamDb,
	pull: PullResponse,
	me: LocalUser,
	options: { reset?: boolean } = {},
): Promise<void> {
	await store.transaction(
		"rw",
		[
			store.groups,
			store.members,
			store.tasks,
			store.events,
			store.suggestions,
			store.outbox,
			store.meta,
		],
		async () => {
			if (options.reset) {
				await Promise.all([
					store.groups.clear(),
					store.members.clear(),
					store.tasks.clear(),
					store.events.clear(),
					store.suggestions.clear(),
				]);
			}
			for (const groupId of pull.removedGroupIds)
				await removeGroup(store, groupId);
			await store.groups.bulkPut(pull.groups);
			await store.members.bulkPut(pull.members);
			await store.tasks.bulkPut(pull.tasks);
			await store.events.bulkPut(pull.events);
			await store.suggestions.bulkPut(pull.suggestions);
			const pending = await store.outbox.orderBy("seq").toArray();
			for (const row of pending) await applyLocal(store, row.mutation, me);
			await setMeta(store, "cursor", pull.cursor);
		},
	);
}
