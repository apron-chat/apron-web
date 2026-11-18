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

	it('unmutes the pane’s own mute, or in a thread muted only by its room, the room', () => {
		const onmute = vi.fn();
		const noop = () => {};
		const show = (room: Partial<RoomSnapshot>, pane: Partial<RoomSnapshot>) => dom.render(RoomHeader, {
			room: { id: 'general', title: 'General', joined: true, ...room } as unknown as RoomSnapshot,
			pane: { id: 'deploy', title: 'Deploy', joined: true, ...pane } as unknown as RoomSnapshot,
			threadTitle: 'Deploy', typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false,
			onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop, onmute
		});
		show({ mutedUntil: true }, {});
		dom.button('Unmute room').click();
		expect(onmute).toHaveBeenLastCalledWith(false, 'general');
		dom.unmount();
		// Its own mute comes first: unmuting it leaves the room's.
		show({ mutedUntil: true }, { mutedUntil: true });
		dom.button('Unmute thread').click();
		expect(onmute).toHaveBeenLastCalledWith(false, 'deploy');
		dom.unmount();
		show({}, {});
		expect(dom.queryByRole('button', /^Unmute/)).toBeNull();
	});

	it('says which servers a room is shared with, or hosted by (ext:remote), before its description', async () => {
		const { directory } = await import('$lib/ui/directory.svelte');
		const { blankSnapshot } = await import('$lib/ui/session.svelte');
		const link = { user_id: 'link-a', name: 'Link bot', roles: ['bot'], ext: { remote: { server: 'wss://a.example/ws' } } };
		const carol = { user_id: 'carol@a.example', name: 'Carol', ext: { remote: { server: 'wss://a.example/ws', user_id: 'carol' } } };
		const show = (capabilities: string[], description?: string, record?: object) => {
			directory.apply({ ...blankSnapshot(), authenticated: true, users: { 'link-a': link, 'carol@a.example': carol }, server: { apron: 10, auth: ['guest'], capabilities } }, undefined);
			const room = { id: 'ops', title: 'ops', ...(description ? { description } : {}), ...(record ? { record } : {}), joined: true, members: [link, carol] } as unknown as RoomSnapshot;
			const noop = () => {};
			dom.render(RoomHeader, { room, pane: room, typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false, onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop });
			const line = document.querySelector('[data-testid="room-description"]');
			const text = [line?.textContent, line?.getAttribute('title')];
			dom.unmount();
			return text;
		};
		expect(show(['ext:remote'])).toEqual(['Shared with a.example', 'People on a.example read and write in this room too']);
		expect(show(['ext:remote'], 'Deploys')).toEqual(['Shared with a.example · Deploys', 'Deploys']);
		// A mirror, whose record names the room it mirrors: hosted there.
		const mirror = { room_id: 'ops', ext: { remote: { server: 'wss://a.example/ws', room_id: 'ops-a' } } };
		expect(show(['ext:remote'], undefined, mirror)).toEqual(['Hosted by a.example', 'This room lives on a.example: what you write here goes there first']);
		// A thread says it as its room does, after its count of replies; with none counted yet, as a room's line.
		const thread = (replyCount?: number) => {
			const room = { id: 'ops', title: 'ops', record: mirror, joined: true, members: [] } as unknown as RoomSnapshot;
			const pane = { id: 't1', title: 'Postmortem', parentRoomId: 'ops', record: { room_id: 't1' }, joined: true, members: [] } as unknown as RoomSnapshot;
			const noop = () => {};
			dom.render(RoomHeader, { room, pane, threadTitle: 'Postmortem', ...(replyCount !== undefined ? { replyCount } : {}), typing: [], canEdit: false, editDisabled: false, canLeave: false, memberListOpen: false, onback: noop, onroom: noop, onedit: noop, onleave: noop, onmemberlist: noop });
			const text = document.querySelector('.ap-roomhead-sub')?.textContent;
			dom.unmount();
			return text;
		};
		expect([thread(2), thread()]).toEqual(['2 replies · Hosted by a.example', 'Hosted by a.example']);
		// Without the capability, a link is just a member.
		expect(show([], 'Deploys')).toEqual(['Deploys', 'Deploys']);
		directory.forget();
	});
});
