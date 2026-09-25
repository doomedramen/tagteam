import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessExpiredError, ApiError, apiFetch, OfflineError } from "./api";

const respond = (
	body: BodyInit | null,
	init: ResponseInit & { type?: ResponseType } = {},
) => {
	const make = (): Response => {
		let res: Response;
		try {
			res = new Response(body, init);
		} catch {
			// jsdom/undici reject status 0; build a minimal opaque-redirect stand-in.
			res = {
				type: init.type,
				status: init.status,
				headers: new Headers(init.headers),
				ok: false,
				json: async () => {
					throw new Error("no body");
				},
			} as unknown as Response;
		}
		if (init.type) Object.defineProperty(res, "type", { value: init.type });
		return res;
	};
	// Fresh Response per call: a body can only be read once, and a test may call apiFetch twice.
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation(async () => make()),
	);
};
const json = { "content-type": "application/json" };

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
	it("returns parsed JSON and sends JSON bodies", async () => {
		respond(JSON.stringify({ ok: true }), { headers: json });
		expect(
			await apiFetch("/api/x", { method: "POST", body: { a: 1 } }),
		).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith(
			"/api/x",
			expect.objectContaining({
				method: "POST",
				body: '{"a":1}',
				redirect: "manual",
				credentials: "same-origin",
			}),
		);
	});

	it("throws ApiError with the server's code and details", async () => {
		respond(
			JSON.stringify({
				error: { code: "invalid_request", message: "Bad", details: ["x"] },
			}),
			{ status: 400, headers: json },
		);
		await expect(apiFetch("/api/x")).rejects.toMatchObject({
			status: 400,
			code: "invalid_request",
			message: "Bad",
			details: ["x"],
		});
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError);
	});

	it("treats redirects and HTML as an expired Access session", async () => {
		respond(null, { status: 0 as never, type: "opaqueredirect" });
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(AccessExpiredError);
		respond("<html>login</html>", { headers: { "content-type": "text/html" } });
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(AccessExpiredError);
	});

	it("treats network failures as offline", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
		);
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(OfflineError);
	});

	it("returns undefined for 204", async () => {
		respond(null, { status: 204 });
		expect(await apiFetch("/api/x")).toBeUndefined();
	});
});
