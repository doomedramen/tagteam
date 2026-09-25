export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: string[],
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** The Cloudflare Access session ended: API calls are redirected to its login page. */
export class AccessExpiredError extends Error {
	constructor() {
		super("Your session expired.");
		this.name = "AccessExpiredError";
	}
}

export class OfflineError extends Error {
	constructor() {
		super("You're offline.");
		this.name = "OfflineError";
	}
}

export async function apiFetch<T>(
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: init.method ?? "GET",
			credentials: "same-origin",
			redirect: "manual",
			headers:
				init.body === undefined ? {} : { "content-type": "application/json" },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
	} catch {
		throw new OfflineError();
	}
	if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
		throw new AccessExpiredError();
	if (res.status === 204) return undefined as T;
	if (!res.headers.get("content-type")?.includes("application/json"))
		throw new AccessExpiredError();
	const body = (await res.json()) as unknown;
	if (!res.ok) {
		const error =
			(
				body as {
					error?: { code?: string; message?: string; details?: string[] };
				}
			).error ?? {};
		throw new ApiError(
			res.status,
			error.code ?? "unknown",
			error.message ?? "Something went wrong.",
			error.details,
		);
	}
	return body as T;
}
