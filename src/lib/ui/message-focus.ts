/**
 * Moving the keyboard through the timeline's messages (`+page.svelte`'s `timelineKey`): ↑ in an empty composer goes to
 * the newest, then ↑ ↓ (Home End, Page Up Page Down) go from message to message, as drawn. Only people's messages
 * take part: a system line or a scoped notice has nothing to act on. Focus moves on the rows themselves (they are
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
