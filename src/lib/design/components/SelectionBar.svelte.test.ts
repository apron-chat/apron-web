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
	it('offers the room first in the menu, each thread’s name isolated from its direction, and closes it on a pick', () => {
		const onmove = vi.fn();
		render({ room: 'general', threads: [{ thread: 't1', name: 'Deploy' }, { thread: 't2', name: 'מסירה' }], open: true, onmove });
		const items = [...document.querySelectorAll('[role=option]')];
		expect(items.map((item) => item.textContent)).toEqual(['Move to room', 'Deploy', 'מסירה']);
		expect([...document.querySelectorAll('[role=option] bdi')].map((item) => item.textContent)).toEqual(['Deploy', 'מסירה']);
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
		render({ onnewthread: vi.fn(), onselectrange: vi.fn(), testid: 'bar' });
		expect(buttons()).toEqual(['Select between', 'Cancel', 'New thread']);
	});

	it('offers Copy log, and says Copied only once the copy worked', async () => {
		const oncopy = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		render({ oncopy });
		expect(buttons()).toEqual(['Cancel', 'Copy log']);
		const copy = () => [...document.querySelectorAll('button')].find((button) => button.textContent !== 'Cancel') as HTMLButtonElement;
		copy().click();
		await vi.waitFor(() => expect(oncopy).toHaveBeenCalledTimes(1));
		flushSync();
		expect(buttons()).toEqual(['Cancel', 'Copy log']);
		copy().click();
		await vi.waitFor(() => expect(buttons()).toEqual(['Cancel', 'Copied']));
	});

	it('says how many messages the server refused to move', () => {
		render({ denied: { failed: 1, total: 3 } });
		expect(document.querySelector('[role=alert]')?.textContent).toBe('1 of 3 couldn’t be moved');
	});
});
