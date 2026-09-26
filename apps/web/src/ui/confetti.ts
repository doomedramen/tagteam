import confetti from "canvas-confetti";

function themeColors() {
	const styles = getComputedStyle(document.documentElement);
	return ["--accent", "--success", "--warning", "--danger", "--av-purple-fg"]
		.map((name) => styles.getPropertyValue(name).trim())
		.filter(Boolean);
}

export function fireScreenConfettiCannon() {
	const shared = {
		particleCount: 36,
		spread: 26,
		startVelocity: 62,
		gravity: 0.45,
		ticks: 170,
		scalar: 0.9,
		colors: themeColors(),
		disableForReducedMotion: true,
	};

	void confetti({
		...shared,
		angle: 55,
		origin: { x: -0.015, y: 1.015 },
	});
	void confetti({
		...shared,
		angle: 125,
		origin: { x: 1.015, y: 1.015 },
	});
}
