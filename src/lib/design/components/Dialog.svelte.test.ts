// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog.svelte';
import * as dom from '$lib/test/dom';

// jsdom has no modal dialogs: `showModal` and `close` come from the stub, and Escape is the `cancel` event a browser fires for it.
beforeAll(dom.stubDialog);

function render(props: Record<string, unknown> = {}) {
	const state = $state<Record<string, unknown>>({ open: true, title: 'Edit room', children: dom.html('<p>Body <input aria-label="Title"></p>'), onclose: vi.fn(), ...props });
	dom.render(Dialog, state as never);
	return { dialog: dom.byRole<HTMLDialogElement>('dialog'), state };
}

/** Escape, as the browser turns it into a `cancel` on the open dialog; false when it was kept open. */
function escape(dialog: HTMLDialogElement): boolean {
	const cancelled = dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
	if (cancelled) dialog.close();
	flushSync();
	return cancelled;
}

/** A press that starts on `from` and is released (the click) on `to`. */
function press(from: Element, to: Element = from): void {
	from.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
	to.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

describe('Dialog', () => {
	it('opens as a modal named by its title, and closes on Escape or its close button, saying so', () => {
		const { dialog, state } = render();
		expect(dialog.open).toBe(true);
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Edit room');
		expect(escape(dialog)).toBe(true);
		expect([dialog.open, state.open]).toEqual([false, false]);
		expect(state.onclose).toHaveBeenCalledOnce();
		state.open = true;
		flushSync();
		dom.button('Close', dialog).click();
		flushSync();
		expect([dialog.open, state.open]).toEqual([false, false]);
		expect(state.onclose).toHaveBeenCalledTimes(2);
	});

	it('while locked, ignores Escape, its close button and the backdrop', () => {
		const { dialog, state } = render({ locked: true, backdropCloses: true });
		expect(escape(dialog)).toBe(false);
		expect(dom.button('Close', dialog).disabled).toBe(true);
		press(dialog);
		expect([dialog.open, state.open]).toEqual([true, true]);
		expect(state.onclose).not.toHaveBeenCalled();
		// Unlocked again, Escape closes it.
		state.locked = false;
		flushSync();
		expect(escape(dialog)).toBe(true);
		expect(state.open).toBe(false);
	});

	it('closes on the backdrop only where asked, and only for a press that started there', () => {
		let { dialog, state } = render();
		press(dialog);
		expect(dialog.open).toBe(true);
		dom.unmount();
		({ dialog, state } = render({ backdropCloses: true }));
		// A selection dragged out of the panel ends on the backdrop: it stays open.
		press(dom.byRole('textbox', 'Title'), dialog);
		expect(dialog.open).toBe(true);
		// A click inside the panel is the panel's.
		press(dom.byRole('textbox', 'Title'));
		expect(dialog.open).toBe(true);
		press(dialog);
		expect([dialog.open, state.open]).toEqual([false, false]);
		expect(state.onclose).toHaveBeenCalledOnce();
	});

	it('takes a class beside its own and its size', () => {
		const { dialog } = render({ size: 'md', class: 'mine' });
		expect([...dialog.classList]).toEqual(['ap-dialog', 'ap-dialog-md', 'mine']);
	});

	it('makes its body a form when it handles a submit', () => {
		const onsubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
		const { dialog } = render({ onsubmit, footer: dom.html('<button type="submit">Save</button>') });
		dom.button('Save', dialog).click();
		expect(onsubmit).toHaveBeenCalledOnce();
		expect(dialog.open).toBe(true);
	});
});
