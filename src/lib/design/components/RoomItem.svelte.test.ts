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
	instance = mount(RoomItem, { target: document.body, props: { room: 'general', name: 'General', ...props } });
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.ap-room')!;
}

describe('RoomItem', () => {
	it('names Leave for what it acts on, in a row that makes room for it', () => {
		const onleave = vi.fn();
		const row = render({ 'data-room': 'general', title: 'Open it', onleave });
		expect(row.dataset.room).toBe('general');
		expect(row.title).toBe('Open it');
		const leave = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-exit')!;
		expect([leave.title, leave.getAttribute('aria-label'), leave.dataset.leave]).toEqual(['Leave room', 'Leave General', 'general']);
		leave.click();
		expect(onleave).toHaveBeenCalledOnce();
		unmount(instance!);
		// A room with no action is the bare row.
		expect(render({}).parentElement).toBe(document.body);
	});

	it('ends a row with its unread bubble, and a … while history loads', () => {
		const row = render({ loading: true, unread: 2, unreadTestid: 'room-unread' });
		expect(row.classList.contains('ap-room-unread')).toBe(true);
		expect(row.querySelector('[data-testid="room-unread"]')?.textContent).toBe('2');
		expect(row.querySelector('[data-testid="room-unread"]')?.getAttribute('aria-label')).toBe('2 unread messages');
		expect(row.querySelector('.ap-room-loading')?.getAttribute('aria-label')).toBe('Loading history');
	});

	it('gives the open room a + for a new thread, beside its row', () => {
		const onnewthread = vi.fn();
		render({ active: true, onnewthread, newThreadTestid: 'create-thread' });
		const add = document.querySelector<HTMLButtonElement>('.ap-roomstart > [data-testid="create-thread"]')!;
		expect(add.getAttribute('aria-label')).toBe('New thread in General');
		add.click();
		expect(onnewthread).toHaveBeenCalledOnce();
	});

	it('names a room with a blank title by its room_id, with no tooltip', () => {
		const room = render({ room: 'deploy', name: '  ' }).querySelector('.ap-room-name');
		expect(room?.textContent).toBe('deploy');
		expect(room?.hasAttribute('title')).toBe(false);
	});

	it('lets the caller’s attributes win: its class added, its click first, and preventDefault() skipping onselect', () => {
		const onselect = vi.fn();
		const order: string[] = [];
		let row = render({ active: true, class: 'mine', 'aria-current': 'true', onselect: () => order.push('select'), onclick: () => order.push('click') });
		expect([row.classList.contains('ap-room'), row.classList.contains('ap-room-active'), row.classList.contains('mine')]).toEqual([true, true, true]);
		expect(row.getAttribute('aria-current')).toBe('true');
		row.click();
		expect(order).toEqual(['click', 'select']);
		unmount(instance!);
		row = render({ onselect, onclick: (event: MouseEvent) => event.preventDefault() });
		row.click();
		expect(onselect).not.toHaveBeenCalled();
	});
});
