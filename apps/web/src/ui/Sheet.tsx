import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Element to prefer when moving focus into the dialog. React's `autoFocus` prop
 * calls `.focus()` imperatively during commit rather than setting the DOM
 * `autofocus` attribute, so it only takes effect once and is lost across a
 * React 19 StrictMode dev double-invoke (effect → cleanup → effect) or any
 * later re-run of this effect. Consumers that need focus to land on a
 * specific field whenever the sheet (re-)opens should mark it with
 * `data-autofocus` in addition to (or instead of) `autoFocus`.
 */
const PREFERRED_FOCUS_SELECTOR = "[autofocus], [data-autofocus]";

/** Bottom sheet dialog. Closes on backdrop tap and Escape. */
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
	const dialogRef = useRef<HTMLDivElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const dialog = dialogRef.current;
		const activeIsInsideDialog =
			!!dialog && dialog.contains(document.activeElement);

		// Only remember the pre-open focus target when it's outside the dialog.
		// Under React 19 StrictMode's dev double-invoke (effect → cleanup →
		// effect), the cleanup already restores focus to the real trigger before
		// this effect runs again, so re-capturing here would be a no-op; but if
		// focus were still inside the dialog for some other reason, capturing it
		// would clobber the real trigger with one of the dialog's own children.
		if (!activeIsInsideDialog) {
			previouslyFocused.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
		}

		if (dialog && !activeIsInsideDialog) {
			const preferred = dialog.querySelector<HTMLElement>(
				PREFERRED_FOCUS_SELECTOR,
			);
			const first =
				preferred ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
			(first ?? dialog).focus();
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key !== "Tab" || !dialog) return;
			const focusable = Array.from(
				dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			);
			if (focusable.length === 0) {
				e.preventDefault();
				dialog.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey);

		const scrollY = window.scrollY;
		const body = document.body.style;
		const previousStyle = {
			position: body.position,
			top: body.top,
			left: body.left,
			right: body.right,
			overflow: body.overflow,
		};
		body.position = "fixed";
		body.top = `-${scrollY}px`;
		body.left = "0";
		body.right = "0";
		body.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", onKey);
			body.position = previousStyle.position;
			body.top = previousStyle.top;
			body.left = previousStyle.left;
			body.right = previousStyle.right;
			body.overflow = previousStyle.overflow;
			window.scrollTo(0, scrollY);

			const toRestore = previouslyFocused.current;
			if (toRestore && document.contains(toRestore)) toRestore.focus();
		};
	}, [open, onClose]);

	if (!open) return null;
	return createPortal(
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-black/40 animate-[fade-in_150ms_ease-out]"
			/>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-[sheet-up_240ms_cubic-bezier(0.32,0.72,0,1)]"
			>
				<div
					aria-hidden
					className="mx-auto mb-3 h-1 w-9 rounded-full bg-line"
				/>
				{children}
			</div>
		</div>,
		document.body,
	);
}
