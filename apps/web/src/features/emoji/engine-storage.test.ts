import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageEngineStorage } from "./engine-storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the engine's device storage", () => {
	it("is not opted in by default, and remembers the choice", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readOptedIn()).toBe(false);
		storage.writeOptedIn(true);
		expect(createLocalStorageEngineStorage().readOptedIn()).toBe(true);
		storage.writeOptedIn(false);
		expect(createLocalStorageEngineStorage().readOptedIn()).toBe(false);
	});

	it("remembers why suggestions were switched off", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readAutoOff()).toBeNull();
		storage.writeAutoOff("crash");
		expect(storage.readAutoOff()).toBe("crash");
		storage.writeAutoOff(null);
		expect(storage.readAutoOff()).toBeNull();
	});

	it("remembers which asset version was downloaded", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readInstalled()).toBeNull();
		storage.writeInstalled("abc123");
		expect(storage.readInstalled()).toBe("abc123");
		storage.writeInstalled(null);
		expect(storage.readInstalled()).toBeNull();
	});

	it("keeps counters for the current asset version only", () => {
		const storage = createLocalStorageEngineStorage();
		const state = { version: "v1", loading: true, strikes: 1, failedStarts: 2 };
		storage.writeState(state);
		expect(storage.readState("v1")).toEqual(state);
		expect(storage.readState("v2")).toEqual({
			version: "v2",
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("starts afresh from damaged data", () => {
		const storage = createLocalStorageEngineStorage();
		localStorage.setItem("tagteam.emoji.state", "{not json");
		expect(storage.readState("v1").strikes).toBe(0);
		localStorage.setItem(
			"tagteam.emoji.state",
			JSON.stringify({
				version: "v1",
				loading: "yes",
				strikes: -3,
				failedStarts: 1.5,
			}),
		);
		expect(storage.readState("v1")).toEqual({
			version: "v1",
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("keeps working when localStorage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const storage = createLocalStorageEngineStorage();
		expect(storage.readOptedIn()).toBe(false);
		expect(storage.readAutoOff()).toBeNull();
		expect(storage.readInstalled()).toBeNull();
		expect(storage.readState("v1").strikes).toBe(0);
		expect(() => storage.writeState(storage.readState("v1"))).not.toThrow();
		expect(() => storage.writeAutoOff("crash")).not.toThrow();
		expect(() => storage.writeInstalled("v1")).not.toThrow();
	});
});
