import type { RuleVersion } from "./rule";

/** JSON shapes exchanged between apps/server and apps/web. */

export interface ErrorBody {
	error: { code: string; message: string; details?: string[] };
}

export interface SessionUser {
	id: string;
	email: string;
	name: string;
}

export interface ProfileDto {
	displayName: string;
	avatarColor: string;
	timezone: string;
	activeGroupId: string | null;
}

export interface MyGroup {
	id: string;
	name: string;
	role: "admin" | "member";
	joinedAt: number;
}

export interface MeResponse {
	user: SessionUser;
	profile: ProfileDto;
	groups: MyGroup[];
}

export interface InviteDto {
	code: string;
	createdAt: number;
	expiresAt: number;
}

export interface GroupDto {
	id: string;
	name: string;
}

export interface MemberDto {
	groupId: string;
	userId: string;
	displayName: string;
	avatarColor: string;
	role: "admin" | "member";
	joinedAt: number;
	leftAt: number | null;
}

export interface TaskDto {
	id: string;
	groupId: string;
	ownerId: string;
	title: string;
	notes: string | null;
	timezone: string;
	startDate: string;
	rules: RuleVersion[];
	archivedAt: number | null;
	createdAt: number;
}

export interface EventDto {
	id: string;
	taskId: string;
	userId: string;
	type: "completed" | "uncompleted" | "nudged";
	occurrenceKey: string | null;
	refEventId: string | null;
	at: number;
}

export interface PullResponse {
	cursor: number;
	groups: GroupDto[];
	members: MemberDto[];
	tasks: TaskDto[];
	events: EventDto[];
	removedGroupIds: string[];
}

export interface MutationResult {
	id: string;
	status: "applied" | "duplicate" | "rejected";
	reason?: string;
}

export interface PushResponse {
	results: MutationResult[];
}
