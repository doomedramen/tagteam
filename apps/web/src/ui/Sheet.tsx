import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet dialog. Closes on backdrop tap, Escape, close button, or swipe. */
export function Sheet({
	open,
	onClose,
	label,
	children,
}: {
	open: boolean;
	onClose: () => void;
	label: string;
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

			const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
			const touchDevice = coarsePointer || navigator.maxTouchPoints > 0;
			const preferred = popup.querySelector<HTMLElement>(
				"[autofocus], [data-autofocus]",
			);
			const first = popup.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
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
	const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Tab") return;
		const popup = popupRef.current;
		if (!popup) return;
		const focusable = Array.from(
			popup.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
		);
		if (focusable.length === 0) {
			event.preventDefault();
			popup.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	};

	return (
		<Drawer.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<Drawer.VirtualKeyboardProvider>
				<Drawer.Portal>
					<Drawer.Backdrop className="sheet-backdrop" />
					<Drawer.Viewport className="sheet-viewport">
						<Drawer.Popup
							ref={setPopupRef}
							className="sheet-popup"
							initialFocus={false}
							onKeyDown={trapTab}
						>
							<div aria-hidden className="sheet-handle" />
							<Drawer.Title className="sr-only">{label}</Drawer.Title>
							<Drawer.Content className="sheet-scroll">
								{children}
							</Drawer.Content>
							<Drawer.Close
								aria-label="Close"
								tabIndex={-1}
								className="sheet-close"
							>
								<X aria-hidden className="size-4" />
							</Drawer.Close>
						</Drawer.Popup>
					</Drawer.Viewport>
				</Drawer.Portal>
			</Drawer.VirtualKeyboardProvider>
		</Drawer.Root>
	);
}
