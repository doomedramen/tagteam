import type { LocalDate, MemberDto, Rule, SuggestionDto } from "@tagteam/core";

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

/** Pending suggestions addressed to `userId` in `groupId`, oldest first. */
export function incomingSuggestions(
	suggestions: SuggestionDto[],
	groupId: string,
	userId: string,
): SuggestionDto[] {
	return suggestions
		.filter(
			(s) =>
				s.groupId === groupId &&
				s.toUserId === userId &&
				s.status === "pending",
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** Suggestions `userId` sent that still need attention: waiting for an answer, or declined and not yet cleared. */
export function outgoingSuggestions(
	suggestions: SuggestionDto[],
	groupId: string,
	userId: string,
): SuggestionDto[] {
	return suggestions
		.filter(
			(s) =>
				s.groupId === groupId &&
				s.fromUserId === userId &&
				(s.status === "pending" || s.status === "declined"),
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Text for Today's single suggestions strip, or null when there is nothing to show.
 * `waiting` and `declined` count suggestions I sent that are still unanswered or were turned down.
 */
export function suggestionsStripText(
	incoming: number,
	waiting: number,
	declined: number,
): { title: string; detail: string | null } | null {
	const parts = [
		waiting > 0 ? `${waiting} waiting` : null,
		declined > 0 ? `${declined} declined` : null,
	].filter(Boolean);
	const sent = parts.join(", ");
	if (incoming > 0) {
		return {
			title: `${incoming} ${incoming === 1 ? "suggestion" : "suggestions"} for you`,
			detail: sent ? `Sent by you: ${sent}` : null,
		};
	}
	return sent ? { title: "Sent by you", detail: sent } : null;
}

/** The later of the suggested start and today, so an accepted task never begins with missed occurrences. */
export function acceptStartDate(
	suggestedStart: string,
	today: LocalDate,
): LocalDate {
	return suggestedStart > today ? suggestedStart : today;
}

function shortDate(date: string, locale?: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function repeatLabel(rule: Rule | null, locale?: string): string {
	if (rule === null) return "Once";
	switch (rule.freq) {
		case "day":
			return rule.interval === 1 ? "Daily" : `Every ${rule.interval} days`;
		case "week": {
			// 1 January 2024 was a Monday, so weekday 1 = Monday.
			const days = [...rule.weekdays]
				.sort((a, b) => a - b)
				.map((day) =>
					new Intl.DateTimeFormat(locale, {
						weekday: "short",
						timeZone: "UTC",
					}).format(Date.UTC(2024, 0, day)),
				)
				.join(", ");
			return `${rule.interval === 1 ? "Weekly" : `Every ${rule.interval} weeks`} · ${days}`;
		}
		case "month": {
			const day =
				rule.monthDay === "last" ? "last day" : `day ${rule.monthDay}`;
			return `${rule.interval === 1 ? "Monthly" : `Every ${rule.interval} months`} · ${day}`;
		}
	}
}

/** One line describing the suggested schedule, as the recipient would see it if they accepted today. */
export function suggestionSummary(
	s: Pick<SuggestionDto, "rule" | "dueTime" | "startDate">,
	today: LocalDate,
	locale?: string,
): string {
	const future = s.startDate > today;
	const when =
		s.rule === null
			? future
				? `on ${shortDate(s.startDate, locale)}`
				: "today"
			: future
				? `starts ${shortDate(s.startDate, locale)}`
				: null;
	return [
		repeatLabel(s.rule, locale),
		s.dueTime ? `by ${s.dueTime}` : null,
		when,
	]
		.filter(Boolean)
		.join(" · ");
}

/** Who to name as the suggester: "you" for the viewer, else their display name. */
export function suggesterLabel(
	userId: string,
	meId: string,
	members: MemberDto[],
): string {
	if (userId === meId) return "you";
	return (
		members.find((member) => member.userId === userId)?.displayName ??
		"a former member"
	);
}
