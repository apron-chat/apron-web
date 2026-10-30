/* What writing a message means to the keys and the text, shared by the Composer, the MessageEditor and the app. */

/**
 * What Enter does where a message is written. With a keyboard, Enter sends (or saves) and Shift+Enter starts a new
 * line, as in desktop chat apps. On a phone or tablet Enter starts a new line, as mobile chat apps do: an on-screen
 * keyboard has no Shift+Enter, and Send is a tap away.
 */
export function enterAction(event: Pick<KeyboardEvent, 'shiftKey'>, onHandheld: boolean): 'send' | 'newline' {
	return event.shiftKey || onHandheld ? 'newline' : 'send';
}

/** Draft text that is a command (§4.1): one leading `/`. `//` posts a message that starts with `/`, and `/me` an action. */
export function isCommand(text: string): boolean {
	return text.startsWith('/') && !text.startsWith('//') && meAction(text) === undefined;
}

/** The action a one-line `/me waves` describes (`waves`), which posts as a message in italics. */
export function meAction(text: string): string | undefined {
	return /^\/me[ \t]+([^\n]+)$/i.exec(text.trim())?.[1].trim();
}
