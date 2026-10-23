// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ThreadMarker from './ThreadMarker.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(ThreadMarker, { thread: 't1', name: 'Deploy', ...props });
}

const one = (selector: string) => document.querySelector(selector);

describe('ThreadMarker', () => {
	it('takes the card\'s data-testid as an attribute and its parts\' by name, and dates its last reply when given the time', () => {
		const at = Date.UTC(2026, 8, 14, 9, 30);
		render({
			'data-testid': 'thread-card', unreadTestid: 'thread-unread', lastReplyTestid: 'thread-last-reply', latestTestid: 'thread-preview-latest',
			unread: 2, lastReply: '9h', lastReplyAt: at, summary: 'Lock held', latest: { sender: 'Ada', text: 'done' }, 'data-timeline-item': ''
		});
		const card = one('[data-testid=thread-card]')!;
		expect(card.tagName).toBe('BUTTON');
		expect(card.getAttribute('data-thread')).toBe('t1');
		expect(card.hasAttribute('data-timeline-item')).toBe(true);
		expect(one('[data-testid=thread-unread] + time[data-testid=thread-last-reply]')?.getAttribute('datetime')).toBe(new Date(at).toISOString());
		expect(one('[data-testid=thread-last-reply]')?.getAttribute('title')).toMatch(/^Last reply \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
		expect(one('[data-testid=thread-preview-latest]')?.textContent).toBe('Ada done');
	});

	it('takes your own faces, and sits on a row of its own when asked', () => {
		const faces = createRawSnippet(() => ({ render: () => '<img class="mine" alt="">' }));
		render({ faces, row: true, private: true, lastReply: '2h' });
		expect(one('.ap-thread-row > .ap-thread-private .ap-thread-faces .mine')).not.toBeNull();
		expect(one('.ap-thread-name')?.firstElementChild?.getAttribute('aria-label')).toBe('Private');
		expect(one('span.ap-thread-last')?.getAttribute('title')).toBe('Last reply');
	});

	it('calls a thread with a blank title Untitled, its room_id on hover, on its card and its Moved to line', () => {
		render({ name: '' });
		expect(one('.ap-thread-name')?.textContent).toBe('Untitled');
		expect(one('.ap-thread-name')?.getAttribute('title')).toBe('t1');
		dom.unmount();
		render({ name: '  ', moved: true });
		expect(one('.ap-thread-moved button')?.textContent).toBe('Untitled');
		expect(one('.ap-thread-moved button')?.getAttribute('title')).toBe('t1');
	});
});
