// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import NewRoomDialog from './NewRoomDialog.svelte';
import * as dom from '$lib/test/dom';

beforeAll(dom.stubDialog);

function field<T extends HTMLElement>(selector: string): T {
	return document.querySelector<T>(selector)!;
}

describe('NewRoomDialog', () => {
	function render(createRoom: ReturnType<typeof vi.fn> = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'new' }) }))) {
		const oncreated = vi.fn();
		const onclose = vi.fn();
		dom.render(NewRoomDialog, { client: { createRoom } as unknown as ChatClient, enabled: true, oncreated, onclose });
		return { createRoom, oncreated, onclose };
	}
	const checkbox = () => field<HTMLInputElement>('input[type="checkbox"]');

	it('creates a room in the same centered form as threads: a title, a description, and Private to choose, sending none it wasn’t given', async () => {
		const { createRoom, oncreated, onclose } = render();
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.textContent).toContain('Create a room');
		expect(dialog.textContent).toContain('Description');
		await dom.submit();
		expect(createRoom).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a room title.');
		dom.type(field('input.ap-field'), ' Ops ');
		dom.type(field('textarea'), 'Deploys');
		checkbox().click();
		flushSync();
		await dom.submit();
		expect(createRoom).toHaveBeenCalledWith({ title: 'Ops', description: 'Deploys', private: true });
		// Its record must come back private before it's used (§4.2.4).
		expect(oncreated).toHaveBeenCalledWith('new', { private: true });
		expect(onclose).toHaveBeenCalled();
		dom.unmount();
		// No description or private it wasn't given.
		const bare = render();
		dom.type(field('input.ap-field'), 'Ops');
		await dom.submit();
		expect(bare.createRoom).toHaveBeenCalledWith({ title: 'Ops' });
		expect(bare.oncreated).toHaveBeenCalledWith('new', { private: false });
	});

	it('says in words that a server keeps no private rooms, and stays open', async () => {
		const { oncreated, onclose } = render(vi.fn(() => ({ promise: Promise.reject(Object.assign(new Error('Method not found'), { code: -32601 })) })));
		dom.type(field('input.ap-field'), 'Hiring');
		checkbox().click();
		flushSync();
		await dom.submit();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('doesn’t keep private rooms');
		expect(field<HTMLDialogElement>('dialog').open).toBe(true);
		expect(oncreated).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});
});
