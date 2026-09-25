import type { RuleVersion } from "@tagteam/core";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/** Epoch milliseconds. */
const epochMs = (name: string) => integer(name);

export const groups = sqliteTable("groups", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
	createdAt: epochMs("created_at").notNull(),
	seq: integer("seq").notNull().default(0),
});

export const profile = sqliteTable("profile", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	displayName: text("display_name").notNull(),
	avatarColor: text("avatar_color").notNull(),
	timezone: text("timezone").notNull(),
	activeGroupId: text("active_group_id").references(() => groups.id, {
		onDelete: "set null",
	}),
	createdAt: epochMs("created_at").notNull(),
	updatedAt: epochMs("updated_at").notNull(),
	seq: integer("seq").notNull().default(0),
});

export const membership = sqliteTable(
	"membership",
	{
		groupId: text("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["admin", "member"] }).notNull(),
		joinedAt: epochMs("joined_at").notNull(),
		leftAt: epochMs("left_at"),
		seq: integer("seq").notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.groupId, t.userId] }),
		index("membership_user_idx").on(t.userId),
	],
);

export const inviteCode = sqliteTable(
	"invite_code",
	{
		id: text("id").primaryKey(),
		code: text("code").notNull(),
		groupId: text("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: epochMs("created_at").notNull(),
		expiresAt: epochMs("expires_at").notNull(),
		usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
		usedAt: epochMs("used_at"),
		revokedAt: epochMs("revoked_at"),
	},
	(t) => [
		index("invite_code_code_idx").on(t.code),
		index("invite_code_group_creator_idx").on(t.groupId, t.createdBy),
	],
);

/** Single-row counters; key "seq" is the global change sequence used by sync pull. */
export const syncState = sqliteTable("sync_state", {
	key: text("key").primaryKey(),
	value: integer("value").notNull(),
});

/** Client timestamp (clamped) of the last applied change per field group — last writer wins. */
export interface TaskClocks {
	title: number;
	notes: number;
	schedule: number;
	archive: number;
}

export const task = sqliteTable(
	"task",
	{
		id: text("id").primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		notes: text("notes"),
		timezone: text("timezone").notNull(),
		startDate: text("start_date").notNull(),
		rules: text("rules", { mode: "json" }).$type<RuleVersion[]>().notNull(),
		archivedAt: epochMs("archived_at"),
		createdAt: epochMs("created_at").notNull(),
		clocks: text("clocks", { mode: "json" }).$type<TaskClocks>().notNull(),
		seq: integer("seq").notNull(),
	},
	(t) => [index("task_group_seq_idx").on(t.groupId, t.seq)],
);

export const taskEvent = sqliteTable(
	"task_event",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "cascade" }),
		/** Denormalised from the task so pull can filter events by group. */
		groupId: text("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: text("type", {
			enum: ["completed", "uncompleted", "nudged"],
		}).notNull(),
		occurrenceKey: text("occurrence_key"),
		refEventId: text("ref_event_id"),
		/** When the user acted (client clock, clamped). */
		at: epochMs("at").notNull(),
		/** When the server stored it. */
		receivedAt: epochMs("received_at").notNull(),
		seq: integer("seq").notNull(),
	},
	(t) => [
		index("task_event_group_seq_idx").on(t.groupId, t.seq),
		index("task_event_task_idx").on(t.taskId),
	],
);

/** Mutation ids already applied, for idempotent retries. */
export const appliedMutation = sqliteTable("applied_mutation", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull(),
	appliedAt: epochMs("applied_at").notNull(),
});
