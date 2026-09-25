import type { EventDto, MemberDto, TaskDto } from "@tagteam/core";
import { buildToday, type TodayView } from "../today/model";

export interface TeamMemberView {
	member: MemberDto;
	today: TodayView;
}

export function buildTeam(input: {
	members: MemberDto[];
	tasks: TaskDto[];
	events: EventDto[];
	groupId: string;
	userId: string;
	now: number;
	day: { start: number; end: number };
}): TeamMemberView[] {
	return input.members
		.filter(
			(member) => member.groupId === input.groupId && member.leftAt === null,
		)
		.map((member) => ({
			member,
			today: buildToday({
				tasks: input.tasks,
				events: input.events,
				userId: member.userId,
				groupId: input.groupId,
				now: input.now,
				day: input.day,
			}),
		}))
		.sort((a, b) => {
			if (a.member.userId === input.userId) return -1;
			if (b.member.userId === input.userId) return 1;
			return a.member.displayName.localeCompare(b.member.displayName);
		});
}
