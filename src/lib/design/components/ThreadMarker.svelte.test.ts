// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThreadMarker from './ThreadMarker.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(ThreadMarker, { target: document.body, props: { thread: 't1', name: 'Deploy', ...props } });
	flushSync();
}

const one = (selector: string) => document.querySelector(selector);

describe('ThreadMarker', () => {
	it('names its parts by the testid prefix, and dates its last reply when given the time', () => {
		const at = Date.UTC(2026, 8, 14, 9, 30);
		render({ testid: 'thread', unread: 2, lastReply: '9h', lastReplyAt: at, summary: 'Lock held', latest: { sender: 'Ada', text: 'done' }, 'data-timeline-item': '' });
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
});
