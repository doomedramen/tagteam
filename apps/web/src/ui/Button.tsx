import type { ButtonHTMLAttributes } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { cx } from "../lib/cx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
	primary: "active:opacity-90",
	secondary:
		"border-transparent bg-surface text-text ring-1 ring-line active:bg-surface-2",
	ghost: "text-accent hover:text-accent active:bg-accent-soft",
	danger:
		"border-transparent bg-surface text-danger ring-1 ring-danger/40 active:bg-danger-soft hover:text-danger",
};

const SHADCN_VARIANTS: Record<Variant, "default" | "outline" | "ghost"> = {
	primary: "default",
	secondary: "outline",
	ghost: "ghost",
	danger: "outline",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	block?: boolean;
	busy?: boolean;
}

export function Button({
	variant = "secondary",
	block,
	busy,
	className,
	children,
	disabled,
	...rest
}: ButtonProps) {
	return (
		<ShadcnButton
			type="button"
			{...rest}
			variant={SHADCN_VARIANTS[variant]}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
			className={cx(
				"min-h-11 select-none rounded-xl px-4 text-[15px] font-medium transition-[opacity,background-color] duration-150 disabled:opacity-50",
				VARIANTS[variant],
				block && "w-full",
				className,
			)}
		>
			{busy ? <Spinner data-icon="inline-start" /> : null}
			{children}
		</ShadcnButton>
	);
}
