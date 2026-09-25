export interface RateLimitRule {
	windowMs: number;
	max: number;
}

/** Invite redeem limits (spec §4): 5 per minute and 20 per hour. */
export const REDEEM_LIMITS: RateLimitRule[] = [
	{ windowMs: 60_000, max: 5 },
	{ windowMs: 3_600_000, max: 20 },
];

/** In-memory sliding-window limiter. Single process only. */
export function createRateLimiter(rules: RateLimitRule[]) {
	const longest = Math.max(...rules.map((r) => r.windowMs));
	const hits = new Map<string, number[]>();

	return {
		/** Records an attempt and returns true if allowed; returns false (recording nothing) if over a limit. */
		attempt(key: string, now: number): boolean {
			const recent = (hits.get(key) ?? []).filter((t) => t > now - longest);
			const allowed = rules.every(
				(r) => recent.filter((t) => t > now - r.windowMs).length < r.max,
			);
			if (allowed) recent.push(now);
			if (recent.length > 0) hits.set(key, recent);
			else hits.delete(key);
			return allowed;
		},
	};
}
