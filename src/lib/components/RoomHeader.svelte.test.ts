// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import RoomHeader from './RoomHeader.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

/** The header of a joined room, offering the member list's toggle or not. */
function render(memberListToggle?: boolean) {
	const room = { id: 'general', title: 'General', joined: true } as unknown as RoomSnapshot;
	const noop = () => {};
	instance = mount(RoomHeader, {
		target: document.body,
		props: {
			room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false,
			...(memberListToggle === undefined ? {} : { memberListToggle }),
			onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop
		}
	});
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.member-list-toggle');
}

describe('RoomHeader', () => {
	it('offers the member list’s toggle where the list overlays the conversation', () => {
		expect(render()?.getAttribute('aria-label')).toBe('Show member list');
	});

	it('leaves it to the corner where the list has a column of its own', () => {
		expect(render(false)).toBeNull();
	});
});
