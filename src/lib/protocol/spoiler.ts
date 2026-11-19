/**
 * A spoiler (`||text||`, `markdown.ts`): a span of this class, a button until it is clicked (`$lib/ui/spoilers`),
 * named only by its label so a screen reader doesn't read what it hides either.
 */
export const SPOILER = 'ap-spoiler';
/** A spoiler shown: no longer a button, its text read and drawn. */
export const SPOILER_SHOWN = 'ap-spoiler-shown';
export const SPOILER_LABEL = 'Spoiler';
/** A spoiler where its text isn't drawn (a quote, a card, a notification): the same however long the text was. */
export const SPOILER_TEXT = '▒▒▒▒▒';

/** `||text||` in Markdown as written, roughly: from a `||` before a non-space to the next `||` after one. */
const WRITTEN = /(?<!\\)\|\|(?=\S)[\s\S]*?\S\|\|/g;

/**
 * Markdown as written with each spoiler as `SPOILER_TEXT`, for where it is shown without being rendered (a push
 * notification, a thread's latest line, a title from a message). Without a parser, so where it errs it hides more
 * than renders as a spoiler (`||` in code too), rather than less.
 */
export function maskSpoilers(markdown: string): string {
	return markdown.includes('||') ? markdown.replace(WRITTEN, SPOILER_TEXT) : markdown;
}
