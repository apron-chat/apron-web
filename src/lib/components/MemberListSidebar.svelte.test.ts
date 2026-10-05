// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import MemberListSidebar from './MemberListSidebar.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	directory.forget();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The member list of a room whose members carry these statuses, signed in as Ada. */
function render(users: Identity[], fields: Partial<ClientSnapshot> = {}) {
	const snapshot: ClientSnapshot = {
		...blankSnapshot(),
		authenticated: true,
		you: ada,
		users: Object.fromEntries(users.map((user) => [user.user_id, user])),
		recordedUsers: {},
		userAliases: {},
		...fields
	};
	directory.apply(snapshot, undefined);
	const room = { id: 'general', title: 'General', joined: true, members: users.map(({ user_id }) => ({ user_id })) } as unknown as RoomSnapshot;
	const session = { snapshot, canManageRooms: true } as unknown as SessionView;
	instance = mount(MemberListSidebar, { target: document.body, props: { client: undefined, session, room, open: true, canChange: false } });
	flushSync();
	return [...document.querySelectorAll<HTMLLIElement>('li.member')];
}

describe('MemberListSidebar', () => {
	it('lists members online, idle, dnd, unknown, offline, then those with no status, by name within each', () => {
		const rows = render([
			{ user_id: 'zed', name: 'Zed' },
			{ user_id: 'bo', name: 'Bo', status: 'offline' },
			{ user_id: 'cy', name: 'Cy', status: 'dnd' },
			{ user_id: 'di', name: 'Di', status: 'idle' },
			{ user_id: 'eve', name: 'Eve', status: 'away' },
			{ user_id: 'fay', name: 'Fay', status: 'online' },
			{ user_id: 'al', name: 'Al' },
			ada
		]);
		expect(rows.map((row) => row.dataset.user)).toEqual(['ada', 'fay', 'di', 'cy', 'eve', 'bo', 'al', 'zed']);
		expect(rows.map((row) => row.dataset.status ?? '')).toEqual(['online', 'online', 'idle', 'dnd', 'unknown', 'offline', '', '']);
	});

	it('dims offline members only, with a ring; no status shows no dot and is not dimmed', () => {
		const rows = render([ada, { user_id: 'bo', name: 'Bo', status: 'offline' }, { user_id: 'cy', name: 'Cy' }]);
		const [me, bo, cy] = rows;
		expect(bo.classList.contains('offline')).toBe(true);
		expect(bo.querySelector('.ap-presence-offline')).not.toBeNull();
		expect(bo.querySelector('.ap-sr')?.textContent).toBe(', offline');
		expect(bo.querySelector('button')?.title).toBe('@bo · Offline');
		expect(cy.classList.contains('offline')).toBe(false);
		expect(cy.querySelector('.ap-presence')).toBeNull();
		expect(cy.querySelector('.ap-sr')).toBeNull();
		expect(cy.querySelector('button')?.title).toBe('@cy');
		expect(me.classList.contains('offline')).toBe(false);
		expect(me.textContent).toContain('(you)');
	});

	it('shows an unknown status as a placeholder that says its value, not as offline (§4.11)', () => {
		const rows = render([ada, { user_id: 'eve', name: 'Eve', status: 'brb' }]);
		const eve = rows[1];
		expect(eve.dataset.status).toBe('unknown');
		expect(eve.classList.contains('offline')).toBe(false);
		expect(eve.querySelector('.ap-presence-unknown')?.getAttribute('title')).toBe('Unknown status: brb');
		expect(eve.querySelector('button')?.title).toBe('@eve · Unknown status: brb');
		expect(eve.querySelector('.ap-sr')?.textContent).toBe(', unknown status: brb');
	});

	it('shows your own status as you chose it: a pause doesn\'t change it, and invisible is a ring that says so', () => {
		let rows = render([ada, { user_id: 'bo', name: 'Bo', status: 'online' }], { mutedUntil: true });
		expect(rows.find((row) => row.dataset.user === 'ada')?.dataset.status).toBe('online');
		unmount(instance!);
		const hidden = { ...ada, status: 'invisible' };
		rows = render([hidden, { user_id: 'bo', name: 'Bo', status: 'online' }], { you: hidden });
		expect(rows.map((row) => row.dataset.user)).toEqual(['bo', 'ada']);
		expect(rows[1].querySelector('.ap-presence-invisible')?.getAttribute('title')).toBe('Invisible · others see you as offline');
		expect(rows[1].querySelector('button')?.title).toBe('@ada · Invisible · others see you as offline');
	});

	it('shows no dot for a cleared status, or one dropped after a long reconnect, and the dot again once the server sends it', () => {
		const statuses = (rows: HTMLLIElement[]) => rows.map((row) => [row.dataset.user, row.dataset.status ?? '', row.querySelector('.ap-presence') !== null]);
		const before = render([ada, { user_id: 'bo', name: 'Bo', status: 'idle' }, { user_id: 'cy', name: 'Cy', status: '' }]);
		expect(statuses(before)).toEqual([['ada', 'online', true], ['bo', 'idle', true], ['cy', '', false]]);
		// Back after more than 60 seconds: the client dropped Bo's kept status (§4.11). Unknown, not offline.
		const snapshotWith = (bo: Identity) => ({ ...blankSnapshot(), authenticated: true, you: ada, users: { ada, bo, cy: { user_id: 'cy', name: 'Cy' } }, recordedUsers: {}, userAliases: {} });
		directory.apply(snapshotWith({ user_id: 'bo', name: 'Bo' }), undefined);
		flushSync();
		const dropped = [...document.querySelectorAll<HTMLLIElement>('li.member')];
		expect(statuses(dropped)).toEqual([['ada', 'online', true], ['bo', '', false], ['cy', '', false]]);
		expect(dropped[1].classList.contains('offline')).toBe(false);
		// The server sends it again after `auth`, for users who are connected.
		directory.apply(snapshotWith({ user_id: 'bo', name: 'Bo', status: 'online' }), undefined);
		flushSync();
		expect(statuses([...document.querySelectorAll<HTMLLIElement>('li.member')])).toEqual([['ada', 'online', true], ['bo', 'online', true], ['cy', '', false]]);
	});
});
