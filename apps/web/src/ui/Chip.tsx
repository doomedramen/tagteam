import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export function Chip({
	selected,
	onClick,
	children,
	role = "radio",
}: {
	selected: boolean;
	onClick: () => void;
	children: ReactNode;
	role?: "radio" | "checkbox";
}) {
	return (
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is dynamic (radio/checkbox), both of which support aria-checked
		<button
			type="button"
			role={role}
			aria-checked={selected}
			onClick={onClick}
			className={cx(
				"inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors duration-150",
				selected
					? "bg-accent text-on-accent"
					: "bg-surface text-text ring-1 ring-line active:bg-surface-2",
			)}
		>
			{children}
		</button>
	);
}
