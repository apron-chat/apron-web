// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Mention from './Mention.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(Mention, { target: document.body, props });
	flushSync();
	return document.querySelector('.ap-mention')!;
}

describe('Mention', () => {
	it('shows a room that only reads as text, with no ID to open it by', () => {
		const chip = render({ roomId: 'ops', name: 'Ops', hash: true });
		expect(chip.tagName).toBe('SPAN');
		expect(chip.className).toBe('ap-mention ap-mention-room ap-mention-hash-room');
		expect(chip.textContent).toBe('#Ops');
		expect(chip.getAttribute('title')).toBe('#ops');
		expect(chip.hasAttribute('data-room-id')).toBe(false);
	});

	it('makes a room a button that opens it when given onopen', () => {
		const chip = render({ roomId: 'ops', name: 'Ops', onopen: vi.fn() });
		expect(chip.tagName).toBe('BUTTON');
		expect(chip.getAttribute('data-room-id')).toBe('ops');
		expect(chip.textContent).toBe('Ops');
	});

	it('calls an untitled thread Untitled, with its room_id in the tooltip; an untitled room keeps its room_id', () => {
		const thread = render({ roomId: 't1', thread: true, hash: true, onopen: vi.fn() });
		expect(thread.textContent).toBe('#Untitled');
		expect(thread.getAttribute('title')).toBe('Open Untitled (#t1)');
		unmount(instance!);
		const room = render({ roomId: 'ops', onopen: vi.fn() });
		expect(room.textContent).toBe('ops');
		expect(room.getAttribute('title')).toBe('Open ops');
	});
});
