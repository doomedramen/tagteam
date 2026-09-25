import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ErrorBody {
	error: { code: string; message: string; details?: string[] };
}

export function fail(
	c: Context,
	status: ContentfulStatusCode,
	code: string,
	message: string,
	details?: string[],
) {
	const body: ErrorBody = {
		error: details ? { code, message, details } : { code, message },
	};
	return c.json(body, status);
}
