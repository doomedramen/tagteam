// The search math, with no imports so the build and evaluation scripts can load it directly
// (Node strips the types). Used by the worker and by scripts/build-emoji-index.mjs and
// scripts/eval-emoji.mjs.

/** bge-small-en-v1.5 embeds into 384 dimensions. */
export const DIM = 384;
/** One sign bit per dimension. */
export const BIT_BYTES = DIM / 8;
/** How many emoji the Hamming pass keeps for the int8 re-rank. */
export const SHORTLIST = 40;

/**
 * The emoji index. Entry `i` is the i-th emoji of catalog.json: `bits` holds its 384 sign bits
 * (bit `k` is byte `i * 48 + (k >> 3)`, bit `k & 7`, set when the value is above zero) and `int8`
 * its 384 values, each the float value times one global scale, rounded.
 */
export interface EmojiIndex {
	count: number;
	bits: Uint8Array;
	int8: Int8Array;
}

export interface Ranked {
	/** Catalog positions, best first. At most SHORTLIST of them. */
	indices: number[];
	/** The score of each one (dot product of the query with the int8 vector). Only the order matters. */
	scores: number[];
}

const POPCOUNT = new Uint8Array(256);
for (let i = 1; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

export function signBits(vector: ArrayLike<number>, offset = 0): Uint8Array {
	const bytes = new Uint8Array(BIT_BYTES);
	for (let k = 0; k < DIM; k++)
		if (vector[offset + k] > 0) bytes[k >> 3] |= 1 << (k & 7);
	return bytes;
}

/**
 * Builds the index from `count` float embeddings laid out one after another. The int8 scale is
 * one number for the whole catalog (127 over the largest absolute value), so ranking by the
 * dot product with the int8 vectors equals ranking by the dot product with the floats.
 */
export function quantiseIndex(embeddings: Float32Array): {
	bits: Uint8Array;
	int8: Int8Array;
	scale: number;
} {
	if (embeddings.length % DIM !== 0)
		throw new Error(`embeddings must hold whole vectors of ${DIM} numbers`);
	const count = embeddings.length / DIM;
	const bits = new Uint8Array(count * BIT_BYTES);
	for (let i = 0; i < count; i++)
		bits.set(signBits(embeddings, i * DIM), i * BIT_BYTES);
	let largest = 0;
	for (const value of embeddings) largest = Math.max(largest, Math.abs(value));
	const scale = largest === 0 ? 1 : 127 / largest;
	const int8 = new Int8Array(embeddings.length);
	for (let i = 0; i < embeddings.length; i++)
		int8[i] = Math.max(-127, Math.min(127, Math.round(embeddings[i] * scale)));
	return { bits, int8, scale };
}

/**
 * The emoji nearest to `query` (a normalised 384-number embedding): the SHORTLIST nearest by
 * Hamming distance of sign bits, re-ranked by the dot product of the float query with the int8
 * vectors. Ties keep catalog order.
 */
export function rank(
	query: ArrayLike<number>,
	index: EmojiIndex,
	shortlist = SHORTLIST,
): Ranked {
	if (query.length !== DIM)
		throw new Error(`query must hold ${DIM} numbers, got ${query.length}`);
	const queryBits = signBits(query);
	const distance = new Uint16Array(index.count);
	for (let i = 0, offset = 0; i < index.count; i++, offset += BIT_BYTES) {
		let sum = 0;
		for (let j = 0; j < BIT_BYTES; j++)
			sum += POPCOUNT[index.bits[offset + j] ^ queryBits[j]];
		distance[i] = sum;
	}
	const nearest = Array.from({ length: index.count }, (_, i) => i)
		.sort((a, b) => distance[a] - distance[b] || a - b)
		.slice(0, shortlist);
	const scored = nearest.map((i) => {
		let dot = 0;
		const offset = i * DIM;
		for (let k = 0; k < DIM; k++) dot += index.int8[offset + k] * query[k];
		return { i, dot };
	});
	scored.sort((a, b) => b.dot - a.dot || a.i - b.i);
	return { indices: scored.map((s) => s.i), scores: scored.map((s) => s.dot) };
}
