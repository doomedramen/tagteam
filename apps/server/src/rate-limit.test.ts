import { expect, it } from "vitest";
import { createRateLimiter, REDEEM_LIMITS } from "./rate-limit";

const MINUTE = 60_000;

it("allows 5 per minute and 20 per hour per key", () => {
	const limiter = createRateLimiter(REDEEM_LIMITS);
	let now = 0;
	for (let i = 0; i < 5; i++) expect(limiter.attempt("u1", now)).toBe(true);
	expect(limiter.attempt("u1", now)).toBe(false);
	expect(limiter.attempt("u2", now)).toBe(true);

	for (let minute = 1; minute <= 3; minute++) {
		now = minute * MINUTE + 1;
		for (let i = 0; i < 5; i++) expect(limiter.attempt("u1", now)).toBe(true);
	}
	now = 4 * MINUTE + 2;
	expect(limiter.attempt("u1", now)).toBe(false);

	now = 60 * MINUTE + 1;
	expect(limiter.attempt("u1", now)).toBe(true);
});
