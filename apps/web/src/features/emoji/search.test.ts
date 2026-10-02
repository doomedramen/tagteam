import { describe, expect, it } from "vitest";
import {
	BIT_BYTES,
	DIM,
	type EmojiIndex,
	quantiseIndex,
	rank,
	SHORTLIST,
	signBits,
} from "./search";

/** A repeatable pseudo-random vector with values in [-1, 1]. */
function vector(seed: number): Float32Array {
	let state = seed * 2654435761 + 1;
	const out = new Float32Array(DIM);
	for (let k = 0; k < DIM; k++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		out[k] = (state / 2 ** 32) * 2 - 1;
	}
	return out;
}

function indexOf(vectors: Float32Array[]): EmojiIndex {
	const all = new Float32Array(vectors.length * DIM);
	vectors.forEach((v, i) => {
		all.set(v, i * DIM);
	});
	const { bits, int8 } = quantiseIndex(all);
	return { count: vectors.length, bits, int8 };
}

describe("signBits", () => {
	it("sets bit k of byte k >> 3 when the value is above zero", () => {
		const v = new Float32Array(DIM);
		v[0] = 0.5; // byte 0, bit 0
		v[9] = 0.1; // byte 1, bit 1
		v[383] = 2; // byte 47, bit 7
		v[10] = -3;
		v[11] = 0;
		const bits = signBits(v);
		expect(bits).toHaveLength(BIT_BYTES);
		expect(bits[0]).toBe(0b00000001);
		expect(bits[1]).toBe(0b00000010);
		expect(bits[47]).toBe(0b10000000);
		const set = bits.reduce(
			(sum, byte) => sum + byte.toString(2).replaceAll("0", "").length,
			0,
		);
		expect(set).toBe(3);
	});

	it("reads from an offset", () => {
		const two = new Float32Array(DIM * 2);
		two[DIM + 2] = 1;
		expect(signBits(two, DIM)[0]).toBe(0b00000100);
		expect(signBits(two, 0)[0]).toBe(0);
	});
});

describe("quantiseIndex", () => {
	it("scales the largest absolute value to 127 and keeps signs", () => {
		const v = new Float32Array(DIM);
		v[0] = 0.5;
		v[1] = -0.3;
		const { int8, scale, bits } = quantiseIndex(v);
		expect(scale).toBeCloseTo(254);
		expect(int8[0]).toBe(127);
		expect(int8[1]).toBe(-76);
		expect(int8[2]).toBe(0);
		expect(bits[0]).toBe(0b00000001);
	});

	it("lays rows out one after another", () => {
		const { bits, int8 } = quantiseIndex(
			Float32Array.from([...vector(1), ...vector(2)]),
		);
		expect(bits).toHaveLength(2 * BIT_BYTES);
		expect(int8).toHaveLength(2 * DIM);
	});

	it("rejects partial vectors", () => {
		expect(() => quantiseIndex(new Float32Array(DIM + 1))).toThrow(
			/whole vectors/,
		);
	});
});

describe("rank", () => {
	const vectors = Array.from({ length: 200 }, (_, i) => vector(i + 1));
	const index = indexOf(vectors);

	it("puts an emoji first for a query equal to its vector", () => {
		for (const i of [0, 17, 133, 199])
			expect(rank(vectors[i], index).indices[0]).toBe(i);
	});

	it("returns at most the shortlist, best score first", () => {
		const { indices, scores } = rank(vectors[5], index);
		expect(indices).toHaveLength(SHORTLIST);
		expect(new Set(indices).size).toBe(SHORTLIST);
		for (let i = 1; i < scores.length; i++)
			expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
	});

	it("returns fewer when the catalog is smaller than the shortlist", () => {
		const small = indexOf(vectors.slice(0, 3));
		expect(rank(vectors[1], small).indices).toHaveLength(3);
	});

	it("re-ranks the shortlist by the int8 dot product, not by bits", () => {
		// Same sign pattern, so the same bits; the first is half as large, so it scores lower.
		const base = vector(7);
		const half = base.map((value) => value / 2);
		const swapped = indexOf([half, base]);
		const ranked = rank(base, swapped);
		expect(ranked.indices).toEqual([1, 0]);
		expect(ranked.scores[0]).toBeGreaterThan(ranked.scores[1]);
	});

	it("keeps catalog order for equal scores", () => {
		const base = vector(9);
		const twins = indexOf([base, base, base]);
		expect(rank(base, twins).indices).toEqual([0, 1, 2]);
	});

	it("rejects a query of the wrong length", () => {
		expect(() => rank(new Float32Array(10), index)).toThrow(/384/);
	});
});
