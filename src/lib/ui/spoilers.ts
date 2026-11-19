import { SPOILER, SPOILER_SHOWN } from '$lib/protocol/spoiler';

/** A spoiler not yet shown. */
const HIDDEN = `.${SPOILER}:not(.${SPOILER_SHOWN})`;

/** Shows a spoiler: its text drawn and read, and no longer a button. It keeps the focus, if it had it. */
export function showSpoiler(spoiler: Element): void {
	spoiler.classList.add(SPOILER_SHOWN);
	spoiler.setAttribute('tabindex', '-1');
	for (const name of ['role', 'aria-label']) spoiler.removeAttribute(name);
}

/**
 * Shows each spoiler (`||text||`) clicked, or pressed with Enter or Space, wherever markup shows one: a message, a
 * description, a document. Listened for once, on the whole document, ahead of everything else: the click or key
 * only shows it, so it opens no message, profile or link under it, which its hidden parts don't take anyway; in select
 * mode, or as a long press ends, the click is the message's. A spoiler
 * stays shown until its markup is drawn again.
 */
export function listenForSpoilers(doc: Document): () => void {
	const click = (event: MouseEvent): void => reveal(event, (event.target as Element | null)?.closest?.(HIDDEN));
	const key = (event: KeyboardEvent): void => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const target = event.target as Element | null;
		// A link whose label hides a spoiler shows it first, rather than going where the reader can't yet see.
		reveal(event, target?.matches?.(HIDDEN) ? target : event.key === 'Enter' ? target?.closest?.('a')?.querySelector(HIDDEN) : null);
	};
	doc.addEventListener('click', click, true);
	doc.addEventListener('keydown', key, true);
	return () => {
		doc.removeEventListener('click', click, true);
		doc.removeEventListener('keydown', key, true);
	};
}

/** Where a click picks a message (select mode) or ends a long press (its menu), the message has it, not the spoiler. */
const MESSAGE_TAKES = '.ap-msg-selectable, .ap-msg-held';

function reveal(event: Event, spoiler: Element | null | undefined): void {
	if (!spoiler || spoiler.closest(MESSAGE_TAKES)) return;
	event.preventDefault();
	event.stopPropagation();
	showSpoiler(spoiler);
}
