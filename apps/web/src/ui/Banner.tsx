import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export function Banner({
	tone,
	children,
	action,
}: {
	tone: "warning" | "danger";
	children: ReactNode;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<div
			role="alert"
			className={cx(
				"mx-4 mt-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[14px]",
				tone === "warning"
					? "bg-warning-soft text-warning"
					: "bg-danger-soft text-danger",
			)}
		>
			<span className="flex-1">{children}</span>
			{action ? (
				<button
					type="button"
					onClick={action.onClick}
					className="-my-1 min-h-11 font-semibold underline-offset-2 hover:underline"
				>
					{action.label}
				</button>
			) : null}
		</div>
	);
}
