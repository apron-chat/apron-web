// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import RoomHeader from './RoomHeader.svelte';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';

function render(props: Record<string, unknown>) {
	dom.render(RoomHeader, { room: 'ops', name: 'Ops', ...props });
	return document.querySelector('header')!;
}

const sub = () => [...document.querySelectorAll('.ap-roomhead-text .ap-roomhead-sub')].map((line) => line.textContent);

describe('RoomHeader', () => {
	it('says who’s typing, their name isolated, else a thread’s replies, else the topic', () => {
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents', typing: ['Alice'], replies: { count: 3 } });
		expect(sub()).toEqual(['Alice is typing…']);
		dom.unmount();
		render({ topic: 'Deploys', replies: { count: 12, more: true } });
		expect(sub()).toEqual(['12+ replies']);
		dom.unmount();
		render({ topic: 'Deploys', replies: { count: 1 } });
		expect(sub()).toEqual(['1 reply']);
		dom.unmount();
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents' });
		expect(sub()).toEqual(['Deploys']);
		expect(byText('Deploys').title).toBe('Deploys and incidents');
		dom.unmount();
		// The name of who is typing is isolated.
		render({ typing: ['محمد'] });
		expect(document.querySelector('.ap-roomhead-typing bdi')?.textContent).toBe('محمد');
		expect(sub()).toEqual(['محمد is typing…']);
	});

	it('puts Edit and Leave in a ⋯ menu named for the room or thread, and Join and the member list beside it', () => {
		const onjoin = vi.fn();
		render({ thread: 'deploy', threadName: 'Deploy', onedit: () => {}, onleave: () => {}, canJoin: true, onjoin, onmemberlist: () => {}, memberListOpen: true, busy: true });
		expect(dom.button('Thread actions').disabled).toBe(true);
		expect(dom.button('Join thread').disabled).toBe(true);
		const members = dom.button('Hide member list');
		expect([members.getAttribute('aria-expanded'), members.classList.contains('ap-iconbtn-on')]).toEqual(['true', true]);
		expect(dom.queryByRole('button', 'Back to room')).not.toBeNull();
		dom.unmount();
		render({ onjoin });
		// Join shows only where it's offered (`canJoin`), not wherever there's an `onjoin`.
		expect([...document.querySelectorAll('button')]).toEqual([]);
	});

	it('offers Copy link first in the ⋯ menu, named for the room or thread', () => {
		const oncopylink = vi.fn();
		render({ oncopylink, onleave: () => {} });
		dom.button('Room actions').click();
		flushSync();
		const items = [...document.querySelectorAll<HTMLButtonElement>('.ap-menu-item')];
		expect(items.map((item) => item.textContent?.trim())).toEqual(['Copy link to room', 'Leave room']);
		items[0].click();
		expect(oncopylink).toHaveBeenCalledOnce();
		dom.unmount();
		render({ thread: 'deploy', threadName: 'Deploy', oncopylink });
		dom.button('Thread actions').click();
		flushSync();
		expect(document.querySelector('.ap-menu-item')?.textContent?.trim()).toBe('Copy link to thread');
	});

	it('offers Mute in the ⋯ menu with how long, worked out as it opens, and while muted marks the name and offers Unmute', async () => {
		const onmute = vi.fn();
		const onunmute = vi.fn();
		let opened = 0;
		const muteChoices = () => {
			opened += 1;
			return [{ value: '1h', label: 'For 1 hour', hint: 'until 14:30' }, { value: 'forever', label: 'Until I unmute' }];
		};
		const header = render({ onleave: () => {}, muteChoices, onmute, onunmute });
		expect(header.querySelector('.ap-roomhead-muted')).toBeNull();
		const before = opened;
		dom.button('Room actions').click();
		flushSync();
		expect(opened).toBeGreaterThan(before);
		const items = () => [...document.querySelectorAll<HTMLButtonElement>('.ap-menu-item')].map((item) => item.textContent?.trim());
		const item = (name: string | RegExp) => dom.byRole<HTMLButtonElement>('menuitem', name);
		expect(items()).toEqual(['Mute room', 'Leave room']);
		item('Mute room').click();
		flushSync();
		await Promise.resolve();
		expect(items()).toEqual(['Mute room', 'For 1 houruntil 14:30', 'Until I unmute', 'Leave room']);
		item(/^For 1 hour/).click();
		flushSync();
		expect(onmute).toHaveBeenCalledWith('1h');
		dom.unmount();
		// Muted: a bell-off by the name says until when, and Unmute takes Mute's place.
		const muted = render({ thread: 'deploy', threadName: 'Deploy', muteChoices, onmute, muted: 'until 14:30', onunmute });
		expect(muted.querySelector('h1 .ap-roomhead-muted')?.getAttribute('aria-label')).toBe('Muted until 14:30');
		dom.button('Thread actions').click();
		flushSync();
		expect(items()).toEqual(['Unmute threaduntil 14:30']);
		item(/^Unmute thread/).click();
		flushSync();
		expect([onunmute.mock.calls.length, onmute.mock.calls.length]).toEqual([1, 1]);
	});

	it('makes the back arrow a tag with what’s new elsewhere: grey for unread, orange with an @ for mentions, capped at 99+', () => {
		const back = () => dom.button(/^Back to rooms/);
		/** The tag on the back arrow: what it shows, and whether it's the quiet or the @ kind. */
		const tag = () => {
			const shown = back().firstElementChild;
			return shown && [shown.textContent, shown.classList.contains('ap-roomhead-tag-quiet') ? 'quiet' : shown.classList.contains('ap-roomhead-tag-at') ? 'at' : ''];
		};
		render({ onback: vi.fn() });
		expect([back().getAttribute('aria-label'), back().textContent?.trim(), tag()]).toEqual(['Back to rooms', '‹', null]);
		dom.unmount();
		render({ onback: vi.fn(), unreadElsewhere: 12 });
		expect([back().getAttribute('aria-label'), tag()]).toEqual(['Back to rooms, 12 unread messages', ['12', 'quiet']]);
		dom.unmount();
		// A mention may be an edit adding you to a message already read: it counts at least once.
		render({ onback: vi.fn(), mentionsElsewhere: 1 });
		expect([back().getAttribute('aria-label'), tag()]).toEqual(['Back to rooms, 1 unread message, a mention of you', ['@\u202f1', 'at']]);
		dom.unmount();
		render({ onback: vi.fn(), unreadElsewhere: 250, mentionsElsewhere: 2 });
		expect([back().getAttribute('aria-label'), tag()]).toEqual(['Back to rooms, 250 unread messages, 2 mentions of you', ['@\u202f99+', 'at']]);
	});

	it('shows who a private room is with before its name, one face with its status or two of a group, not in a thread', () => {
		let header = render({ room: 'p1', name: 'Bob', private: true, faces: [{ user_id: 'bob', name: 'Bob', status: 'online' }], topic: 'Online · only you and Bob can see this room' });
		const faces = header.querySelector('.ap-faces')!;
		expect(faces.nextElementSibling?.classList.contains('ap-roomhead-text')).toBe(true);
		expect(faces.getAttribute('aria-hidden')).toBe('true');
		expect(faces.querySelector('.ap-presence')).not.toBeNull();
		expect(header.querySelector('h1')?.textContent).toBe('Bob');
		expect(sub()).toEqual(['Online · only you and Bob can see this room']);
		dom.unmount();
		header = render({ room: 'p2', name: 'Dev, Mira', private: true, faces: [{ user_id: 'dev' }, { user_id: 'mira' }, { user_id: 'bob' }] });
		expect(header.querySelectorAll('.ap-faces-group .ap-avatar')).toHaveLength(2);
		dom.unmount();
		header = render({ room: 'p2', name: 'Dev, Mira', private: true, faces: [{ user_id: 'dev' }], thread: 't1', threadName: 'Plans' });
		expect(header.querySelector('.ap-faces')).toBeNull();
	});

	it('takes a class on the header beside its own', () => {
		const header = render({ class: 'mine', private: true });
		expect([header.classList.contains('ap-roomhead'), header.classList.contains('ap-roomhead-private'), header.classList.contains('mine')]).toEqual([true, true, true]);
	});
});
