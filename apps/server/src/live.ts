import { and, inArray, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { membership } from "./db/schema";

export interface LiveHub {
	/** Registers a poke callback for a user's open connection; returns an unsubscribe function. */
	subscribe(userId: string, poke: () => void): () => void;
	pokeUsers(userIds: Iterable<string>): void;
}

/** In-memory registry of open live connections. Single process only. */
export function createLiveHub(): LiveHub {
	const byUser = new Map<string, Set<() => void>>();
	return {
		subscribe(userId, poke) {
			const set = byUser.get(userId) ?? new Set();
			set.add(poke);
			byUser.set(userId, set);
			return () => {
				set.delete(poke);
				if (set.size === 0) byUser.delete(userId);
			};
		},
		pokeUsers(userIds) {
			for (const userId of new Set(userIds)) {
				for (const poke of byUser.get(userId) ?? []) poke();
			}
		},
	};
}

/** Pokes every active member of `groupIds`, plus `alsoUserIds`. */
export function pokeGroups(
	db: Pick<Db, "select">,
	hub: LiveHub,
	groupIds: Iterable<string>,
	alsoUserIds: Iterable<string> = [],
): void {
	const ids = [...groupIds];
	const members =
		ids.length === 0
			? []
			: db
					.select({ userId: membership.userId })
					.from(membership)
					.where(
						and(inArray(membership.groupId, ids), isNull(membership.leftAt)),
					)
					.all()
					.map((m) => m.userId);
	hub.pokeUsers([...members, ...alsoUserIds]);
}
