import type { ReactNode } from "react";
import { Toggle } from "@/components/ui/toggle";

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
		<Toggle
			pressed={selected}
			role={role}
			aria-checked={selected}
			onPressedChange={onClick}
			className="min-h-11 min-w-11 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[14px] text-text ring-1 ring-line transition-colors duration-150 active:bg-surface-2 aria-pressed:bg-accent aria-pressed:text-on-accent data-[state=on]:bg-accent data-[state=on]:text-on-accent"
		>
			{children}
		</Toggle>
	);
}
