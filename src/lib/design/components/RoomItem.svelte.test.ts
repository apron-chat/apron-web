// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import RoomItem from './RoomItem.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	// Straight into the body: a test checks that a bare row has no wrapper.
	dom.render(RoomItem, { room: 'general', name: 'General', ...props }, { target: document.body });
	return document.querySelector<HTMLButtonElement>('button.ap-room')!;
}

describe('RoomItem', () => {
	it('names its actions for what they act on, Leave and the open room’s + for a new thread, in a row that makes room for them', () => {
		const onleave = vi.fn();
		const row = render({ title: 'Open it', onleave });
		expect(row.dataset.room).toBe('general');
		expect(row.title).toBe('Open it');
		const leave = document.querySelector<HTMLButtonElement>('.ap-roomrow > .ap-room-exit')!;
		expect([leave.title, leave.getAttribute('aria-label'), leave.dataset.leave]).toEqual(['Leave room', 'Leave General', 'general']);
		leave.click();
		expect(onleave).toHaveBeenCalledOnce();
		dom.unmount();
		// A room with no action is the bare row.
		expect(render({}).parentElement).toBe(document.body);
		dom.unmount();
		// The open room's + for a new thread sits beside its row.
		const onnewthread = vi.fn();
		render({ active: true, onnewthread });
		const add = dom.button('New thread in General');
		expect(add.previousElementSibling).toBe(dom.button('General'));
		add.click();
		expect(onnewthread).toHaveBeenCalledOnce();
	});

	it('ends a row with its unread bubble, and a … while history loads', () => {
		const row = render({ loading: true, unread: 2 });
		expect(row.classList.contains('ap-room-unread')).toBe(true);
		expect(row.querySelector('[aria-label="2 unread messages"]')?.textContent).toBe('2');
		expect(row.querySelector('.ap-room-loading')?.getAttribute('aria-label')).toBe('Loading history');
	});

	it('takes a class beside its own, and a click picks it', () => {
		const onselect = vi.fn();
		const row = render({ active: true, class: 'mine', onselect });
		expect([row.classList.contains('ap-room'), row.classList.contains('ap-room-active'), row.classList.contains('mine')]).toEqual([true, true, true]);
		expect(row.getAttribute('aria-current')).toBe('page');
		row.click();
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('names its room in data-room, or in data-join when it is listed to join', () => {
		let row = render({});
		expect([row.dataset.room, row.dataset.join]).toEqual(['general', undefined]);
		dom.unmount();
		row = render({ listed: true, topic: '12 members · Join' });
		expect([row.dataset.room, row.dataset.join]).toEqual([undefined, 'general']);
	});
});
