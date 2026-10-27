// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import RoomEditor from './RoomEditor.svelte';
import { render, stubDialog, submit, type, unmount } from '$lib/test/dom';

beforeAll(stubDialog);

function field<T extends HTMLElement>(selector: string): T {
	return document.querySelector<T>(selector)!;
}

describe('RoomEditor', () => {
	it('edits a thread in the same centered dialog, and calls a room’s description its Description', async () => {
		const updateRoom = vi.fn(() => ({ promise: Promise.resolve({}) }));
		const onclose = vi.fn();
		render(RoomEditor, { client: { updateRoom } as unknown as ChatClient, room: { id: 't1', title: 'Deploy', description: 'Old' }, thread: true, enabled: true, onclose });
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.textContent).toContain('Edit thread');
		expect(dialog.textContent).toContain('Description');
		type(field('textarea'), 'New');
		await submit();
		expect(updateRoom).toHaveBeenCalledWith('t1', { description: 'New' });
		expect(onclose).toHaveBeenCalled();
		unmount();
		// A room's description is its Description.
		render(RoomEditor, { client: {} as unknown as ChatClient, room: { id: 'r1', title: 'Ops' }, thread: false, enabled: true, onclose: vi.fn() });
		expect(field('dialog').textContent).toContain('Edit room');
		expect(field('dialog').textContent).toContain('Description');
	});
});
