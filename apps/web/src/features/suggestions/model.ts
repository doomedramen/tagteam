import type { SuggestionDto } from "@tagteam/core";

/** Suggestions from `fromUserId` to `toUserId` in `groupId` that are still waiting for an answer. */
export function pendingSuggestionCount(
	suggestions: SuggestionDto[],
	groupId: string,
	fromUserId: string,
	toUserId: string,
): number {
	return suggestions.filter(
		(s) =>
			s.status === "pending" &&
			s.groupId === groupId &&
			s.fromUserId === fromUserId &&
			s.toUserId === toUserId,
	).length;
}
