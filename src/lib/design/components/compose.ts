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

/**
 * What a Composer asks of its draft as it changes. Worked out in one pass where the draft is written (`DraftField`) and
 * passed on only as one of them changes, so what reads a fact isn't asked again on every key, as it would be reading
 * the draft itself.
 */
export interface DraftFacts {
	/** Nothing but spaces, if anything: nothing to send. */
	blank: boolean;
	/** More than one line, by a line break. */
	multiline: boolean;
	/** A command (`isCommand`). */
	command: boolean;
	/** It may hold a link: every one previewed has `://`. */
	linked: boolean;
}

/** The facts of a draft's text. */
export function draftFacts(text: string): DraftFacts {
	return { blank: !text.trim(), multiline: text.includes('\n'), command: isCommand(text), linked: text.includes('://') };
}

/** The same facts: a draft whose facts are the same as before needs nothing that reads them asked again. */
export function sameFacts(a: DraftFacts, b: DraftFacts): boolean {
	return a.blank === b.blank && a.multiline === b.multiline && a.command === b.command && a.linked === b.linked;
}
