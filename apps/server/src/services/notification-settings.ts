import { isTimeOfDay } from "@tagteam/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { notificationSettings } from "../db/schema";

export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NotificationSettingsPatch = Partial<
	Pick<
		NotificationSettings,
		"remindersEnabled" | "nudgesEnabled" | "quietHoursStart" | "quietHoursEnd"
	>
>;

export function getNotificationSettings(
	db: Db,
	userId: string,
): NotificationSettings {
	const existing = db
		.select()
		.from(notificationSettings)
		.where(eq(notificationSettings.userId, userId))
		.get();
	if (existing) return existing;
	db.insert(notificationSettings)
		.values({ userId, updatedAt: Date.now() })
		.onConflictDoNothing()
		.run();
	const created = db
		.select()
		.from(notificationSettings)
		.where(eq(notificationSettings.userId, userId))
		.get();
	if (!created) throw new Error(`notification settings missing for ${userId}`);
	return created;
}

export function validateNotificationSettingsPatch(input: unknown): {
	patch: NotificationSettingsPatch;
	errors: string[];
} {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { patch: {}, errors: ["body must be a JSON object"] };
	}
	const patch: NotificationSettingsPatch = {};
	const errors: string[] = [];
	for (const [key, value] of Object.entries(input)) {
		switch (key) {
			case "remindersEnabled":
			case "nudgesEnabled":
				if (typeof value === "boolean") patch[key] = value;
				else errors.push(`${key} must be a boolean`);
				break;
			case "quietHoursStart":
			case "quietHoursEnd":
				if (isTimeOfDay(value)) patch[key] = value;
				else errors.push(`${key} must be HH:MM`);
				break;
			default:
				errors.push(`unknown field: ${key}`);
		}
	}
	if (Object.keys(input).length === 0)
		errors.push("provide at least one setting");
	return { patch, errors };
}

export function updateNotificationSettings(
	db: Db,
	userId: string,
	patch: NotificationSettingsPatch,
	now: number,
): NotificationSettings {
	getNotificationSettings(db, userId);
	const updated = db
		.update(notificationSettings)
		.set({ ...patch, updatedAt: now })
		.where(eq(notificationSettings.userId, userId))
		.returning()
		.get();
	if (!updated) throw new Error(`notification settings missing for ${userId}`);
	return updated;
}
