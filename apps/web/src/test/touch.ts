import { fireEvent } from "@testing-library/react";

type Point = { x: number; y: number };

function touchEvent(
	type: string,
	target: Element,
	touches: Point[],
	changed: Point[],
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	const list = (points: Point[]) =>
		points.map((p, i) => ({
			identifier: i,
			target,
			clientX: p.x,
			clientY: p.y,
		}));
	Object.defineProperty(event, "touches", { value: list(touches) });
	Object.defineProperty(event, "changedTouches", { value: list(changed) });
	return event;
}

/**
 * Dispatches a one-finger touch sequence the way iOS does (touchstart, optional move, touchend)
 * and returns the touchend so a test can read `defaultPrevented`. A real finger does not fire the
 * synthesized click in jsdom, so a test that sees one knows the code under test produced it.
 * `beforeEnd` runs between the move and the touchend, for example to advance a fake clock.
 */
export function touchTap(
	target: Element,
	{
		at = { x: 100, y: 100 },
		moveTo = at,
		beforeEnd,
	}: { at?: Point; moveTo?: Point; beforeEnd?: () => void } = {},
) {
	fireEvent(target, touchEvent("touchstart", target, [at], [at]));
	if (moveTo !== at)
		fireEvent(target, touchEvent("touchmove", target, [moveTo], [moveTo]));
	beforeEnd?.();
	const end = touchEvent("touchend", target, [], [moveTo]);
	fireEvent(target, end);
	return end;
}

/** Two fingers down, one lifted: a pinch or two-finger scroll, never a tap. */
export function touchMultiTap(target: Element) {
	const a = { x: 100, y: 100 };
	const b = { x: 140, y: 100 };
	fireEvent(target, touchEvent("touchstart", target, [a], [a]));
	fireEvent(target, touchEvent("touchstart", target, [a, b], [b]));
	const end = touchEvent("touchend", target, [a], [b]);
	fireEvent(target, end);
	return end;
}

export function touchCancelled(target: Element) {
	const at = { x: 100, y: 100 };
	fireEvent(target, touchEvent("touchstart", target, [at], [at]));
	fireEvent(target, touchEvent("touchcancel", target, [], [at]));
	const end = touchEvent("touchend", target, [], [at]);
	fireEvent(target, end);
	return end;
}
