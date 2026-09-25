import type { MeResponse } from "@tagteam/core";
import { ApiError, apiFetch } from "../lib/api";
import { browserTimeZone } from "../lib/time";
import { clearStore, getMeta, setMeta, type TagTeamDb } from "../store/db";

export type BootResult =
	| { phase: "ready"; me: MeResponse; online: boolean }
	| { phase: "signedOut" }
	| { phase: "offline" };

export async function boot(store: TagTeamDb): Promise<BootResult> {
	const cached = await getMeta<MeResponse>(store, "me");
	let me: MeResponse;
	try {
		me = await apiFetch<MeResponse>("/api/me");
	} catch (err) {
		if (err instanceof ApiError && err.status === 401)
			return { phase: "signedOut" };
		return cached
			? { phase: "ready", me: cached, online: false }
			: { phase: "offline" };
	}

	if (cached && cached.user.id !== me.user.id) await clearStore(store);
	await setMeta(store, "me", me);
	const pending = await getMeta<string>(store, "pendingActiveGroupId");
	await setMeta(store, "activeGroupId", pending ?? me.profile.activeGroupId);

	const timezone = browserTimeZone();
	if (me.profile.timezone !== timezone) {
		void apiFetch("/api/me", { method: "PATCH", body: { timezone } }).catch(
			() => {},
		);
	}

	return { phase: "ready", me, online: true };
}
