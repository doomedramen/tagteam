// The labels in emoji-eval-titles.json use any spelling of an emoji, so compare without
// presentation selectors, skin tones, gender and direction suffixes. Shared by eval-emoji.mjs and
// its test.
export const norm = (emoji) =>
	emoji
		.replace(/\u{FE0F}/gu, "")
		.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
		.replace(/\u{200D}[\u{2640}\u{2642}\u{27A1}]/gu, "");
