// Which emoji the automatic pick may choose. No imports, so scripts/eval-emoji.mjs can load this
// file directly (Node strips the types). Spec §7: flags, the symbols group and clock faces gave
// the worst literal-word matches in the spike, so they can be left out of automatic suggestions
// (they stay in the picker). The spike's evaluation gates the switch: run
// `pnpm --filter @tagteam/web emoji:eval` and set the flag below as it says.

/**
 * True: automatic suggestions skip flags, symbols and clock faces. Stays false unless the
 * evaluation shows that skipping them does not lower first-pick accuracy.
 */
export const AUTO_PICK_EXCLUSION = false;

const EXCLUDED_GROUPS = new Set(["flags", "symbols"]);
// "one o’clock" (U+2019) and "one-thirty": the 24 clock faces in "travel & places".
const CLOCK_FACE = /^[a-z]+ o’clock$|^[a-z]+-thirty$/;

export interface AutoPickEntry {
	/** Name, for example "one o’clock". */
	n: string;
	/** Group, for example "flags". */
	g: string;
}

/** True for an emoji that an automatic suggestion must not offer. */
export function isAutoPickExcluded(entry: AutoPickEntry): boolean {
	return EXCLUDED_GROUPS.has(entry.g) || CLOCK_FACE.test(entry.n);
}
