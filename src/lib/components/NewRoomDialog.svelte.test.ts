// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import NewRoomDialog from './NewRoomDialog.svelte';

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

describe('NewRoomDialog', () => {
	function render(createRoom: ReturnType<typeof vi.fn> = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'new' }) }))) {
		const oncreated = vi.fn();
		const onclose = vi.fn();
		instance = mount(NewRoomDialog, { target: document.body, props: { client: { createRoom } as unknown as ChatClient, enabled: true, oncreated, onclose } });
		flushSync();
		return { createRoom, oncreated, onclose };
	}
	const checkbox = () => field<HTMLInputElement>('input[type="checkbox"]');

	it('creates a room in the same centered form as threads: a title, a description, and Private to choose', async () => {
		const { createRoom, oncreated, onclose } = render();
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.classList.contains('ap-dialog-md')).toBe(true);
		expect(dialog.textContent).toContain('Create a room');
		expect(dialog.textContent).toContain('Description');
		await submit();
		expect(createRoom).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a room title.');
		type(field('input.ap-field'), ' Ops ');
		type(field('textarea'), 'Deploys');
		checkbox().click();
		flushSync();
		await submit();
		expect(createRoom).toHaveBeenCalledWith({ title: 'Ops', description: 'Deploys', private: true });
		// Its record must come back private before it's used (§4.3.4).
		expect(oncreated).toHaveBeenCalledWith('new', { private: true });
		expect(onclose).toHaveBeenCalled();
	});

	it('sends no description or private it wasn’t given', async () => {
		const { createRoom, oncreated } = render();
		type(field('input.ap-field'), 'Ops');
		await submit();
		expect(createRoom).toHaveBeenCalledWith({ title: 'Ops' });
		expect(oncreated).toHaveBeenCalledWith('new', { private: false });
	});

	it('says in words that a server keeps no private rooms, and stays open', async () => {
		const { oncreated, onclose } = render(vi.fn(() => ({ promise: Promise.reject(Object.assign(new Error('Method not found'), { code: -32601 })) })));
		type(field('input.ap-field'), 'Hiring');
		checkbox().click();
		flushSync();
		await submit();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('doesn’t keep private rooms');
		expect(field<HTMLDialogElement>('dialog').open).toBe(true);
		expect(oncreated).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});
});
