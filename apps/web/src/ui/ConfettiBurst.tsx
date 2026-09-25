import type { CSSProperties } from "react";

const PIECES = [
	{ x: -25, y: -17, rotation: -125, color: "var(--accent)" },
	{ x: -18, y: -29, rotation: 85, color: "var(--success)" },
	{ x: -7, y: -34, rotation: 160, color: "var(--warning)" },
	{ x: 8, y: -32, rotation: -70, color: "var(--danger)" },
	{ x: 21, y: -24, rotation: 115, color: "var(--av-purple-fg)" },
	{ x: 29, y: -8, rotation: -145, color: "var(--success)" },
	{ x: 27, y: 10, rotation: 65, color: "var(--warning)" },
	{ x: 17, y: 25, rotation: -95, color: "var(--accent)" },
	{ x: 2, y: 31, rotation: 135, color: "var(--danger)" },
	{ x: -14, y: 27, rotation: -35, color: "var(--av-purple-fg)" },
	{ x: -27, y: 13, rotation: 90, color: "var(--warning)" },
	{ x: -30, y: -3, rotation: -120, color: "var(--success)" },
];

export function ConfettiBurst() {
	return (
		<span aria-hidden className="pointer-events-none absolute inset-0 z-10">
			{PIECES.map((piece) => (
				<span
					key={`${piece.x}:${piece.y}`}
					className="confetti-piece absolute left-1/2 top-1/2 h-1.5 w-1 rounded-[1px]"
					style={
						{
							"--burst-x": `${piece.x}px`,
							"--burst-y": `${piece.y}px`,
							"--burst-rotation": `${piece.rotation}deg`,
							backgroundColor: piece.color,
						} as CSSProperties
					}
				/>
			))}
		</span>
	);
}
