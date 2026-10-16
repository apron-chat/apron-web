// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import type { ThreadEntry } from '$lib/ui/timeline';
import ThreadCard from './ThreadCard.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const hour = 60 * 60 * 1000;

function render(entry: Partial<ThreadEntry>) {
	instance = mount(ThreadCard, {
		target: document.body,
		props: { entry: { id: 't1', parentRoomId: 'general', title: 'Thread Example', loaded: true, participants: [], joined: true, ...entry }, onopen: vi.fn() }
	});
	flushSync();
}

const one = (selector: string) => document.querySelector(selector);

describe('ThreadCard', () => {
	it('shows its summary and its latest reply, each marked by an icon, as the sidebar does', () => {
		const id = String(Date.now() - 9 * hour);
		const latest = { message_id: id, room_id: 't1', from: { user_id: 'shazow', name: 'shazow' }, body: { text: 'test\ntest' } } as unknown as MessageRecord;
		render({ description: 'Old threads expired, adding a fresh one.', latestMessage: latest, lastReplyId: id });
		const lines = [...document.querySelectorAll('.ap-tline')].map((line) => [line.querySelector('svg')?.getAttribute('aria-label'), line.textContent]);
		expect(lines).toEqual([['Summary', 'Old threads expired, adding a fresh one.'], ['Latest message', 'shazow test test']]);
		expect(one('[data-testid="thread-preview-summary"]')?.classList.contains('ap-tline-multi')).toBe(true);
		expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('9h ago');
		expect(one('[data-testid="thread-last-reply"]')?.getAttribute('datetime')).toBe(new Date(Number(id)).toISOString());
	});

	it('names the day of a last reply older than two weeks, and keeps a recent one current', () => {
		vi.useFakeTimers();
		try {
			render({ lastReplyId: String(Date.now() - 4 * 60 * 1000) });
			expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('4m ago');
			vi.advanceTimersByTime(60_000);
			flushSync();
			expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('5m ago');
		} finally {
			vi.useRealTimers();
		}
		unmount(instance!);
		const old = Date.now() - 30 * 24 * hour;
		render({ lastReplyId: String(old) });
		expect(one('[data-testid="thread-last-reply"]')?.textContent).not.toMatch(/ago$/);
		expect(one('.ap-thread-2')).toBeNull();
	});
});
