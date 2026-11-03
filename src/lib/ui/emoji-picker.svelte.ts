/**
 * The full emoji picker: one at a time, for whichever trigger opened it last.
 * `EmojiPopover` (mounted once, outside the timeline so nothing clips it)
 * draws the open request; triggers open, toggle and release it here.
 */
import type { EmojiMartData } from '@emoji-mart/data';
import { onDemand } from './on-demand';
import { AnchoredPopover } from './popover.svelte';

export interface EmojiPickerRequest {
	/** The button that opened the picker: the popover sits beside it, and Escape returns focus to it. */
	anchor: HTMLElement;
	/** A picked emoji, as its native text. The picker has closed by then. */
	onpick: (emoji: string) => void;
	/**
	 * What the pick is for, shown above the picker, such as the message a
	 * reaction goes on: new messages can scroll it away, or the sheet cover it.
	 */
	caption?: { lead: string; text: string };
}

class EmojiPicker extends AnchoredPopover<EmojiPickerRequest> {
	/** Hands a picked emoji to whoever opened the picker, closing it first. */
	pick(emoji: string): void {
		const current = this.current;
		if (!current) return;
		this.current = undefined;
		current.onpick(emoji);
	}
}

export const emojiPicker = new EmojiPicker();

/**
 * The one way a trigger lets go of the picker: when its button leaves the page, a picker it opened closes with it.
 * An attachment (`{@attach emojiAnchor}` on the button), whose cleanup releases; a button drawn inside another
 * component (the Composer's) is tied from an effect on the bound element instead, `$effect(() => emojiAnchor(button))`.
 */
export function emojiAnchor(node: HTMLElement): () => void {
	return () => emojiPicker.release(node);
}

export interface EmojiMart {
	Picker: typeof import('emoji-mart').Picker;
	data: EmojiMartData;
	/** English strings, passed in so the picker never fetches a locale. */
	i18n: Record<string, unknown>;
}

/**
 * The emoji data alone, fetched from this app's own origin the first time
 * shortcode autocomplete or a picker needs it: it isn't in the main bundle.
 */
export const loadEmojiData: () => Promise<EmojiMartData> = onDemand(() =>
	// The data package is its JSON (sets/15/native.json); its typings only describe the shape.
	(import('@emoji-mart/data') as Promise<unknown> as Promise<{ default: EmojiMartData }>).then((json) => json.default)
);

/**
 * emoji-mart and its bundled data, fetched from this app's own origin the
 * first time a picker opens: neither is in the main bundle. A failed load
 * is forgotten so the next open tries again.
 */
export const loadEmojiMart: () => Promise<EmojiMart> = onDemand(() =>
	Promise.all([import('emoji-mart'), loadEmojiData(), import('@emoji-mart/data/i18n/en.json')]).then(([mart, data, en]) => ({
		Picker: mart.Picker,
		data,
		// Apron's voice: no exclamation marks in UI copy.
		i18n: { ...en.default, search_no_results_1: 'No emoji found', search_no_results_2: 'Try another word' }
	}))
);
