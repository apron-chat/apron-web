import { SPOILER, SPOILER_SHOWN } from '$lib/protocol/spoiler';

/** A spoiler not yet shown. */
const HIDDEN = `.${SPOILER}:not(.${SPOILER_SHOWN})`;

/** Shows a spoiler: its text drawn and read, and no longer a button. */
export function showSpoiler(spoiler: Element): void {
	spoiler.classList.add(SPOILER_SHOWN);
	for (const name of ['tabindex', 'role', 'aria-label']) spoiler.removeAttribute(name);
}

/**
 * Shows each spoiler (`||text||`) clicked, or pressed with Enter or Space, wherever markup shows one: a message, a
 * description, a document. Listened for once, on the whole document, ahead of everything else: the click or key
 * only shows it, so it opens no message, profile or link under it, which its hidden parts don't take anyway. A spoiler
 * stays shown until its markup is drawn again.
 */
export function listenForSpoilers(doc: Document): () => void {
	const click = (event: MouseEvent): void => reveal(event, (event.target as Element | null)?.closest?.(HIDDEN));
	const key = (event: KeyboardEvent): void => {
		if (event.key === 'Enter' || event.key === ' ') reveal(event, (event.target as Element | null)?.matches?.(HIDDEN) ? (event.target as Element) : null);
	};
	doc.addEventListener('click', click, true);
	doc.addEventListener('keydown', key, true);
	return () => {
		doc.removeEventListener('click', click, true);
		doc.removeEventListener('keydown', key, true);
	};
}

function reveal(event: Event, spoiler: Element | null | undefined): void {
	if (!spoiler) return;
	event.preventDefault();
	event.stopPropagation();
	showSpoiler(spoiler);
}
