import type { ErrorBody } from "@tagteam/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type { ErrorBody };

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
