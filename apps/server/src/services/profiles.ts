import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { profile } from "../db/schema";

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
