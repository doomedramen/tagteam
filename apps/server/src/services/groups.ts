import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { groups, membership, profile } from "../db/schema";

export interface MyGroup {
	id: string;
	name: string;
	role: "admin" | "member";
	joinedAt: number;
}

export function listMyGroups(db: Db, userId: string): MyGroup[] {
	return db
		.select({
			id: groups.id,
			name: groups.name,
			role: membership.role,
			joinedAt: membership.joinedAt,
		})
		.from(membership)
		.innerJoin(groups, eq(groups.id, membership.groupId))
		.where(and(eq(membership.userId, userId), isNull(membership.leftAt)))
		.orderBy(asc(membership.joinedAt))
		.all();
}

export function isActiveMember(
	db: Db,
	groupId: string,
	userId: string,
): boolean {
	const row = db
		.select({ userId: membership.userId })
		.from(membership)
		.where(
			and(
				eq(membership.groupId, groupId),
				eq(membership.userId, userId),
				isNull(membership.leftAt),
			),
		)
		.get();
	return row !== undefined;
}

export function validateGroupName(input: unknown): string | null {
	const name = typeof input === "string" ? input.trim() : "";
	return name.length >= 1 && name.length <= 40 ? name : null;
}

export function createGroup(
	db: Db,
	userId: string,
	name: string,
	now: number,
): { id: string; name: string } {
	const id = randomUUID();
	db.transaction((tx) => {
		tx.insert(groups)
			.values({ id, name, createdBy: userId, createdAt: now })
			.run();
		tx.insert(membership)
			.values({ groupId: id, userId, role: "admin", joinedAt: now })
			.run();
		tx.update(profile)
			.set({ activeGroupId: id, updatedAt: now })
			.where(eq(profile.userId, userId))
			.run();
	});
	return { id, name };
}

export interface Member {
	userId: string;
	displayName: string;
	avatarColor: string;
	role: "admin" | "member";
	joinedAt: number;
}

export function listMembers(db: Db, groupId: string): Member[] {
	return db
		.select({
			userId: membership.userId,
			displayName: profile.displayName,
			avatarColor: profile.avatarColor,
			role: membership.role,
			joinedAt: membership.joinedAt,
		})
		.from(membership)
		.innerJoin(profile, eq(profile.userId, membership.userId))
		.where(and(eq(membership.groupId, groupId), isNull(membership.leftAt)))
		.orderBy(asc(membership.joinedAt))
		.all();
}

export function leaveGroup(
	db: Db,
	groupId: string,
	userId: string,
	now: number,
): boolean {
	if (!isActiveMember(db, groupId, userId)) return false;
	db.transaction((tx) => {
		tx.update(membership)
			.set({ leftAt: now })
			.where(
				and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
			)
			.run();
		const current = tx
			.select({ activeGroupId: profile.activeGroupId })
			.from(profile)
			.where(eq(profile.userId, userId))
			.get();
		if (current?.activeGroupId !== groupId) return;
		const next = tx
			.select({ groupId: membership.groupId })
			.from(membership)
			.where(
				and(
					eq(membership.userId, userId),
					isNull(membership.leftAt),
					ne(membership.groupId, groupId),
				),
			)
			.orderBy(asc(membership.joinedAt))
			.get();
		tx.update(profile)
			.set({ activeGroupId: next?.groupId ?? null, updatedAt: now })
			.where(eq(profile.userId, userId))
			.run();
	});
	return true;
}
