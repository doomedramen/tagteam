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
