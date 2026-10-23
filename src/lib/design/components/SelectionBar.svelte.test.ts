// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SelectionBar from './SelectionBar.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(SelectionBar, { target: document.body, props: { count: 2, ...props } });
	flushSync();
}

const buttons = () => [...document.querySelectorAll('button')].map((button) => button.textContent);

describe('SelectionBar', () => {
	it('offers the room first in the menu, and closes it on a pick', () => {
		const onmove = vi.fn();
		render({ room: 'general', threads: [{ thread: 't1', name: 'Deploy' }], open: true, onmove });
		const items = [...document.querySelectorAll('[role=option]')];
		expect(items.map((item) => item.textContent)).toEqual(['Move to room', 'Deploy']);
		expect(items[1].getAttribute('data-thread')).toBe('t1');
		expect(document.querySelector('[role=listbox]')?.getAttribute('aria-label')).toBe('Move to thread');
		(items[0] as HTMLButtonElement).click();
		flushSync();
		expect(onmove).toHaveBeenCalledWith('general');
		expect(document.querySelector('[role=listbox]')).toBeNull();
	});

	it('shows the menu for the room alone, and New thread and Select between only when you can use them', () => {
		render({ room: 'general' });
		expect(buttons()).toEqual(['Cancel', 'Move to thread ▾']);
		unmount(instance!);
		render({ onnewthread: vi.fn(), onselectrange: vi.fn(), newThreadTestid: 'new', 'data-testid': 'bar' });
		expect(buttons()).toEqual(['Select between', 'Cancel', 'New thread']);
		expect(document.querySelector('[data-testid=bar]')?.getAttribute('role')).toBe('toolbar');
		expect(document.querySelector('[data-testid=new]')?.textContent).toBe('New thread');
	});

	it('says how many messages the server refused to move', () => {
		render({ denied: { failed: 1, total: 3 } });
		expect(document.querySelector('[role=alert]')?.textContent).toBe('1 of 3 couldn’t be moved');
	});

	it('calls a destination thread with a blank title Untitled, its room_id on hover, isolated from the menu’s direction', () => {
		render({ threads: [{ thread: 't1', name: ' ' }, { thread: 't2', name: 'מסירה' }], open: true });
		const items = [...document.querySelectorAll('[role=option] bdi')];
		expect(items.map((item) => item.textContent)).toEqual(['Untitled', 'מסירה']);
		expect(items.map((item) => item.getAttribute('title'))).toEqual(['t1', null]);
	});
});
