// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RoomItem from './RoomItem.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(RoomItem, { target: document.body, props: { room: 'deploy', name: 'Deploy', ...props } });
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.ap-room')!;
}

const states = (row: HTMLElement) => ['ap-room-unread', 'ap-room-mention', 'ap-room-quiet', 'ap-room-unjoined'].filter((name) => row.classList.contains(name));

describe('RoomItem', () => {
	it('tints a joined thread with a mention and steps back one with nothing new, never one you haven’t joined', () => {
		expect(states(render({ nested: true, mentions: 1 }))).toEqual(['ap-room-unread', 'ap-room-mention']);
		unmount(instance!);
		expect(states(render({ nested: true }))).toEqual(['ap-room-quiet']);
		unmount(instance!);
		// Unjoined with or without Join on it, as where you only read.
		expect(states(render({ nested: true, unjoined: true }))).toEqual(['ap-room-unjoined']);
		unmount(instance!);
		expect(states(render({ nested: true, onjoin: () => {} }))).toEqual(['ap-room-unjoined']);
	});

	it('wraps every thread in a row that makes room for its action, and names Leave and Join for what they act on', () => {
		const onleave = vi.fn();
		const row = render({ nested: true, 'data-thread': 'deploy', title: 'Open it', onleave });
		expect(row.dataset.thread).toBe('deploy');
		expect(row.title).toBe('Open it');
		const leave = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-exit')!;
		expect([leave.title, leave.getAttribute('aria-label'), leave.dataset.leave]).toEqual(['Leave thread', 'Leave Deploy', 'deploy']);
		leave.click();
		expect(onleave).toHaveBeenCalledOnce();
		unmount(instance!);
		render({ nested: true, unjoined: true });
		expect(document.querySelector('.ap-roomrow-nested > .ap-room')).not.toBeNull();
		expect(document.querySelector('.ap-room-exit, .ap-room-join')).toBeNull();
		unmount(instance!);
		render({ room: 'general', name: 'General', onjoin: () => {} });
		expect(document.querySelector('.ap-room-join')?.getAttribute('title')).toBe('Join room');
	});

	it('ends a row with the count of the one being read, else when it was last active, and a … while history loads', () => {
		let row = render({ nested: true, unjoined: true, ago: '2h', agoIso: '2026-10-22T10:00:00.000Z', agoTitle: 'Last active today', testid: 'other-thread', count: 3 });
		expect(row.querySelector('small.ap-room-count')?.getAttribute('aria-label')).toBe('3 messages');
		expect(row.querySelector('time')).toBeNull();
		unmount(instance!);
		row = render({ nested: true, unjoined: true, ago: '2h', agoIso: '2026-10-22T10:00:00.000Z', agoTitle: 'Last active today', testid: 'other-thread' });
		const time = row.querySelector('time[data-testid="other-thread-ago"]')!;
		expect([time.textContent, time.getAttribute('datetime'), time.getAttribute('title')]).toEqual(['2h', '2026-10-22T10:00:00.000Z', 'Last active today']);
		unmount(instance!);
		row = render({ loading: true, unread: 2, countTestid: 'room-unread' });
		expect(row.querySelector('[data-testid="room-unread"]')?.textContent).toBe('2');
		expect(row.querySelector('.ap-room-loading')?.getAttribute('aria-label')).toBe('Loading history');
	});

	it('gives the open room a + for a new thread, beside its row', () => {
		const onnewthread = vi.fn();
		render({ room: 'general', name: 'General', active: true, onnewthread });
		const add = document.querySelector<HTMLButtonElement>('.ap-roomstart > [data-testid="create-thread"]')!;
		expect(add.getAttribute('aria-label')).toBe('New thread in General');
		add.click();
		expect(onnewthread).toHaveBeenCalledOnce();
	});

	it('names a thread with a blank title by its room_id, as every place that names one does', () => {
		expect(render({ nested: true, name: '   ' }).querySelector('.ap-room-name')?.textContent).toBe('deploy');
		unmount(instance!);
		expect(render({ name: undefined }).querySelector('.ap-room-name')?.textContent).toBe('deploy');
	});
});
