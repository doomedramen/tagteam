import { useCallback, useRef } from "react";

/** A tap that moves further than this (px) is a scroll or swipe, never a tap. */
const TAP_SLOP = 10;
/**
 * A touch that starts this soon (ms) after a scroll event in the popup is not intercepted: on iOS
 * a touch that merely stops momentum scrolling produces no click, so it is not a tap on a control.
 */
const SCROLL_SETTLE_MS = 150;

const TEXT_INPUT_TYPES = new Set([
	"text",
	"search",
	"email",
	"url",
	"tel",
	"password",
	"number",
]);

/** Controls a tap can activate. `label` covers the colour radios; rows are buttons. */
const ACTIVATABLE =
	'button, a[href], label, [role="radio"], [role="button"], input[type="radio"], input[type="checkbox"]';

/** Anything that needs native focus or its own picker: never intercepted. */
const NATIVE_FOCUS_TARGET =
	'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="reset"])';

function isTextEntry(element: Element | null): boolean {
	if (element instanceof HTMLTextAreaElement) return true;
	return (
		element instanceof HTMLInputElement &&
		TEXT_INPUT_TYPES.has(element.type.toLowerCase())
	);
}

function isDisabled(control: Element): boolean {
	if (control.closest('[aria-disabled="true"]')) return true;
	if (control.matches(":disabled")) return true;
	if (control instanceof HTMLLabelElement) {
		const target = control.control;
		return target ? target.matches(":disabled") : false;
	}
	return false;
}

/** The control a tap on `target` should activate, or null when it must stay native. */
function activatableControl(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Element)) return null;
	const control = target.closest<HTMLElement>(ACTIVATABLE);
	if (!control) return null;
	// Text fields, selects and date/time inputs need native focus (and may sit inside a label).
	if (target.closest(NATIVE_FOCUS_TARGET)) return null;
	if (control instanceof HTMLLabelElement) {
		const labelled = control.control;
		if (labelled?.matches(NATIVE_FOCUS_TARGET)) return null;
	}
	if (isDisabled(control)) return null;
	return control;
}

type Touch = { x: number; y: number; target: EventTarget | null };

/**
 * iOS Safari blurs a focused text field (and starts dismissing the keyboard) while it is
 * building a tap's synthesized mouse events. The sheet sits on the keyboard inset, so it moves
 * before the `click` arrives and the tap is lost. Preventing `pointerdown` does not stop this.
 *
 * Returns a callback ref for the sheet's popup. While a text field inside the popup is focused,
 * a clean one-finger tap on an activatable control is handled on `touchend`: the event is
 * cancelled (no synthesized mouse events, so no blur, so the keyboard and sheet stay put) and
 * the control is clicked once. Everything else keeps the browser's behaviour: swipes (movement
 * past the slop), multi-touch, and a touch that begins just after a scroll (it only stopped
 * momentum scrolling, which iOS does not turn into a click). A slow press is still a tap.
 */
export function useKeepKeyboardTaps(): (popup: HTMLElement | null) => void {
	const cleanup = useRef<(() => void) | null>(null);

	return useCallback((popup: HTMLElement | null) => {
		cleanup.current?.();
		cleanup.current = null;
		if (!popup) return;

		let touch: Touch | null = null;
		let lastScrollAt = Number.NEGATIVE_INFINITY;

		// `scroll` does not bubble, so a capture listener on the popup sees the scrolling body.
		const onScroll = () => {
			lastScrollAt = Date.now();
		};

		const focusedTextEntry = () => {
			const active = document.activeElement;
			return isTextEntry(active) && popup.contains(active) ? active : null;
		};

		const onStart = (event: TouchEvent) => {
			// Any second finger cancels the gesture (pinch, two-finger scroll).
			if (event.touches.length !== 1) {
				touch = null;
				return;
			}
			const first = event.touches[0];
			touch =
				first &&
				focusedTextEntry() &&
				Date.now() - lastScrollAt >= SCROLL_SETTLE_MS
					? { x: first.clientX, y: first.clientY, target: event.target }
					: null;
		};
		const onMove = (event: TouchEvent) => {
			const first = event.touches[0];
			if (
				touch &&
				first &&
				Math.hypot(first.clientX - touch.x, first.clientY - touch.y) > TAP_SLOP
			)
				touch = null;
		};
		const onCancel = () => {
			touch = null;
		};
		const onEnd = (event: TouchEvent) => {
			const start = touch;
			touch = null;
			if (
				!start ||
				event.touches.length > 0 ||
				event.changedTouches.length !== 1
			)
				return;
			const end = event.changedTouches[0];
			if (!end) return;
			if (Math.hypot(end.clientX - start.x, end.clientY - start.y) > TAP_SLOP)
				return;
			if (!focusedTextEntry()) return;
			const control = activatableControl(event.target);
			if (!control || control !== activatableControl(start.target)) return;
			// Keeps focus (and the keyboard) where it is and suppresses the synthesized click.
			event.preventDefault();
			control.click();
		};

		popup.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		popup.addEventListener("touchstart", onStart, { passive: true });
		popup.addEventListener("touchmove", onMove, { passive: true });
		popup.addEventListener("touchcancel", onCancel, { passive: true });
		popup.addEventListener("touchend", onEnd, { passive: false });
		cleanup.current = () => {
			popup.removeEventListener("scroll", onScroll, { capture: true });
			popup.removeEventListener("touchstart", onStart);
			popup.removeEventListener("touchmove", onMove);
			popup.removeEventListener("touchcancel", onCancel);
			popup.removeEventListener("touchend", onEnd);
		};
	}, []);
}
