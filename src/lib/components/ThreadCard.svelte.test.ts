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

function render(entry: Partial<ThreadEntry>, news: { unread?: number; mentions?: number } = {}) {
	instance = mount(ThreadCard, {
		target: document.body,
		props: { entry: { id: 't1', parentRoomId: 'general', title: 'Thread Example', loaded: true, participants: [], joined: true, ...entry }, ...news, onopen: vi.fn() }
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
		expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('9h');
		expect(one('[data-testid="thread-last-reply"]')?.getAttribute('datetime')).toBe(new Date(Number(id)).toISOString());
	});

	it('shows what is new beside the time instead of a message count, and leads its title with the lock', () => {
		render({ count: 4, private: true, description: 'some day this will be a living summary of the thread', lastReplyId: String(Date.now() - hour) });
		expect(document.body.textContent).not.toContain('4 messages');
		expect(one('[data-testid="thread-unread"]')).toBeNull();
		expect(one('.ap-thread-name')?.firstElementChild?.getAttribute('aria-label')).toBe('Private');
		expect(one('.ap-thread-private')).not.toBeNull();
		unmount(instance!);
		render({ count: 4, lastReplyId: String(Date.now() - hour) }, { unread: 2, mentions: 1 });
		expect(one('.ap-thread-private')).toBeNull();
		expect(one('[data-testid="thread-unread"]')?.getAttribute('aria-label')).toBe('2 unread replies, a mention of you');
		expect(one('[data-testid="thread-unread"] + [data-testid="thread-last-reply"]')?.textContent).toBe('1h');
	});

	it('names the day of a last reply older than two weeks, and keeps a recent one current', () => {
		vi.useFakeTimers();
		try {
			render({ lastReplyId: String(Date.now() - 4 * 60 * 1000) });
			expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('4m');
			vi.advanceTimersByTime(60_000);
			flushSync();
			expect(one('[data-testid="thread-last-reply"]')?.textContent).toBe('5m');
		} finally {
			vi.useRealTimers();
		}
		unmount(instance!);
		const old = Date.now() - 30 * 24 * hour;
		render({ lastReplyId: String(old) });
		expect(one('[data-testid="thread-last-reply"]')?.textContent).not.toMatch(/^\d+[mhd]$/);
		expect(one('.ap-thread-2')).toBeNull();
	});
});
