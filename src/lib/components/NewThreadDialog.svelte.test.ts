// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import NewThreadDialog from './NewThreadDialog.svelte';

let instance: ReturnType<typeof mount> | undefined;

beforeAll(() => {
	// jsdom has <dialog> without its modal methods.
	HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
	HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function field<T extends HTMLElement>(selector: string): T {
	return document.querySelector<T>(selector)!;
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	element.value = value;
	element.dispatchEvent(new Event('input'));
	flushSync();
}

async function submit(): Promise<void> {
	document.querySelector('form')!.requestSubmit();
	await tick();
	await Promise.resolve();
	await tick();
}

describe('NewThreadDialog', () => {
	type Props = { room?: { id: string; title: string; private?: boolean }; title?: string; summary?: string; moving?: number };
	function render(props: Props = {}, oncreate = vi.fn((_thread: { title: string; description?: string }) => Promise.resolve())) {
		const onclose = vi.fn();
		instance = mount(NewThreadDialog, { target: document.body, props: { room: { id: 'ops', title: 'ops' }, enabled: true, oncreate, onclose, ...props } });
		flushSync();
		return { oncreate, onclose };
	}
	const text = () => field('dialog').textContent ?? '';
	const submitLabel = () => field('dialog button[type="submit"]').textContent;

	it('starts from a message: its first line as the title, selected, and the message quoted as the summary', async () => {
		const { oncreate, onclose } = render({ title: 'Deploy failed', summary: '> Deploy failed\n>\n> Runner looked fine.' });
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.open).toBe(true);
		expect(dialog.classList.contains('ap-dialog-md')).toBe(true);
		expect(text()).toContain('Start thread');
		expect(text()).toContain('In ops');
		expect(field<HTMLTextAreaElement>('textarea').value).toBe('> Deploy failed\n>\n> Runner looked fine.');
		await tick();
		const input = field<HTMLInputElement>('input.ap-field');
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Deploy failed'.length]);
		type(input, '  Why the 4pm deploy failed ');
		await submit();
		expect(oncreate).toHaveBeenCalledWith({ title: 'Why the 4pm deploy failed', description: '> Deploy failed\n>\n> Runner looked fine.' });
		expect(onclose).toHaveBeenCalled();
	});

	it('starts from a room with nothing filled in, and needs a title', async () => {
		const { oncreate } = render();
		expect(field<HTMLInputElement>('input.ap-field').value).toBe('');
		expect(field<HTMLInputElement>('input.ap-field').placeholder).toBe('What it’s about');
		await submit();
		expect(oncreate).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a thread title.');
		type(field('input.ap-field'), 'Office move');
		await submit();
		// An empty summary sends no description.
		expect(oncreate).toHaveBeenCalledWith({ title: 'Office move' });
	});

	it('says what starting from a selection moves, and that a private room’s thread is private', () => {
		render({ room: { id: 'hr', title: 'Hiring', private: true }, title: 'Offer', moving: 3 });
		expect(text()).toContain('Move to a new thread');
		expect(text()).toContain('The 3 selected messages move into the new thread.');
		expect(text()).toContain('Private, like its room');
		expect(submitLabel()).toBe('Move 3 messages');
	});

	it('stays open with the reason when creating fails', async () => {
		const { onclose } = render({ title: 'Deploy' }, vi.fn(() => Promise.reject(new Error('Not allowed'))));
		await submit();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Not allowed');
		expect(field<HTMLDialogElement>('dialog').open).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
	});
});
