import { isTimeZone } from "@tagteam/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { profile } from "../db/schema";
import { isActiveMember } from "./groups";

export const AVATAR_COLORS = [
	"blue",
	"green",
	"amber",
	"coral",
	"purple",
	"teal",
	"pink",
	"gray",
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export type Profile = typeof profile.$inferSelect;

export interface ProfileDto {
	displayName: string;
	avatarColor: string;
	timezone: string;
	activeGroupId: string | null;
}

/** Stable default colour so a new user's avatar doesn't change between devices. */
function defaultAvatarColor(userId: string): AvatarColor {
	let hash = 0;
	for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return AVATAR_COLORS[hash % AVATAR_COLORS.length] as AvatarColor;
}

export function ensureProfile(
	db: Db,
	user: { id: string; name: string },
	now: number,
): Profile {
	const existing = db
		.select()
		.from(profile)
		.where(eq(profile.userId, user.id))
		.get();
	if (existing) return existing;
	const created = db
		.insert(profile)
		.values({
			userId: user.id,
			displayName: user.name.trim().slice(0, 40) || "Me",
			avatarColor: defaultAvatarColor(user.id),
			timezone: "UTC",
			activeGroupId: null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	if (!created) throw new Error(`failed to create profile for ${user.id}`);
	return created;
}

export const toProfileDto = (p: Profile): ProfileDto => ({
	displayName: p.displayName,
	avatarColor: p.avatarColor,
	timezone: p.timezone,
	activeGroupId: p.activeGroupId,
});

export type ProfilePatch = Partial<
	Pick<Profile, "displayName" | "avatarColor" | "timezone" | "activeGroupId">
>;

export function validateProfilePatch(
	db: Db,
	userId: string,
	input: unknown,
): { patch: ProfilePatch; errors: string[] } {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { patch: {}, errors: ["body must be a JSON object"] };
	}
	const patch: ProfilePatch = {};
	const errors: string[] = [];
	for (const [key, value] of Object.entries(input)) {
		switch (key) {
			case "displayName": {
				const name = typeof value === "string" ? value.trim() : "";
				if (name.length < 1 || name.length > 40)
					errors.push("displayName must be 1-40 characters");
				else patch.displayName = name;
				break;
			}
			case "avatarColor":
				if (
					typeof value === "string" &&
					(AVATAR_COLORS as readonly string[]).includes(value)
				) {
					patch.avatarColor = value;
				} else {
					errors.push(
						`avatarColor must be one of: ${AVATAR_COLORS.join(", ")}`,
					);
				}
				break;
			case "timezone":
				if (isTimeZone(value)) patch.timezone = value;
				else errors.push("timezone must be an IANA zone");
				break;
			case "activeGroupId":
				if (
					value === null ||
					(typeof value === "string" && isActiveMember(db, value, userId))
				) {
					patch.activeGroupId = value;
				} else {
					errors.push("activeGroupId must be a group you belong to");
				}
				break;
			default:
				errors.push(`unknown field: ${key}`);
		}
	}
	return { patch, errors };
}

export function updateProfile(
	db: Db,
	userId: string,
	patch: ProfilePatch,
	now: number,
): Profile {
	const updated = db
		.update(profile)
		.set({ ...patch, updatedAt: now })
		.where(eq(profile.userId, userId))
		.returning()
		.get();
	if (!updated) throw new Error(`profile missing for ${userId}`);
	return updated;
}
