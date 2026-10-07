// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import RoomHeader from './RoomHeader.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

/** The header of a joined room, with the rooms list open or not. */
function render(sidebarOpen: boolean, onsidebar = () => {}) {
	const room = { id: 'general', title: 'General', joined: true } as unknown as RoomSnapshot;
	const noop = () => {};
	instance = mount(RoomHeader, {
		target: document.body,
		props: {
			room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false,
			sidebarOpen, memberListOpen: false,
			onback: noop, onroom: noop, onedit: noop, onleave: noop, onsidebar, onmemberlist: noop
		}
	});
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.sidebar-toggle')!;
}

describe('RoomHeader', () => {
	it('starts the title bar with a rooms toggle, mirroring the member list toggle at its end', () => {
		const toggle = render(true);
		const buttons = [...document.querySelectorAll('header.ap-roomhead > button')];
		expect(buttons[0]).toBe(toggle);
		expect(buttons.at(-1)?.classList.contains('member-list-toggle')).toBe(true);
		expect(toggle.getAttribute('aria-label')).toBe('Hide rooms');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.classList.contains('closed')).toBe(false);
	});

	it('offers to show the rooms list once it is collapsed', () => {
		const toggle = render(false);
		expect(toggle.getAttribute('aria-label')).toBe('Show rooms');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.classList.contains('closed')).toBe(true);
	});

	it('asks to toggle the rooms list when pressed', () => {
		const onsidebar = vi.fn();
		render(true, onsidebar).click();
		expect(onsidebar).toHaveBeenCalledOnce();
	});
});
