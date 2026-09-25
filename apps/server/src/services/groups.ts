import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { groups, membership } from "../db/schema";

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
