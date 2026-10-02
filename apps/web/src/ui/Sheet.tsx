import { Drawer as DrawerPrimitives } from "@base-ui/react/drawer";
import type { TaskColor } from "@tagteam/core";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useRef } from "react";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerTitle,
} from "@/components/ui/drawer";
import { cx } from "../lib/cx";

const SAFE_BOTTOM =
	"pb-[max(1rem,calc(env(safe-area-inset-bottom)-var(--drawer-keyboard-inset,0px)))]";

/**
 * Bottom sheet dialog. Closes on backdrop tap, Escape, close button, or swipe.
 *
 * `tint` makes it a task-coloured sheet (a hue, or `null` for a task with no color).
 * `action` (a button for the header's right side) switches the header to: close button in
 * a circle on the left, `action` on the right, the title kept as the dialog name only.
 * `notice` shows one line directly under the header, outside the scrolling body.
 */
export function Sheet({
	open,
	onClose,
	label,
	showCloseButton = true,
	showTitle = false,
	focusOnTouch = false,
	tint,
	action,
	notice,
	footer,
	children,
}: {
	open: boolean;
	onClose: () => void;
	label: string;
	showCloseButton?: boolean;
	showTitle?: boolean;
	focusOnTouch?: boolean;
	tint?: TaskColor | null;
	action?: ReactNode;
	notice?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const tinted = tint !== undefined;
	const popupRef = useRef<HTMLDivElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	const setPopupRef = useCallback(
		(popup: HTMLDivElement | null) => {
			popupRef.current = popup;
			if (!open || !popup || popup.contains(document.activeElement)) return;
			previouslyFocused.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;

			const touchDevice =
				window.matchMedia?.("(pointer: coarse)").matches ||
				navigator.maxTouchPoints > 0;
			const content = popup.querySelector<HTMLElement>(
				'[data-slot="sheet-body"]',
			);
			const preferred = content?.querySelector<HTMLElement>(
				"[autofocus], [data-autofocus]",
			);
			const first = content?.querySelector<HTMLElement>(
				'a[href], button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			(touchDevice && !focusOnTouch
				? popup
				: (preferred ?? first ?? popup)
			).focus({
				preventScroll: true,
			});
		},
		[open, focusOnTouch],
	);
	useLayoutEffect(() => {
		if (open) return;
		const target = previouslyFocused.current;
		previouslyFocused.current = null;
		if (target && document.contains(target))
			target.focus({ preventScroll: true });
	}, [open]);

	const header =
		action !== undefined ? (
			<div className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4 pt-2">
				{showCloseButton ? (
					<DrawerClose
						aria-label="Close"
						className="flex size-11 items-center justify-center rounded-full bg-task-swatch text-text transition-colors duration-200 motion-reduce:transition-none"
					>
						<X aria-hidden className="size-5" />
					</DrawerClose>
				) : (
					<span />
				)}
				<DrawerTitle tabIndex={-1} className="sr-only">
					{label}
				</DrawerTitle>
				{action}
			</div>
		) : (
			<div className="flex min-h-11 shrink-0 items-center justify-between px-4 pt-1">
				<DrawerTitle
					tabIndex={-1}
					className={showTitle ? "text-[17px] font-semibold" : "sr-only"}
				>
					{label}
				</DrawerTitle>
				{showCloseButton ? (
					<DrawerClose
						aria-label="Close"
						className="ml-auto flex size-11 items-center justify-center rounded-full text-text-2 hover:bg-surface-2"
					>
						<X aria-hidden className="size-4" />
					</DrawerClose>
				) : null}
			</div>
		);

	return (
		<Drawer
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			showSwipeHandle={!tinted}
		>
			<DrawerPrimitives.VirtualKeyboardProvider>
				<DrawerContent
					ref={setPopupRef}
					initialFocus={false}
					data-task-color={tint ?? undefined}
					onPointerDown={(event) => {
						// Keep the keyboard and hit target stationary until a button tap commits.
						// Inputs/selects still receive native focus; keyboard Tab is unaffected.
						const active = document.activeElement;
						if (
							event.target instanceof Element &&
							event.target.closest("button") &&
							(active instanceof HTMLInputElement ||
								active instanceof HTMLTextAreaElement) &&
							event.currentTarget.contains(active)
						)
							event.preventDefault();
					}}
					className={cx(
						"w-full data-[swipe-direction=down]:bottom-[var(--drawer-keyboard-inset,0px)] max-h-[calc(100dvh-var(--drawer-keyboard-inset,0px)-max(1rem,env(safe-area-inset-top)))] shadow-2xl",
						tinted
							? "data-[swipe-direction=down]:rounded-t-[32px] border-transparent bg-transparent pb-0 [--drawer-bleed-background:var(--task-sheet)]"
							: `rounded-t-3xl border-line bg-surface ${SAFE_BOTTOM}`,
					)}
				>
					<div
						data-slot="sheet-surface"
						className={
							tinted
								? cx(
										"flex min-h-0 flex-1 flex-col rounded-t-[32px] bg-task-sheet text-text transition-colors duration-200 motion-reduce:transition-none",
										SAFE_BOTTOM,
									)
								: "contents"
						}
					>
						{header}
						{notice ? (
							<div data-slot="sheet-notice" className="shrink-0 px-4 pt-1">
								{notice}
							</div>
						) : null}
						{/* The whole sheet clears the keyboard. Extra provider scroll padding
						    during its entrance would briefly inflate this compact form. */}
						<div
							data-slot="sheet-body"
							className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1! pt-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
						>
							{children}
						</div>
						{footer ? (
							<div
								data-slot="sheet-footer"
								className="shrink-0 border-t border-line px-4 pt-3 mt-3"
							>
								{footer}
							</div>
						) : null}
					</div>
				</DrawerContent>
			</DrawerPrimitives.VirtualKeyboardProvider>
		</Drawer>
	);
}
