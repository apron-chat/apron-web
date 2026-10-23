// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import SelectionBar from './SelectionBar.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(SelectionBar, { count: 2, ...props });
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
		dom.unmount();
		render({ onnewthread: vi.fn(), onselectrange: vi.fn(), 'data-testid': 'bar' });
		expect(buttons()).toEqual(['Select between', 'Cancel', 'New thread']);
		expect(dom.byRole('toolbar', 'Selected messages').dataset.testid).toBe('bar');
	});

	it('says how many messages the server refused to move', () => {
		render({ denied: { failed: 1, total: 3 } });
		expect(document.querySelector('[role=alert]')?.textContent).toBe('1 of 3 couldn’t be moved');
	});

	it('isolates each destination thread’s name from the menu’s direction', () => {
		render({ threads: [{ thread: 't1', name: 'Deploy' }, { thread: 't2', name: 'מסירה' }], open: true });
		expect([...document.querySelectorAll('[role=option] bdi')].map((item) => item.textContent)).toEqual(['Deploy', 'מסירה']);
	});
});
