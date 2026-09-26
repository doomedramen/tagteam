import { CircleCheck, History, Plus, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cx } from "../lib/cx";
import { Button } from "../ui/Button";
import { useAppUpdate } from "./AppUpdate";

const TABS = [
	{ to: "/", label: "Today", icon: CircleCheck, end: true },
	{ to: "/team", label: "Team", icon: Users, end: false },
	{ to: "/history", label: "History", icon: History, end: false },
	{ to: "/me", label: "Me", icon: UserRound, end: false },
] as const;

function Tab({ to, label, icon: Icon, end }: (typeof TABS)[number]) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				cx(
					"flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
					isActive ? "text-accent" : "text-text-3",
				)
			}
		>
			<Icon aria-hidden className="size-6" strokeWidth={1.75} />
			{label}
		</NavLink>
	);
}

export function AppShell({
	title,
	trailing,
	banner,
	onAdd,
	children,
}: {
	title: ReactNode;
	trailing?: ReactNode;
	banner?: ReactNode;
	onAdd?: () => void;
	children: ReactNode;
}) {
	const { updateAvailable } = useAppUpdate();

	return (
		<div
			className="flex flex-col"
			style={{
				minHeight: updateAvailable
					? "calc(100dvh - 3.5rem - env(safe-area-inset-top))"
					: "100dvh",
			}}
		>
			<header
				className={cx(
					"sticky z-30 bg-bg/90 backdrop-blur",
					updateAvailable ? "" : "top-0 pt-[env(safe-area-inset-top)]",
				)}
				style={{
					top: updateAvailable
						? "calc(3.5rem + env(safe-area-inset-top))"
						: "0px",
				}}
			>
				<div className="flex min-h-14 items-center justify-between gap-3 px-4">
					<div className="min-w-0 flex-1">{title}</div>
					{trailing}
				</div>
			</header>
			{banner}
			<main className="flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
				{children}
			</main>
			<nav
				aria-label="Main"
				className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
			>
				<div className="mx-auto flex max-w-md items-center justify-around px-2 py-1.5">
					<Tab {...TABS[0]} />
					<Tab {...TABS[1]} />
					{onAdd ? (
						<Button
							variant="primary"
							aria-label="Add task"
							onClick={onAdd}
							className="size-12 rounded-full p-0 shadow-md transition-transform duration-150 active:scale-95 [&_svg]:size-6"
						>
							<Plus aria-hidden strokeWidth={2.25} />
						</Button>
					) : null}
					<Tab {...TABS[2]} />
					<Tab {...TABS[3]} />
				</div>
			</nav>
		</div>
	);
}
