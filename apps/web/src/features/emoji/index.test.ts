import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadManifest,
	modelFilesDigest,
} from "../../../scripts/emoji-assets.mjs";
import { BIT_BYTES, DIM, type EmojiIndex, rank } from "./search";

const dir = import.meta.dirname;
const read = (path: string) => readFileSync(join(dir, path));
const catalogBytes = read("catalog.json");
const catalog = JSON.parse(catalogBytes.toString("utf8")) as unknown[];
const meta = JSON.parse(read("index/index.json").toString("utf8")) as {
	count: number;
	dim: number;
	shortlist: number;
	int8Scale: number;
	catalogSha256: string;
	modelFilesDigest: string;
};
const bitsFile = read("index/bits.bin");
const int8File = read("index/int8.bin");
const index: EmojiIndex = {
	count: meta.count,
	bits: new Uint8Array(bitsFile),
	int8: new Int8Array(int8File.buffer, int8File.byteOffset, int8File.length),
};

describe("the committed emoji index", () => {
	it("has one bit row and one int8 row for every catalog entry", () => {
		expect(meta.dim).toBe(DIM);
		expect(meta.count).toBe(catalog.length);
		expect(bitsFile.length).toBe(catalog.length * BIT_BYTES);
		expect(int8File.length).toBe(catalog.length * DIM);
	});

	it("was built from this catalog.json (rebuild it with `emoji:index` after changing the catalog)", () => {
		expect(meta.catalogSha256).toBe(
			createHash("sha256").update(catalogBytes).digest("hex"),
		);
	});

	it("was built for the model files the manifest pins (a different model needs a rebuilt index)", () => {
		expect(meta.modelFilesDigest).toBe(modelFilesDigest(loadManifest()));
	});

	it("has sign bits that agree with the int8 values", () => {
		let checked = 0;
		for (let i = 0; i < index.count; i += 7)
			for (let k = 0; k < DIM; k++) {
				const value = index.int8[i * DIM + k];
				if (Math.abs(value) < 2) continue;
				const bit = (index.bits[i * BIT_BYTES + (k >> 3)] >> (k & 7)) & 1;
				expect(bit, `emoji ${i}, dimension ${k}`).toBe(value > 0 ? 1 : 0);
				checked++;
			}
		expect(checked).toBeGreaterThan(50_000);
	});

	it("finds an emoji from its own stored vector", () => {
		for (const i of [0, 100, 777, 1500, catalog.length - 1]) {
			const query = Float32Array.from(
				index.int8.subarray(i * DIM, (i + 1) * DIM),
				(value) => value / meta.int8Scale,
			);
			expect(rank(query, index).indices[0], `emoji ${i}`).toBe(i);
		}
	});
});
