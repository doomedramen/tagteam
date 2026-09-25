import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AddTaskSheet } from "../features/add-task/AddTaskSheet";
import { AddPasskeyScreen } from "../features/auth/AddPasskeyScreen";
import { SignInScreen } from "../features/auth/SignInScreen";
import { SignUpScreen } from "../features/auth/SignUpScreen";
import { GroupSwitcher } from "../features/groups/GroupSwitcher";
import { WelcomeScreen } from "../features/groups/WelcomeScreen";
import { HistoryScreen } from "../features/history/HistoryScreen";
import { MeScreen } from "../features/me/MeScreen";
import { TeamScreen } from "../features/team/TeamScreen";
import { TodayScreen } from "../features/today/TodayScreen";
import { SessionGate } from "../session/SessionGate";
import { useSession } from "../session/session";
import { useSyncStatus } from "../sync/use-sync-status";
import { Banner } from "../ui/Banner";
import { AppShell } from "./AppShell";
import { SyncChip } from "./SyncChip";

function MainLayout() {
	const { me, store, engine, activeGroupId, setActiveGroup } = useSession();
	const status = useSyncStatus(engine);
	const [adding, setAdding] = useState(false);
	const openAdd = useCallback(() => setAdding(true), []);
	const closeAdd = useCallback(() => setAdding(false), []);
	const localGroups = useLiveQuery(() => store.groups.toArray(), [store]);
	const groups =
		localGroups && localGroups.length > 0 ? localGroups : me.groups;
	const active =
		groups.find((group) => group.id === activeGroupId) ?? groups[0];

	useEffect(() => {
		if (localGroups !== undefined && active && active.id !== activeGroupId)
			void setActiveGroup(active.id);
	}, [localGroups, active, activeGroupId, setActiveGroup]);

	if (localGroups === undefined) return null;
	if (!active) return <Navigate to="/welcome" replace />;

	return (
		<AppShell
			title={<GroupSwitcher groups={groups} activeId={active.id} />}
			trailing={<SyncChip status={status} />}
			banner={
				status.state === "reauth" ? (
					<Banner
						tone="warning"
						action={{
							label: "Reconnect",
							onClick: () => window.location.reload(),
						}}
					>
						Your session expired.
					</Banner>
				) : null
			}
			onAdd={openAdd}
		>
			<Outlet context={{ openAdd }} />
			<AddTaskSheet open={adding} onClose={closeAdd} />
		</AppShell>
	);
}

export const router = createBrowserRouter([
	{ path: "/sign-in", element: <SignInScreen /> },
	{ path: "/sign-up", element: <SignUpScreen /> },
	{
		element: <SessionGate />,
		children: [
			{ path: "/passkey", element: <AddPasskeyScreen /> },
			{ path: "/welcome", element: <WelcomeScreen /> },
			{
				element: <MainLayout />,
				children: [
					{ index: true, element: <TodayScreen /> },
					{ path: "team", element: <TeamScreen /> },
					{ path: "history", element: <HistoryScreen /> },
					{ path: "me", element: <MeScreen /> },
				],
			},
		],
	},
	{ path: "*", element: <Navigate to="/" replace /> },
]);
