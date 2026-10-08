// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import RoomEditor from './RoomEditor.svelte';
import StartThreadDialog from './StartThreadDialog.svelte';

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

describe('StartThreadDialog', () => {
	function render(createRoom = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'thread-1' }) }))) {
		const onstarted = vi.fn();
		const onclose = vi.fn();
		instance = mount(StartThreadDialog, {
			target: document.body,
			props: { client: { createRoom } as unknown as ChatClient, room: { id: 'ops', title: 'ops' }, title: 'Deploy failed', summary: '> Deploy failed\n>\n> Runner looked fine.', enabled: true, onstarted, onclose }
		});
		flushSync();
		return { createRoom, onstarted, onclose };
	}

	it('asks for a title, with the message quoted as the summary, in a centered dialog', async () => {
		const { createRoom, onstarted, onclose } = render();
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.open).toBe(true);
		expect(dialog.classList.contains('ap-dialog-md')).toBe(true);
		expect(dialog.textContent).toContain('Start thread');
		expect(dialog.textContent).toContain('In ops');
		expect(field<HTMLInputElement>('input.ap-field').value).toBe('Deploy failed');
		expect(field<HTMLTextAreaElement>('textarea').value).toBe('> Deploy failed\n>\n> Runner looked fine.');
		type(field('input.ap-field'), '  Why the 4pm deploy failed ');
		await submit();
		expect(createRoom).toHaveBeenCalledWith({ parentRoomId: 'ops', title: 'Why the 4pm deploy failed', description: '> Deploy failed\n>\n> Runner looked fine.' });
		expect(onstarted).toHaveBeenCalledWith('thread-1');
		expect(onclose).toHaveBeenCalled();
	});

	it('needs a title, and starts without a summary when it is emptied', async () => {
		const { createRoom } = render();
		type(field('input.ap-field'), ' ');
		await submit();
		expect(createRoom).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a thread title.');
		type(field('input.ap-field'), 'Deploy');
		type(field('textarea'), '');
		await submit();
		expect(createRoom).toHaveBeenCalledWith({ parentRoomId: 'ops', title: 'Deploy' });
	});

	it('stays open with the server’s answer when it declines', async () => {
		const { onstarted, onclose } = render(vi.fn(() => ({ promise: Promise.reject(new Error('Not allowed')) })));
		await submit();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Not allowed');
		expect(field<HTMLDialogElement>('dialog').open).toBe(true);
		expect(onstarted).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});
});

describe('RoomEditor', () => {
	it('edits a thread in the same centered dialog', async () => {
		const updateRoom = vi.fn(() => ({ promise: Promise.resolve({}) }));
		const onclose = vi.fn();
		instance = mount(RoomEditor, {
			target: document.body,
			props: { client: { updateRoom } as unknown as ChatClient, room: { id: 't1', title: 'Deploy', description: 'Old' }, thread: true, enabled: true, onclose }
		});
		flushSync();
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.classList.contains('ap-dialog-md')).toBe(true);
		expect(dialog.textContent).toContain('Edit thread');
		expect(dialog.textContent).toContain('Summary');
		type(field('textarea'), 'New');
		await submit();
		expect(updateRoom).toHaveBeenCalledWith('t1', { description: 'New' });
		expect(onclose).toHaveBeenCalled();
	});

	it('calls a room’s summary its Description', () => {
		instance = mount(RoomEditor, {
			target: document.body,
			props: { client: {} as unknown as ChatClient, room: { id: 'r1', title: 'Ops' }, thread: false, enabled: true, onclose: vi.fn() }
		});
		flushSync();
		expect(field('dialog').textContent).toContain('Edit room');
		expect(field('dialog').textContent).toContain('Description');
	});
});
