import type { ComponentProps } from "react";
import { cx } from "../lib/cx";

/**
 * The title block of a main page, painted in the app colour. It cancels the shell's `px-4` gutter
 * so the band runs edge to edge, and keeps the content on the same 16 px inset. The band continues
 * the safe-area strip above it and matches the bottom nav, so the screen reads as one frame.
 */
export function PageHeader({ className, ...rest }: ComponentProps<"div">) {
	return (
		<div
			data-slot="page-header"
			className={cx(
				"-mx-4 rounded-none border-b border-line bg-header px-4 pt-6 pb-4",
				className,
			)}
			{...rest}
		/>
	);
}
