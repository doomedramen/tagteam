import type { MeResponse, SuggestionDto, TaskDto } from "@tagteam/core";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { type Mock, vi } from "vitest";
import { type Session, SessionContext } from "../session/session";
import { TagTeamDb } from "../store/db";
import type { SyncEngine } from "../sync/engine";
import { ToastProvider } from "../ui/Toast";

export const ME: MeResponse = {
	user: { id: "u1", email: "sam@example.com", name: "Sam" },
	profile: {
		displayName: "Sam",
		avatarColor: "blue",
		timezone: "UTC",
		activeGroupId: "g1",
	},
	groups: [{ id: "g1", name: "Smiths", role: "admin", joinedAt: 0 }],
};

export function fakeEngine(): SyncEngine & { enqueue: Mock; sync: Mock } {
	const status = { state: "idle" as const, pending: 0, lastSyncedAt: null };
	return {
		enqueue: vi.fn(async () => {}),
		sync: vi.fn(async () => {}),
		getStatus: () => status,
		subscribe: () => () => {},
		dispose: () => {},
	};
}

export function renderWithSession(
	ui: ReactElement,
	overrides: Partial<Session> = {},
	route = "/",
) {
	const session: Session = {
		me: ME,
		store: new TagTeamDb(`test-${crypto.randomUUID()}`),
		engine: fakeEngine(),
		activeGroupId: "g1",
		setActiveGroup: vi.fn(async () => {}),
		refreshMe: vi.fn(async () => ME),
		signOut: vi.fn(async () => {}),
		...overrides,
	};
	const result = render(
		<MemoryRouter initialEntries={[route]}>
			<SessionContext.Provider value={session}>
				<ToastProvider>{ui}</ToastProvider>
			</SessionContext.Provider>
		</MemoryRouter>,
	);
	return { ...result, session };
}

/** A full task as the store holds it. Group `g1`, owner `u1`, a daily rule, no emoji or color. */
export function fakeTask(patch: Partial<TaskDto> = {}): TaskDto {
	return {
		id: "t1",
		groupId: "g1",
		ownerId: "u1",
		title: "Brush teeth",
		notes: null,
		emoji: null,
		color: null,
		timezone: "UTC",
		startDate: "2026-09-21",
		rules: [
			{
				effectiveFrom: "2026-09-21",
				rule: { freq: "day", interval: 1 },
				dueTime: null,
			},
		],
		archivedAt: null,
		createdAt: 0,
		suggestedBy: null,
		...patch,
	};
}

/** A pending suggestion from `u2` to `u1` in group `g1`. */
export function fakeSuggestion(
	patch: Partial<SuggestionDto> = {},
): SuggestionDto {
	return {
		id: "s1",
		groupId: "g1",
		fromUserId: "u2",
		toUserId: "u1",
		title: "Wash dishes",
		notes: null,
		emoji: null,
		color: null,
		startDate: "2026-10-01",
		dueTime: null,
		rule: null,
		status: "pending",
		taskId: null,
		createdAt: 0,
		resolvedAt: null,
		...patch,
	};
}
