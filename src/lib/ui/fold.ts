/** Folding text for a search that ignores case and accents: messages (`$lib/ui/search`), and rooms by name (`$lib/ui/room-match`). */

/** Text all in ASCII, which has no accents and which normalizing leaves as it is. */
const ASCII = /^[\0-\x7f]*$/;

/**
 * Text as a search compares it: lowercase, without accents (`é` is `e`). A search folds every message kept, so
 * ASCII, as most are, only has its case folded: the same, without the cost of normalizing it.
 */
export function folded(text: string): string {
	return ASCII.test(text) ? text.toLowerCase() : text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}
