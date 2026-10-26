// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import UnreadCount from './UnreadCount.svelte';
import * as dom from '$lib/test/dom';

function render(props: { unread: number; mentions: number; quiet?: boolean; noun?: 'message' | 'reply' }): HTMLElement | null {
	dom.render(UnreadCount, props);
	return document.querySelector('.ap-count');
}

describe('UnreadCount', () => {
	it('counts unread messages in grey, up to 99+, and turns orange with an @ when they include a mention, an edit’s too; nothing with nothing new', () => {
		const quiet = render({ unread: 12, mentions: 0 })!;
		expect([quiet.className, quiet.textContent, quiet.getAttribute('aria-label')]).toEqual(['ap-count ap-count-quiet', '12', '12 unread messages']);
		expect(quiet.title).toBe('12 unread messages');
		dom.unmount();
		const mention = render({ unread: 12, mentions: 2 })!;
		expect([mention.className, mention.textContent, mention.getAttribute('aria-label')]).toEqual(['ap-count ap-count-at', '@ 12', '12 unread messages, 2 mentions of you']);
		dom.unmount();
		// Nothing with nothing new; capped at 99+; a mention added by an edit counts.
		expect(render({ unread: 0, mentions: 0 })).toBeNull();
		dom.unmount();
		expect(render({ unread: 250, mentions: 0 })?.textContent).toBe('99+');
		dom.unmount();
		const edited = render({ unread: 0, mentions: 1, noun: 'reply' })!;
		expect([edited.textContent, edited.getAttribute('aria-label')]).toEqual(['@ 1', '1 unread reply, a mention of you']);
	});

	it('stays grey when quiet, such as in a muted room, its mentions keeping their @ and label', () => {
		const muted = render({ unread: 4, mentions: 1, quiet: true })!;
		expect([muted.className, muted.textContent, muted.getAttribute('aria-label')]).toEqual(['ap-count ap-count-quiet', '@\u202f4', '4 unread messages, a mention of you']);
	});
});
