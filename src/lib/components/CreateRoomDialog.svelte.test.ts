// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import CreateRoomDialog from './CreateRoomDialog.svelte';

let instance: ReturnType<typeof mount> | undefined;

beforeAll(() => {
	// jsdom has <dialog> without its modal methods.
	HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
	HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(parent?: { id: string; title: string; private?: boolean }) {
	const createRoom = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'new' }) }));
	const oncreated = vi.fn();
	instance = mount(CreateRoomDialog, { target: document.body, props: { client: { createRoom } as unknown as ChatClient, open: true, enabled: true, parent, oncreated } });
	flushSync();
	return { createRoom, oncreated };
}

async function submit(name: string, about: string) {
	const [input] = document.querySelectorAll<HTMLInputElement>('input.ap-field');
	input.value = name;
	input.dispatchEvent(new Event('input'));
	const text = document.querySelector<HTMLTextAreaElement>('textarea')!;
	text.value = about;
	text.dispatchEvent(new Event('input'));
	flushSync();
	document.querySelector('form')!.requestSubmit();
	await tick();
	await Promise.resolve();
	await tick();
}

describe('CreateRoomDialog', () => {
	it('starts a thread in a room: a name and a Summary, no Private, which it takes from its room', async () => {
		const { createRoom, oncreated } = render({ id: 'general', title: 'General', private: true });
		expect(document.body.textContent).toContain('New thread in General');
		expect(document.body.textContent).toContain('Thread name');
		expect(document.body.textContent).toContain('Summary');
		expect(document.querySelector('input[type="checkbox"]')).toBeNull();
		await submit('Office move', 'Boxes and keys');
		expect(createRoom).toHaveBeenCalledWith({ parentRoomId: 'general', title: 'Office move', description: 'Boxes and keys' });
		// A thread of a private room must come back private too before it's used (§4.3.4).
		expect(oncreated).toHaveBeenCalledWith('new', { private: true });
	});

	it('creates a room as before, with Private to choose', async () => {
		const { createRoom, oncreated } = render();
		expect(document.body.textContent).toContain('Create a room');
		expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
		await submit('Ops', '');
		expect(createRoom).toHaveBeenCalledWith({ title: 'Ops' });
		expect(oncreated).toHaveBeenCalledWith('new', { private: false });
	});
});
