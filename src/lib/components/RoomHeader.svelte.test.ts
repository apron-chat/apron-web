// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import RoomHeader from './RoomHeader.svelte';
import * as dom from '$lib/test/dom';

/** The header of a joined room, offering the member list's toggle or not. */
function render(memberListToggle?: boolean, elsewhere: { unreadElsewhere?: number; mentionsElsewhere?: number; showTopic?: boolean; onsummary?: () => void } = {}) {
	const room = { id: 'general', title: 'General', description: 'Say **hello**.', joined: true } as unknown as RoomSnapshot;
	const noop = () => {};
	dom.render(RoomHeader, {
		room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false,
		...(memberListToggle === undefined ? {} : { memberListToggle }),
		...elsewhere,
		onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop
	});
	return document.querySelector<HTMLButtonElement>('button.ap-roomhead-members');
}

describe('RoomHeader', () => {
	it('offers the member list’s toggle where the list overlays the conversation', () => {
		expect(render()?.getAttribute('aria-label')).toBe('Show member list');
	});

	it('leaves it to the corner where the list has a column of its own', () => {
		expect(render(false)).toBeNull();
	});

	it('shows the room’s description under its title, unless it’s pinned as a summary', () => {
		render();
		expect(document.querySelector('[data-testid="room-description"]')?.textContent).toBe('Say hello.');
		dom.unmount();
		render(undefined, { showTopic: false });
		expect(document.querySelector('[data-testid="room-description"]')).toBeNull();
	});

	it('offers Summary once the summary is put away', () => {
		render();
		expect(document.querySelector('[data-testid="show-summary"]')).toBeNull();
		dom.unmount();
		const onsummary = vi.fn();
		render(undefined, { onsummary });
		const button = document.querySelector<HTMLButtonElement>('[data-testid="show-summary"]');
		expect(button?.getAttribute('aria-label')).toBe('Show the room summary');
		button?.click();
		expect(onsummary).toHaveBeenCalledOnce();
	});

	it('makes the back arrow a tag with what’s new elsewhere: grey for unread, orange with an @ for mentions', () => {
		const back = () => document.querySelector<HTMLButtonElement>('.ap-roomhead-back')!;
		const tag = () => back().querySelector('[data-testid="back-unread"]');
		render();
		expect(back().textContent?.trim()).toBe('‹');
		expect(back().getAttribute('aria-label')).toBe('Back to rooms');
		expect(tag()).toBeNull();
		dom.unmount();
		render(undefined, { unreadElsewhere: 12 });
		expect(tag()?.textContent).toBe('12');
		expect(tag()?.classList.contains('ap-roomhead-tag-quiet')).toBe(true);
		expect(back().getAttribute('aria-label')).toBe('Back to rooms, 12 unread messages');
		dom.unmount();
		// A mention may be an edit adding you to a message already read: it counts at least once.
		render(undefined, { unreadElsewhere: 0, mentionsElsewhere: 1 });
		expect(tag()?.textContent).toBe('@\u202f1');
		expect(tag()?.classList.contains('ap-roomhead-tag-at')).toBe(true);
		expect(back().getAttribute('aria-label')).toBe('Back to rooms, 1 unread message, a mention of you');
		dom.unmount();
		render(undefined, { unreadElsewhere: 250, mentionsElsewhere: 2 });
		expect(tag()?.textContent).toBe('@\u202f99+');
	});
});
