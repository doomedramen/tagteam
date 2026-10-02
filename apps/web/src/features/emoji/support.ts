/**
 * True when this browser can run the model: WebAssembly, the Cache API and module workers.
 * Module workers have no direct test, so a throwaway worker is created with a `type` getter;
 * a browser that supports them reads it.
 */
export function detectSupport(env: typeof globalThis = globalThis): boolean {
	if (typeof env.WebAssembly !== "object") return false;
	if (!("caches" in env)) return false;
	if (typeof env.Worker !== "function") return false;
	let reads = false;
	try {
		const probe = new env.Worker("data:text/javascript,", {
			get type() {
				reads = true;
				return "module" as const;
			},
		});
		probe.terminate();
	} catch {
		return false;
	}
	return reads;
}
