// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import RoomEditor from './RoomEditor.svelte';
import { render, stubDialog, submit, type } from '$lib/test/dom';

beforeAll(stubDialog);

function field<T extends HTMLElement>(selector: string): T {
	return document.querySelector<T>(selector)!;
}

describe('RoomEditor', () => {
	it('edits a thread in the same centered dialog', async () => {
		const updateRoom = vi.fn(() => ({ promise: Promise.resolve({}) }));
		const onclose = vi.fn();
		render(RoomEditor, { client: { updateRoom } as unknown as ChatClient, room: { id: 't1', title: 'Deploy', description: 'Old' }, thread: true, enabled: true, onclose });
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
		render(RoomEditor, { client: {} as unknown as ChatClient, room: { id: 'r1', title: 'Ops' }, thread: false, enabled: true, onclose: vi.fn() });
		expect(field('dialog').textContent).toContain('Edit room');
		expect(field('dialog').textContent).toContain('Description');
	});
});
