import type { PullResponse, PushResponse } from "@tagteam/core";
import { apiFetch } from "../lib/api";
import type { SyncApi } from "./engine";

export const httpSyncApi: SyncApi = {
	push: async (mutations) =>
		(
			await apiFetch<PushResponse>("/api/sync/push", {
				method: "POST",
				body: { mutations },
			})
		).results,
	pull: (cursor) => apiFetch<PullResponse>(`/api/sync/pull?cursor=${cursor}`),
};
