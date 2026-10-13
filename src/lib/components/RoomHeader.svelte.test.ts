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
function render(memberListToggle?: boolean, elsewhere: { unreadElsewhere?: number; mentionsElsewhere?: number } = {}) {
	const room = { id: 'general', title: 'General', joined: true } as unknown as RoomSnapshot;
	const noop = () => {};
	instance = mount(RoomHeader, {
		target: document.body,
		props: {
			room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false,
			...(memberListToggle === undefined ? {} : { memberListToggle }),
			...elsewhere,
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

	it('makes the back arrow a tag with what’s new elsewhere: grey for unread, orange with an @ for mentions', () => {
		const back = () => document.querySelector<HTMLButtonElement>('.ap-roomhead-back')!;
		const tag = () => back().querySelector('[data-testid="back-unread"]');
		render();
		expect(back().textContent?.trim()).toBe('‹');
		expect(back().getAttribute('aria-label')).toBe('Back to rooms');
		expect(tag()).toBeNull();
		unmount(instance!);
		render(undefined, { unreadElsewhere: 12 });
		expect(tag()?.textContent).toBe('12');
		expect(tag()?.classList.contains('back-tag-quiet')).toBe(true);
		expect(back().getAttribute('aria-label')).toBe('Back to rooms, 12 unread messages');
		unmount(instance!);
		// A mention may be an edit adding you to a message already read: it counts at least once.
		render(undefined, { unreadElsewhere: 0, mentionsElsewhere: 1 });
		expect(tag()?.textContent).toBe('@\u202f1');
		expect(tag()?.classList.contains('back-tag-at')).toBe(true);
		expect(back().getAttribute('aria-label')).toBe('Back to rooms, 1 unread message, a mention of you');
		unmount(instance!);
		render(undefined, { unreadElsewhere: 250, mentionsElsewhere: 2 });
		expect(tag()?.textContent).toBe('@\u202f99+');
	});
});
