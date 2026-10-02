import { describe, expect, it } from "vitest";
import { detectSupport } from "./support";

class ModuleWorker {
	constructor(_url: string, options?: WorkerOptions) {
		void options?.type;
	}
	terminate() {}
}
class ClassicWorker {
	terminate() {}
}
const env = (patch: Record<string, unknown>) =>
	({
		WebAssembly: {},
		caches: {},
		Worker: ModuleWorker,
		...patch,
	}) as unknown as typeof globalThis;

describe("detectSupport", () => {
	it("is true when WebAssembly, the Cache API and module workers exist", () => {
		expect(detectSupport(env({}))).toBe(true);
	});

	it("is false without WebAssembly", () => {
		expect(detectSupport(env({ WebAssembly: undefined }))).toBe(false);
	});

	it("is false without the Cache API", () => {
		const { caches: _omit, ...rest } = {
			WebAssembly: {},
			caches: {},
			Worker: ModuleWorker,
		};
		expect(detectSupport(rest as unknown as typeof globalThis)).toBe(false);
	});

	it("is false without workers, or with workers that ignore the module type", () => {
		expect(detectSupport(env({ Worker: undefined }))).toBe(false);
		expect(detectSupport(env({ Worker: ClassicWorker }))).toBe(false);
	});

	it("is false when creating the probe worker throws", () => {
		class Throwing {
			constructor() {
				throw new Error("blocked");
			}
		}
		expect(detectSupport(env({ Worker: Throwing }))).toBe(false);
	});
});
