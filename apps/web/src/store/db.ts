import type {
	EventDto,
	GroupDto,
	MemberDto,
	Mutation,
	SuggestionDto,
	TaskDto,
} from "@tagteam/core";
import Dexie, { type EntityTable, type Table } from "dexie";

export interface OutboxRow {
	seq?: number;
	mutation: Mutation;
}

export type MetaKey =
	| "cursor"
	| "me"
	| "activeGroupId"
	| "pendingActiveGroupId"
	| "awaitingEmoji";

export interface MetaRow {
	key: MetaKey;
	value: unknown;
}

/** Local mirror of the server data the user can see, plus the outbox of unsent changes. */
export class TagTeamDb extends Dexie {
	groups!: EntityTable<GroupDto, "id">;
	members!: Table<MemberDto, [string, string]>;
	tasks!: EntityTable<TaskDto, "id">;
	events!: EntityTable<EventDto, "id">;
	suggestions!: EntityTable<SuggestionDto, "id">;
	outbox!: EntityTable<OutboxRow, "seq">;
	meta!: EntityTable<MetaRow, "key">;

	constructor(name = "tagteam") {
		super(name);
		this.version(1).stores({
			groups: "id",
			members: "[groupId+userId], groupId",
			tasks: "id, groupId",
			events: "id, taskId",
			outbox: "++seq",
			meta: "key",
		});
		this.version(2).stores({
			suggestions: "id, groupId",
		});
	}
}

export const db = new TagTeamDb();

export async function getMeta<T>(
	store: TagTeamDb,
	key: MetaKey,
): Promise<T | undefined> {
	return (await store.meta.get(key))?.value as T | undefined;
}

export async function setMeta(
	store: TagTeamDb,
	key: MetaKey,
	value: unknown,
): Promise<void> {
	await store.meta.put({ key, value });
}

/** Removes all local data (sign-out or a different user signing in). */
export async function clearStore(store: TagTeamDb): Promise<void> {
	await store.transaction("rw", store.tables, async () => {
		for (const table of store.tables) await table.clear();
	});
}
