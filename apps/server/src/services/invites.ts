import { randomInt, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { groups, inviteCode, membership, profile } from "../db/schema";
import { isActiveMember } from "./groups";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITES = 10;
const MAX_ALLOCATION_TRIES = 20;

const pending = (now: number) =>
	and(
		isNull(inviteCode.usedAt),
		isNull(inviteCode.revokedAt),
		gt(inviteCode.expiresAt, now),
	);

/** Issues a single-use code, or returns null when the creator already has too many pending in this group. */
export function createInvite(
	db: Db,
	groupId: string,
	userId: string,
	now: number,
	random: () => number = () => randomInt(0, 1_000_000),
): { code: string; expiresAt: number } | null {
	return db.transaction((tx) => {
		const open = tx
			.select({ n: count() })
			.from(inviteCode)
			.where(
				and(
					eq(inviteCode.groupId, groupId),
					eq(inviteCode.createdBy, userId),
					pending(now),
				),
			)
			.get();
		if ((open?.n ?? 0) >= MAX_PENDING_INVITES) return null;

		for (let i = 0; i < MAX_ALLOCATION_TRIES; i++) {
			const code = String(random()).padStart(6, "0");
			const clash = tx
				.select({ id: inviteCode.id })
				.from(inviteCode)
				.where(and(eq(inviteCode.code, code), pending(now)))
				.get();
			if (clash) continue;
			const expiresAt = now + INVITE_TTL_MS;
			tx.insert(inviteCode)
				.values({
					id: randomUUID(),
					code,
					groupId,
					createdBy: userId,
					createdAt: now,
					expiresAt,
				})
				.run();
			return { code, expiresAt };
		}
		throw new Error("could not allocate an unused invite code");
	});
}

export function listPendingInvites(
	db: Db,
	groupId: string,
	userId: string,
	now: number,
) {
	return db
		.select({
			code: inviteCode.code,
			createdAt: inviteCode.createdAt,
			expiresAt: inviteCode.expiresAt,
		})
		.from(inviteCode)
		.where(
			and(
				eq(inviteCode.groupId, groupId),
				eq(inviteCode.createdBy, userId),
				pending(now),
			),
		)
		.orderBy(desc(inviteCode.createdAt))
		.all();
}

export function revokeInvite(
	db: Db,
	code: string,
	userId: string,
	now: number,
): boolean {
	const result = db
		.update(inviteCode)
		.set({ revokedAt: now })
		.where(
			and(
				eq(inviteCode.code, code),
				eq(inviteCode.createdBy, userId),
				pending(now),
			),
		)
		.run();
	return result.changes > 0;
}

export type RedeemResult =
	| { ok: true; group: { id: string; name: string } }
	| { ok: false; reason: "invalid" | "already_member" };

export function redeemInvite(
	db: Db,
	code: string,
	userId: string,
	now: number,
): RedeemResult {
	return db.transaction((tx): RedeemResult => {
		const invite = tx
			.select({
				id: inviteCode.id,
				groupId: inviteCode.groupId,
				name: groups.name,
			})
			.from(inviteCode)
			.innerJoin(groups, eq(groups.id, inviteCode.groupId))
			.where(and(eq(inviteCode.code, code), pending(now)))
			.get();
		if (!invite) return { ok: false, reason: "invalid" };
		if (isActiveMember(tx, invite.groupId, userId))
			return { ok: false, reason: "already_member" };

		tx.insert(membership)
			.values({
				groupId: invite.groupId,
				userId,
				role: "member",
				joinedAt: now,
			})
			.onConflictDoUpdate({
				target: [membership.groupId, membership.userId],
				set: { role: "member", joinedAt: now, leftAt: null },
			})
			.run();
		tx.update(inviteCode)
			.set({ usedBy: userId, usedAt: now })
			.where(eq(inviteCode.id, invite.id))
			.run();
		tx.update(profile)
			.set({ activeGroupId: invite.groupId, updatedAt: now })
			.where(eq(profile.userId, userId))
			.run();
		return { ok: true, group: { id: invite.groupId, name: invite.name } };
	});
}
