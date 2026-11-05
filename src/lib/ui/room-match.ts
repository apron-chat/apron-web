/**
 * How well a room's name matches what is typed, shared by the composer's `#` and search's `room:` suggestions
 * (`searchRooms`) and search's rooms and threads (`$lib/ui/room-search`): kept apart from the rest of that, which loads
 * only once search opens.
 */
import { folded } from './fold';

/** How well a name matches, best first: the whole of it, its start, the start of a word in it, anywhere in it, its description. */
export type MatchTier = 0 | 1 | 2 | 3 | 4;

/** What separates the words of a title, for a match at the start of one. */
const WORD_BREAK = /[\s\-_.,:;/()[\]#@&+|]/;

/**
 * Text folded once, however many queries it is matched against and however often the rooms are gathered afresh
 * (each change of the page's state gathers them anew). Bounded: past `FOLDS_KEPT` it starts over.
 */
const folds = new Map<string, string>();
const FOLDS_KEPT = 20_000;

function fold(text: string): string {
	let fold = folds.get(text);
	if (fold === undefined) {
		if (folds.size >= FOLDS_KEPT) folds.clear();
		fold = folded(text);
		folds.set(text, fold);
	}
	return fold;
}

function foldingOf(room: { id: string; title: string; description?: string }): { title: string; id: string; description: string } {
	return { title: fold(room.title.trim()), id: fold(room.id), description: room.description ? fold(room.description) : '' };
}

/** How `room` matches `wanted` (folded, trimmed, without a `#`), or undefined when it doesn't; its description counts only with `described`. */
export function matchTier(room: { id: string; title: string; description?: string }, wanted: string, described = false): MatchTier | undefined {
	if (!wanted) return 0;
	const { title, id, description } = foldingOf(room);
	if (title === wanted || id === wanted) return 0;
	if (title.startsWith(wanted) || id.startsWith(wanted)) return 1;
	for (let at = title.indexOf(wanted); at > 0; at = title.indexOf(wanted, at + 1)) if (WORD_BREAK.test(title[at - 1])) return 2;
	if (title.includes(wanted) || id.includes(wanted)) return 3;
	if (described && description.includes(wanted)) return 4;
	return undefined;
}

/** What is typed, as a match wants it: folded, trimmed, without a leading `#`. */
export function wantedOf(typed: string): string {
	return folded(typed.trim().replace(/^#/, ''));
}
