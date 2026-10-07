/**
 * A phone or tablet: touch first, with no pointer that hovers. Mobile apps
 * are the model there, for a hidden page and for the keyboard alike.
 */
export function handheld(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/**
 * What Enter does in the composer. With a keyboard, Enter sends and
 * Shift+Enter starts a new line, as in desktop chat apps. On a phone or tablet
 * Enter starts a new line, as mobile chat apps do: an on-screen keyboard has
 * no Shift+Enter, and Send is a tap away.
 */
export function enterAction(event: Pick<KeyboardEvent, 'shiftKey'>, onHandheld: boolean): 'send' | 'newline' {
	return event.shiftKey || onHandheld ? 'newline' : 'send';
}
