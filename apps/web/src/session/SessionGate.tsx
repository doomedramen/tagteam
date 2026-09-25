import type { MeResponse } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";
import { apiFetch } from "../lib/api";
import { authClient } from "../lib/auth";
import { clearStore, db, getMeta, setMeta } from "../store/db";
import { createSyncEngine } from "../sync/engine";
import { httpSyncApi } from "../sync/http-api";
import { startSyncTriggers } from "../sync/triggers";
import { Button } from "../ui/Button";
import { ToastProvider } from "../ui/Toast";
import { type BootResult, boot } from "./boot";
import { type Session, SessionContext } from "./session";

function Splash() {
	return (
		<div className="flex min-h-dvh items-center justify-center text-text-3">
			TagTeam
		</div>
	);
}

function SignedIn({ initialMe }: { initialMe: MeResponse }) {
	const navigate = useNavigate();
	const [me, setMe] = useState(initialMe);
	const engine = useMemo(
		() =>
			createSyncEngine({
				store: db,
				api: httpSyncApi,
				me: { userId: initialMe.user.id },
			}),
		[initialMe.user.id],
	);
	const activeGroupId =
		useLiveQuery(
			() => getMeta<string | null>(db, "activeGroupId"),
			[],
			undefined,
		) ?? null;

	const flushActiveGroup = useCallback(async () => {
		const pending = await getMeta<string>(db, "pendingActiveGroupId");
		if (!pending) return;
		try {
			await apiFetch("/api/me", {
				method: "PATCH",
				body: { activeGroupId: pending },
			});
			await db.meta.delete("pendingActiveGroupId");
		} catch {
			// Retry when the next sync succeeds.
		}
	}, []);

	useEffect(() => {
		const stopTriggers = startSyncTriggers(engine);
		const stopListening = engine.subscribe((status) => {
			if (status.state === "idle") void flushActiveGroup();
		});
		void engine.sync();
		return () => {
			stopTriggers();
			stopListening();
			engine.dispose();
		};
	}, [engine, flushActiveGroup]);

	const setActiveGroup = useCallback(
		async (id: string) => {
			await setMeta(db, "activeGroupId", id);
			await setMeta(db, "pendingActiveGroupId", id);
			await flushActiveGroup();
		},
		[flushActiveGroup],
	);
	const refreshMe = useCallback(async () => {
		const next = await apiFetch<MeResponse>("/api/me");
		await setMeta(db, "me", next);
		setMe(next);
		return next;
	}, []);
	const signOut = useCallback(async () => {
		await authClient.signOut().catch(() => {});
		engine.dispose();
		await clearStore(db);
		navigate("/sign-in", { replace: true });
	}, [engine, navigate]);

	const session = useMemo<Session>(
		() => ({
			me,
			store: db,
			engine,
			activeGroupId,
			setActiveGroup,
			refreshMe,
			signOut,
		}),
		[me, engine, activeGroupId, setActiveGroup, refreshMe, signOut],
	);

	return (
		<SessionContext.Provider value={session}>
			<ToastProvider>
				<Outlet />
			</ToastProvider>
		</SessionContext.Provider>
	);
}

export function SessionGate() {
	const [result, setResult] = useState<BootResult | null>(null);
	const run = useCallback(() => {
		setResult(null);
		void boot(db)
			.then(setResult)
			.catch(() => setResult({ phase: "offline" }));
	}, []);
	useEffect(run, [run]);

	if (!result) return <Splash />;
	if (result.phase === "signedOut") return <Navigate to="/sign-in" replace />;
	if (result.phase === "offline") {
		return (
			<div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
				<p className="text-lg font-semibold">You're offline</p>
				<p className="text-[14px] text-text-2">
					Connect once to sign in. After that TagTeam works offline.
				</p>
				<Button variant="primary" onClick={run}>
					Try again
				</Button>
			</div>
		);
	}
	return <SignedIn initialMe={result.me} />;
}
