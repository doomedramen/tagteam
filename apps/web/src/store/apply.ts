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
		fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">,
	) =>
		store.events.put({
			id: m.id,
			taskId: m.taskId,
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
				await event({
					type: "completed",
					occurrenceKey: m.occurrenceKey,
					refEventId: null,
				});
			return;
		case "task.uncomplete":
			if (await store.tasks.get(m.taskId))
				await event({
					type: "uncompleted",
					occurrenceKey: null,
					refEventId: m.refEventId,
				});
			return;
		case "task.nudge":
			if (await store.tasks.get(m.taskId))
				await event({ type: "nudged", occurrenceKey: null, refEventId: null });
			return;
	}
}

async function removeGroup(store: TagTeamDb, groupId: string): Promise<void> {
	const taskIds = await store.tasks
		.where("groupId")
		.equals(groupId)
		.primaryKeys();
	await store.events.where("taskId").anyOf(taskIds).delete();
	await store.tasks.bulkDelete(taskIds);
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
				]);
			}
			for (const groupId of pull.removedGroupIds)
				await removeGroup(store, groupId);
			await store.groups.bulkPut(pull.groups);
			await store.members.bulkPut(pull.members);
			await store.tasks.bulkPut(pull.tasks);
			await store.events.bulkPut(pull.events);
			const pending = await store.outbox.orderBy("seq").toArray();
			for (const row of pending) await applyLocal(store, row.mutation, me);
			await setMeta(store, "cursor", pull.cursor);
		},
	);
}
