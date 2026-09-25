import { CircleCheck, History, Plus, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cx } from "../lib/cx";

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
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-30 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
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
						<button
							type="button"
							aria-label="Add task"
							onClick={onAdd}
							className="flex size-12 items-center justify-center rounded-full bg-accent text-on-accent shadow-md transition-transform duration-150 active:scale-95"
						>
							<Plus aria-hidden className="size-6" strokeWidth={2.25} />
						</button>
					) : null}
					<Tab {...TABS[2]} />
					<Tab {...TABS[3]} />
				</div>
			</nav>
		</div>
	);
}
