import { Drawer as DrawerPrimitives } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useRef } from "react";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerTitle,
} from "@/components/ui/drawer";

/** Bottom sheet dialog. Closes on backdrop tap, Escape, close button, or swipe. */
export function Sheet({
	open,
	onClose,
	label,
	showCloseButton = true,
	showTitle = false,
	focusOnTouch = false,
	footer,
	children,
}: {
	open: boolean;
	onClose: () => void;
	label: string;
	showCloseButton?: boolean;
	showTitle?: boolean;
	focusOnTouch?: boolean;
	footer?: ReactNode;
	children: ReactNode;
}) {
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

	return (
		<Drawer
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			showSwipeHandle
		>
			<DrawerPrimitives.VirtualKeyboardProvider>
				<DrawerContent
					ref={setPopupRef}
					initialFocus={false}
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
					className="w-full data-[swipe-direction=down]:bottom-[var(--drawer-keyboard-inset,0px)] max-h-[calc(100dvh-var(--drawer-keyboard-inset,0px)-max(1rem,env(safe-area-inset-top)))] rounded-t-3xl border-line bg-surface pb-[max(1rem,calc(env(safe-area-inset-bottom)-var(--drawer-keyboard-inset,0px)))] shadow-2xl"
				>
					<div className="flex min-h-11 shrink-0 items-center justify-between px-4 pt-1">
						<DrawerTitle
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
				</DrawerContent>
			</DrawerPrimitives.VirtualKeyboardProvider>
		</Drawer>
	);
}
