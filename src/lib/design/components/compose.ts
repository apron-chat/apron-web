/* What writing a message means to the keys and the text, shared by the Composer, the MessageEditor and the app. */

/**
 * What Enter does where a message is written. With a keyboard, Enter sends (or saves) and Shift+Enter starts a new
 * line, as in desktop chat apps. On a phone or tablet Enter starts a new line, as mobile chat apps do: an on-screen
 * keyboard has no Shift+Enter, and Send is a tap away.
 */
export function enterAction(event: Pick<KeyboardEvent, 'shiftKey'>, onHandheld: boolean): 'send' | 'newline' {
	return event.shiftKey || onHandheld ? 'newline' : 'send';
}

/**
 * A key an input method is still using, as part of a composition: any field that acts on Enter or the arrows ignores
 * it, or confirming a conversion (Japanese, Chinese, Korean) would send, pick or move instead. Safari fires the Enter
 * that commits a composition after `compositionend`, so `isComposing` is false then, but its `keyCode` is 229, as
 * during one.
 */
export function composing(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
	return event.isComposing || event.keyCode === 229;
}

/** Draft text that is a command (§4.1): one leading `/`. `//` posts a message that starts with `/`. */
export function isCommand(text: string): boolean {
	return text.startsWith('/') && !text.startsWith('//');
}
