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
	children,
}: {
	open: boolean;
	onClose: () => void;
	label: string;
	showCloseButton?: boolean;
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
			(touchDevice ? popup : (preferred ?? first ?? popup)).focus({
				preventScroll: true,
			});
		},
		[open],
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
					className="w-full max-h-[92dvh] rounded-t-3xl border-line bg-surface pb-[max(1rem,calc(env(safe-area-inset-bottom)-var(--drawer-keyboard-inset,0px)))] shadow-2xl"
				>
					<div className="flex min-h-11 shrink-0 items-center justify-end px-4 pt-1">
						{showCloseButton ? (
							<DrawerClose
								aria-label="Close"
								className="flex size-11 items-center justify-center rounded-full text-text-2 hover:bg-surface-2"
							>
								<X aria-hidden className="size-4" />
							</DrawerClose>
						) : null}
					</div>
					<DrawerTitle className="sr-only">{label}</DrawerTitle>
					<div
						data-slot="sheet-body"
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1 pt-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
					>
						{children}
					</div>
				</DrawerContent>
			</DrawerPrimitives.VirtualKeyboardProvider>
		</Drawer>
	);
}
