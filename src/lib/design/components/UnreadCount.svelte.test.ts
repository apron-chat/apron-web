// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import UnreadCount from './UnreadCount.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: { unread: number; mentions: number; noun?: 'message' | 'reply' }): HTMLElement | null {
	instance = mount(UnreadCount, { target: document.body, props });
	flushSync();
	return document.querySelector('.ap-count');
}

describe('UnreadCount', () => {
	it('counts unread messages in grey, and turns orange with an @ when they include a mention', () => {
		const quiet = render({ unread: 12, mentions: 0 })!;
		expect([quiet.className, quiet.textContent, quiet.getAttribute('aria-label')]).toEqual(['ap-count ap-count-quiet', '12', '12 unread messages']);
		unmount(instance!);
		const mention = render({ unread: 12, mentions: 2 })!;
		expect([mention.className, mention.textContent, mention.getAttribute('aria-label')]).toEqual(['ap-count ap-count-at', '@ 12', '12 unread messages, 2 mentions of you']);
	});

	it('shows nothing with nothing new, caps at 99+, and counts a mention added by an edit', () => {
		expect(render({ unread: 0, mentions: 0 })).toBeNull();
		unmount(instance!);
		expect(render({ unread: 250, mentions: 0 })?.textContent).toBe('99+');
		unmount(instance!);
		const edited = render({ unread: 0, mentions: 1, noun: 'reply' })!;
		expect([edited.textContent, edited.getAttribute('aria-label')]).toEqual(['@ 1', '1 unread reply, a mention of you']);
	});
});
