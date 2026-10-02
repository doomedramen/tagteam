import { describe, expect, it, vi } from "vitest";
import { createPersistentStorageRequester } from "./persist-storage";

const storage = (
	persisted: boolean | undefined,
	persist = vi.fn(async () => true),
) =>
	({
		persist,
		persisted:
			persisted === undefined ? undefined : vi.fn(async () => persisted),
	}) as unknown as StorageManager;

describe("createPersistentStorageRequester", () => {
	it("asks the browser to persist when storage is not persistent yet", async () => {
		const persist = vi.fn(async () => true);
		await createPersistentStorageRequester(() => storage(false, persist))();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("does not ask when storage is already persistent", async () => {
		const persist = vi.fn(async () => true);
		await createPersistentStorageRequester(() => storage(true, persist))();
		expect(persist).not.toHaveBeenCalled();
	});

	it("asks when the browser cannot say whether storage is persistent", async () => {
		const persist = vi.fn(async () => true);
		await createPersistentStorageRequester(() => storage(undefined, persist))();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("asks only once per requester, however often it is called", async () => {
		const persist = vi.fn(async () => false);
		const request = createPersistentStorageRequester(() =>
			storage(false, persist),
		);
		await Promise.all([request(), request()]);
		await request();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("does nothing, and does not throw, without the storage API", async () => {
		await expect(
			createPersistentStorageRequester(() => undefined)(),
		).resolves.toBeUndefined();
		const withoutPersist = {} as unknown as StorageManager;
		await expect(
			createPersistentStorageRequester(() => withoutPersist)(),
		).resolves.toBeUndefined();
	});

	it("ignores a refusal and a failure", async () => {
		await expect(
			createPersistentStorageRequester(() =>
				storage(
					false,
					vi.fn(async () => false),
				),
			)(),
		).resolves.toBeUndefined();
		const failing = vi.fn(async () => {
			throw new Error("denied");
		});
		await expect(
			createPersistentStorageRequester(() => storage(false, failing))(),
		).resolves.toBeUndefined();
	});
});
