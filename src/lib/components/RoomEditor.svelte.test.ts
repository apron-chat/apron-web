// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import RoomEditor from './RoomEditor.svelte';

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
