// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThreadItem from './ThreadItem.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(ThreadItem, { target: document.body, props: { thread: 'deploy', name: 'Deploy', ...props } });
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.ap-room')!;
}

const states = (row: HTMLElement) => ['ap-room-unread', 'ap-room-mention', 'ap-room-quiet', 'ap-room-unjoined'].filter((name) => row.classList.contains(name));

describe('ThreadItem', () => {
	it('tints a joined thread with a mention and steps back one with nothing new, never one you haven’t joined', () => {
		expect(states(render({ mentions: 1 }))).toEqual(['ap-room-unread', 'ap-room-mention']);
		unmount(instance!);
		expect(states(render({}))).toEqual(['ap-room-quiet']);
		unmount(instance!);
		// Unjoined with or without Join on it, as where you only read.
		expect(states(render({ unjoined: true }))).toEqual(['ap-room-unjoined']);
		unmount(instance!);
		expect(states(render({ unjoined: true, onjoin: () => {} }))).toEqual(['ap-room-unjoined']);
	});

	it('sits in a row that makes room for its action, and names Leave and Join for what they act on', () => {
		const onleave = vi.fn();
		const row = render({ 'data-thread': 'deploy', title: 'Open it', onleave });
		expect(row.classList.contains('ap-room-nested')).toBe(true);
		expect(row.dataset.thread).toBe('deploy');
		expect(row.title).toBe('Open it');
		const leave = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-exit')!;
		expect([leave.title, leave.getAttribute('aria-label'), leave.dataset.leave]).toEqual(['Leave thread', 'Leave Deploy', 'deploy']);
		leave.click();
		expect(onleave).toHaveBeenCalledOnce();
		unmount(instance!);
		render({ unjoined: true });
		expect(document.querySelector('.ap-roomrow-nested > .ap-room')).not.toBeNull();
		expect(document.querySelector('.ap-room-exit, .ap-room-join')).toBeNull();
		unmount(instance!);
		const onjoin = vi.fn();
		render({ unjoined: true, onjoin });
		const join = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-join')!;
		expect([join.title, join.getAttribute('aria-label'), join.dataset.join]).toEqual(['Join thread', 'Join Deploy', 'deploy']);
		join.click();
		expect(onjoin).toHaveBeenCalledOnce();
	});

	it('ends a row with the count of the one being read, else when it was last active, and counts unread replies', () => {
		const ago = { text: '2h', datetime: '2026-10-22T10:00:00.000Z', title: 'Last active today' };
		let row = render({ unjoined: true, ago, agoTestid: 'other-thread-ago', count: 3 });
		expect(row.querySelector('small.ap-room-count')?.getAttribute('aria-label')).toBe('3 messages');
		expect(row.querySelector('time')).toBeNull();
		unmount(instance!);
		row = render({ unjoined: true, ago, agoTestid: 'other-thread-ago' });
		const time = row.querySelector('time[data-testid="other-thread-ago"]')!;
		expect([time.textContent, time.getAttribute('datetime'), time.getAttribute('title')]).toEqual(['2h', '2026-10-22T10:00:00.000Z', 'Last active today']);
		unmount(instance!);
		row = render({ unread: 2, unreadTestid: 'thread-unread' });
		expect(row.querySelector('[data-testid="thread-unread"]')?.getAttribute('aria-label')).toBe('2 unread replies');
	});

	it('marks its preview lines with ids from its prefix', () => {
		const row = render({ summary: 'What to check', latest: { sender: 'Dana', text: 'Done' }, linesTestid: 'thread-list' });
		expect(row.querySelector('[data-testid="thread-list-summary"]')?.textContent).toBe('What to check');
		expect(row.querySelector('[data-testid="thread-list-latest"]')?.textContent).toBe('Dana Done');
	});

	it('calls a thread with a blank title Untitled, its room_id on hover, as every place that names one does', () => {
		const thread = render({ name: '   ' }).querySelector('.ap-room-name');
		expect(thread?.textContent).toBe('Untitled');
		expect(thread?.getAttribute('title')).toBe('deploy');
	});

	it('lets the caller’s class join its own, and its click run first', () => {
		const order: string[] = [];
		const row = render({ class: 'mine', mentions: 1, onselect: () => order.push('select'), onclick: () => order.push('click') });
		expect(states(row)).toEqual(['ap-room-unread', 'ap-room-mention']);
		expect(row.classList.contains('mine')).toBe(true);
		row.click();
		expect(order).toEqual(['click', 'select']);
	});
});
