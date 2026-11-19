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
