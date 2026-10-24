// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ThreadMarker from './ThreadMarker.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(ThreadMarker, { thread: 't1', name: 'Deploy', ...props });
}

const one = (selector: string) => document.querySelector(selector);

describe('ThreadMarker', () => {
	it('is a button naming the thread that opens it, a timeline row when asked, and dates its last reply, after what is new, when given the time', () => {
		const at = Date.UTC(2026, 8, 14, 9, 30);
		const onopen = vi.fn();
		render({ testid: 'thread-card', timelineItem: true, unread: 2, lastReply: '9h', lastReplyAt: at, summary: 'Lock held', latest: { sender: 'Ada', text: 'done' }, onopen });
		const card = dom.button(/^Deploy/);
		expect([card.dataset.testid, card.dataset.thread, card.hasAttribute('data-timeline-item')]).toEqual(['thread-card', 't1', true]);
		const time = card.querySelector('time')!;
		expect(time.previousElementSibling?.getAttribute('aria-label')).toBe('2 unread replies');
		expect([time.textContent, time.getAttribute('datetime')]).toEqual(['9h', new Date(at).toISOString()]);
		expect(time.title).toMatch(/^Last reply \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
		expect(card.textContent).toContain('Ada done');
		card.click();
		expect(onopen).toHaveBeenCalledOnce();
	});

	it('takes your own faces, and sits on a row of its own when asked', () => {
		const faces = createRawSnippet(() => ({ render: () => '<img class="mine" alt="">' }));
		render({ faces, row: true, private: true, lastReply: '2h' });
		expect(one('.ap-thread-row > .ap-thread-private .ap-thread-faces .mine')).not.toBeNull();
		expect(one('.ap-thread-name')?.firstElementChild?.getAttribute('aria-label')).toBe('Private');
		expect(one('span.ap-thread-last')?.getAttribute('title')).toBe('Last reply');
	});
});
