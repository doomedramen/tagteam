import { createMiddleware } from "hono/factory";
import { fail } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects state-changing requests sent by a browser from another site (login CSRF).
 * Requests without an Origin header pass: browsers always send one on cross-site POSTs,
 * and Better Auth itself requires it whenever cookies are present.
 */
export const rejectUntrustedOrigin = (trustedOrigin: string) =>
	createMiddleware(async (c, next) => {
		const origin = c.req.header("origin");
		if (
			!SAFE_METHODS.has(c.req.method) &&
			origin !== undefined &&
			origin !== trustedOrigin
		) {
			return fail(
				c,
				403,
				"invalid_origin",
				"This request came from an untrusted site.",
			);
		}
		await next();
	});
