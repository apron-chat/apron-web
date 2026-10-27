// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import ThreadItem from './ThreadItem.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(ThreadItem, { thread: 'deploy', name: 'Deploy', ...props });
	return document.querySelector<HTMLButtonElement>('button.ap-room')!;
}

const states = (row: HTMLElement) => ['ap-room-unread', 'ap-room-mention', 'ap-room-quiet', 'ap-room-unjoined'].filter((name) => row.classList.contains(name));

describe('ThreadItem', () => {
	it('marks a muted thread with a bell-off at the end of its row, before its count or time, its news quiet: no bold name, no tint for a mention, and a grey count', () => {
		let row = render({ muted: true, unread: 2, mentions: 1 });
		const bell = row.querySelector('.ap-muted')!;
		expect([bell.getAttribute('aria-label'), bell.nextElementSibling?.classList.contains('ap-count')]).toEqual(['Muted', true]);
		expect(states(row)).toEqual([]);
		expect(row.querySelector('.ap-count')?.classList.contains('ap-count-quiet')).toBe(true);
		dom.unmount();
		row = render({ muted: true, unjoined: true, ago: { text: '2h' } });
		expect(row.querySelector('.ap-muted')?.nextElementSibling?.tagName).toBe('TIME');
	});

	it('tints a joined thread with a mention and steps back one with nothing new, never one you haven’t joined', () => {
		expect(states(render({ mentions: 1 }))).toEqual(['ap-room-unread', 'ap-room-mention']);
		dom.unmount();
		expect(states(render({}))).toEqual(['ap-room-quiet']);
		dom.unmount();
		// Unjoined with or without Join on it, as where you only read.
		expect(states(render({ unjoined: true }))).toEqual(['ap-room-unjoined']);
		dom.unmount();
		expect(states(render({ unjoined: true, onjoin: () => {} }))).toEqual(['ap-room-unjoined']);
	});

	it('sits in a row that makes room for its action, and names Leave and Join for what they act on', () => {
		const onleave = vi.fn();
		const row = render({ title: 'Open it', onleave });
		expect(row.classList.contains('ap-room-nested')).toBe(true);
		expect(row.dataset.thread).toBe('deploy');
		expect(row.title).toBe('Open it');
		const leave = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-exit')!;
		expect([leave.title, leave.getAttribute('aria-label'), leave.dataset.leave]).toEqual(['Leave thread', 'Leave Deploy', 'deploy']);
		leave.click();
		expect(onleave).toHaveBeenCalledOnce();
		dom.unmount();
		render({ unjoined: true });
		expect(document.querySelector('.ap-roomrow-nested > .ap-room')).not.toBeNull();
		expect(document.querySelector('.ap-room-exit, .ap-room-join')).toBeNull();
		dom.unmount();
		const onjoin = vi.fn();
		render({ unjoined: true, onjoin });
		const join = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-join')!;
		expect([join.title, join.getAttribute('aria-label'), join.dataset.join]).toEqual(['Join thread', 'Join Deploy', 'deploy']);
		join.click();
		expect(onjoin).toHaveBeenCalledOnce();
	});

	it('ends a row with the count of the one being read, else when it was last active, and counts unread replies', () => {
		const ago = { text: '2h', datetime: '2026-10-22T10:00:00.000Z', title: 'Last active today' };
		let row = render({ unjoined: true, ago, count: 3 });
		expect(row.querySelector('[aria-label="3 messages"]')?.textContent).toBe('3');
		expect(row.querySelector('time')).toBeNull();
		dom.unmount();
		row = render({ unjoined: true, ago });
		const time = row.querySelector('time')!;
		expect([time.textContent, time.getAttribute('datetime'), time.getAttribute('title')]).toEqual(['2h', '2026-10-22T10:00:00.000Z', 'Last active today']);
		dom.unmount();
		row = render({ unread: 2 });
		expect(row.querySelector('[aria-label="2 unread replies"]')?.textContent).toBe('2');
	});

	it('lets the caller’s class join its own, and a click picks it', () => {
		const onselect = vi.fn();
		const row = render({ class: 'mine', onselect });
		expect(row.classList.contains('mine')).toBe(true);
		row.click();
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('names its thread in data-thread, or, unjoined, in data-other-thread, and data-thread too while it is open', () => {
		const names = (row: HTMLElement) => [row.dataset.thread, row.dataset.otherThread];
		expect(names(render({}))).toEqual(['deploy', undefined]);
		dom.unmount();
		expect(names(render({ unjoined: true }))).toEqual([undefined, 'deploy']);
		dom.unmount();
		expect(names(render({ unjoined: true, active: true }))).toEqual(['deploy', 'deploy']);
	});
});
