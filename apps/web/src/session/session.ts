import type { MeResponse } from "@tagteam/core";
import { createContext, useContext } from "react";
import type { TagTeamDb } from "../store/db";
import type { SyncEngine } from "../sync/engine";

export interface Session {
	me: MeResponse;
	store: TagTeamDb;
	engine: SyncEngine;
	activeGroupId: string | null;
	setActiveGroup(id: string): Promise<void>;
	refreshMe(): Promise<MeResponse>;
	signOut(): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
	const session = useContext(SessionContext);
	if (!session)
		throw new Error("useSession must be used inside the signed-in app");
	return session;
}
