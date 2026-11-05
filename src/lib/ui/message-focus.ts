/**
 * Moving the keyboard through the timeline (`+page.svelte`'s `timelineKey`): ↑ in an empty composer goes to the newest
 * message, then ↑ ↓ (Home End, Page Up Page Down) go from one to the next, as drawn, ← → through a message's own links
 * and buttons, and Tab past the whole timeline, a single stop. Focus moves on the rows themselves (they are
 * `tabindex="-1"`), so moving it changes no state and redraws nothing.
 */
const ROWS = 'article.ap-msg[data-message-id]:not(.ap-msg-system)';

/** The messages the keys move between, oldest first, as drawn in `list`. */
export function messageRows(list: ParentNode): HTMLElement[] {
	return [...list.querySelectorAll<HTMLElement>(ROWS)];
}

/** Whether `element` is one of those rows (the keyboard on the row itself, not on something in it). */
export function isMessageRow(element: EventTarget | null): element is HTMLElement {
	return element instanceof HTMLElement && element.matches(ROWS);
}

/** What Tab can stop at. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
/** A row the keys stop at, with links and buttons of its own: a person's message or a scoped notice (not a system line). */
const ARTICLES = 'article[data-message-id]:not(.ap-msg-system)';

/** Whether `element` is drawn and can take the keyboard: not hidden, nor `visibility: hidden` (a toolbar off hover). */
function shown(element: HTMLElement): boolean {
	return element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

/**
 * What ↑ ↓ stop at in the timeline, in order: its messages and notices, and what between them takes the keyboard on
 * its own (a thread's card, a fold's …), since Tab no longer goes through the timeline (`tabbableOutside`).
 */
export function timelineItems(list: ParentNode): HTMLElement[] {
	return [...list.querySelectorAll<HTMLElement>(`${ARTICLES}, ${TABBABLE}`)].filter((element) => element.matches(ARTICLES) || (!element.closest('article[data-message-id]') && element.tabIndex >= 0));
}

/** The message or notice `element` is in (or is), if any. */
export function articleOf(element: Element): HTMLElement | undefined {
	return element.closest<HTMLElement>(ARTICLES) ?? undefined;
}

/** A row's own links and buttons, in order, as shown (its toolbar's, while the keyboard is on it, among them): what ← → go through. */
export function rowControls(row: HTMLElement): HTMLElement[] {
	return [...row.querySelectorAll<HTMLElement>(TABBABLE)].filter(shown);
}

/**
 * The first place Tab goes past `list` (`forward`), or Shift+Tab before it: the timeline is one stop, and its links and
 * buttons are reached from its rows (← →) rather than one Tab at a time. Undefined at the page's end.
 */
export function tabbableOutside(list: HTMLElement, forward: boolean): HTMLElement | undefined {
	const outside = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => !list.contains(element) && !element.closest('[inert]') && shown(element));
	if (forward) return outside.find((element) => list.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
	return outside.findLast((element) => list.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
}

/** The keys that move between messages, and where each goes. */
export type MessageStep = 'previous' | 'next' | 'first' | 'last' | 'pageUp' | 'pageDown';

export const MESSAGE_STEPS: Readonly<Record<string, MessageStep>> = {
	ArrowUp: 'previous',
	ArrowDown: 'next',
	Home: 'first',
	End: 'last',
	PageUp: 'pageUp',
	PageDown: 'pageDown'
};

/**
 * The row `step` goes to from `from` among `rows` (oldest first), `perPage` rows to a page: undefined past either end,
 * where ↑ asks for older messages and ↓ goes back to the composer.
 */
export function stepMessage(rows: readonly HTMLElement[], from: HTMLElement, step: MessageStep, perPage = 1): HTMLElement | undefined {
	const at = rows.indexOf(from);
	if (at < 0) return rows.at(-1);
	const page = Math.max(1, perPage);
	switch (step) {
		case 'previous': return rows[at - 1];
		case 'next': return rows[at + 1];
		case 'first': return at === 0 ? undefined : rows[0];
		case 'last': return at === rows.length - 1 ? undefined : rows.at(-1);
		case 'pageUp': return at === 0 ? undefined : rows[Math.max(0, at - page)];
		case 'pageDown': return at === rows.length - 1 ? undefined : rows[Math.min(rows.length - 1, at + page)];
	}
}
