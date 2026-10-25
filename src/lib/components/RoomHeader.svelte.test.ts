// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import RoomHeader from './RoomHeader.svelte';
import * as dom from '$lib/test/dom';
import { byTestid } from '$lib/test/queries';

/** The header of a joined room, offering the member list's toggle or not. */
function render(memberListToggle?: boolean, elsewhere: { unreadElsewhere?: number; mentionsElsewhere?: number; showTopic?: boolean; ondescription?: () => void } = {}) {
	const room = { id: 'general', title: 'General', description: 'Say **hello**.', joined: true } as unknown as RoomSnapshot;
	const noop = () => {};
	dom.render(RoomHeader, {
		room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false,
		...(memberListToggle === undefined ? {} : { memberListToggle }),
		...elsewhere,
		onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop
	});
	return dom.queryByRole<HTMLButtonElement>('button', 'Show member list');
}

describe('RoomHeader', () => {
	it('offers the member list’s toggle where the list overlays the conversation, and leaves it to the corner where the list has a column of its own', () => {
		expect(render()?.getAttribute('aria-label')).toBe('Show member list');
		dom.unmount();
		expect(render(false)).toBeNull();
	});

	it('shows the room’s description under its title, unless it’s pinned, and offers Description once that is put away', () => {
		render();
		expect(document.querySelector('[data-testid="room-description"]')?.textContent).toBe('Say hello.');
		dom.unmount();
		render(undefined, { showTopic: false });
		expect(document.querySelector('[data-testid="room-description"]')).toBeNull();
		dom.unmount();
		// Description is offered once the pinned description is put away.
		render();
		expect(document.querySelector('[data-testid="show-description"]')).toBeNull();
		dom.unmount();
		const ondescription = vi.fn();
		render(undefined, { ondescription });
		const button = document.querySelector<HTMLButtonElement>('[data-testid="show-description"]');
		expect(button?.getAttribute('aria-label')).toBe('Show the room description');
		button?.click();
		expect(ondescription).toHaveBeenCalledOnce();
	});

	it('tags the back arrow with what the rooms list counts as new elsewhere', () => {
		const back = () => dom.button(/^Back to rooms/);
		render();
		expect([back().getAttribute('aria-label'), byTestid('back-unread')]).toEqual(['Back to rooms', null]);
		dom.unmount();
		render(undefined, { unreadElsewhere: 12, mentionsElsewhere: 1 });
		expect(back().getAttribute('aria-label')).toBe('Back to rooms, 12 unread messages, a mention of you');
		expect(byTestid('back-unread')?.textContent).toBe('@\u202f12');
	});
});
