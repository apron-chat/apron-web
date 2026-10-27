// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import MemberListSidebar from './MemberListSidebar.svelte';
import * as dom from '$lib/test/dom';
import { byLabel, queryByText } from '$lib/test/queries';

beforeAll(dom.stubDialog);

afterEach(() => {
	localStorage.clear();
	directory.forget();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The member list of a room whose members carry these statuses, signed in as Ada, on a server with `status`. */
function render(users: Identity[], fields: Partial<ClientSnapshot> = {}, canChange = false, client: object = {}) {
	const blank = blankSnapshot();
	const snapshot: ClientSnapshot = {
		...blank,
		capabilities: { ...blank.capabilities, status: true },
		authenticated: true,
		you: ada,
		users: Object.fromEntries(users.map((user) => [user.user_id, user])),
		recordedUsers: {},
		userAliases: {},
		...fields
	};
	directory.apply(snapshot, undefined);
	const room = { id: 'general', title: 'General', joined: true, members: users.map(({ user_id }) => ({ user_id })) } as unknown as RoomSnapshot;
	const session = { snapshot, capabilities: snapshot.capabilities, canManageRooms: true } as unknown as SessionView;
	dom.render(MemberListSidebar, { client: canChange ? (client as never) : undefined, session, room, open: true, canChange });
	return [...document.querySelectorAll<HTMLLIElement>('li.ap-member')];
}

/** Each section's heading and its members' IDs, in order. */
function sections() {
	return [...document.querySelectorAll<HTMLElement>('section.ap-memberlist-section')].map((section) => [
		section.querySelector('h3')?.textContent?.replace('▾', '').trim(),
		[...section.querySelectorAll<HTMLLIElement>('li.ap-member')].map((row) => row.dataset.user)
	]);
}

describe('MemberListSidebar', () => {
	it('lists members by status, then by name, under Online and Offline, each with their role badges', () => {
		const rows = render([
			{ user_id: 'zed', name: 'Zed' },
			{ user_id: 'bo', name: 'Bo', status: 'offline', roles: ['admin'] },
			{ user_id: 'cy', name: 'Cy', status: 'dnd', roles: ['bot'] },
			{ user_id: 'di', name: 'Di', status: 'idle' },
			{ user_id: 'eve', name: 'Eve', status: 'away' },
			{ user_id: 'fay', name: 'Fay', status: 'online' },
			{ user_id: 'al', name: 'Al' },
			ada
		]);
		expect(sections()).toEqual([['Online· 7', ['ada', 'fay', 'di', 'cy', 'eve', 'al', 'zed']], ['Offline· 1', ['bo']]]);
		expect(rows.map((row) => row.querySelector('[data-testid="roles"]')?.textContent ?? '')).toEqual(['', '', '', 'bot', '', '', '', 'admin']);
	});

	it('keeps the order from before a resume until its listing, then changes over at once', () => {
		// Bo went offline and Cy came online while away; Cy's fresh status came right after the sign-in, Bo's will
		// with the listing. Meanwhile both show as they were, so the list doesn't reorder twice.
		render([
			{ user_id: 'bo', name: 'Bo' },
			{ user_id: 'cy', name: 'Cy', status: 'online' },
			ada
		], { statusesBeforeResume: { bo: 'online', cy: 'offline' } });
		expect(sections()).toEqual([['Online· 2', ['ada', 'bo']], ['Offline· 1', ['cy']]]);
		dom.unmount();
		// Bo's fresh offline, with when he was last seen, arrives before the listing: he still shows as before, and
		// his row doesn't say both.
		render([
			{ user_id: 'bo', name: 'Bo', status: 'offline', seen: '1793000000000' } as Identity,
			ada
		], { statusesBeforeResume: { bo: 'online' } });
		const title = () => document.querySelector('li.ap-member[data-user="bo"] [title]')?.getAttribute('title') ?? '';
		expect(title()).not.toMatch(/seen/i);
		dom.unmount();
		// Settled, it does.
		render([{ user_id: 'bo', name: 'Bo', status: 'offline', seen: '1793000000000' } as Identity, ada]);
		expect(title()).toMatch(/seen/i);
		dom.unmount();
		render([
			{ user_id: 'bo', name: 'Bo', status: 'offline' },
			{ user_id: 'cy', name: 'Cy', status: 'online' },
			ada
		]);
		expect(sections()).toEqual([['Online· 2', ['ada', 'cy']], ['Offline· 1', ['bo']]]);
	});

	it('skips online and offline on a server without status (§4.5): one list, unheaded, none dimmed', () => {
		const rows = render([
			{ user_id: 'ada', name: 'Ada' },
			{ user_id: 'bo', name: 'Bo', roles: ['admin'] },
			{ user_id: 'cy', name: 'Cy' }
		], { you: { user_id: 'ada', name: 'Ada' }, capabilities: blankSnapshot().capabilities });
		expect(rows.map((row) => row.dataset.user)).toEqual(['ada', 'bo', 'cy']);
		expect(document.querySelector('.ap-memberlist-sectionhead')).toBeNull();
		expect(rows.some((row) => row.classList.contains('ap-member-offline') || row.querySelector('.ap-presence'))).toBe(false);
	});

	it('folds a section from its heading, keeping its count, and remembers it for the next visit', () => {
		const people = [ada, { user_id: 'bo', name: 'Bo', status: 'offline' }, { user_id: 'cy', name: 'Cy', status: 'offline' }];
		render(people);
		const toggle = () => document.querySelector<HTMLButtonElement>('[data-section="offline"] h3 button')!;
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
		toggle().click();
		flushSync();
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(toggle().textContent).toBe('▾Offline· 2');
		expect(sections()).toEqual([['Online· 1', ['ada']], ['Offline· 2', []]]);
		expect(localStorage.getItem('apron.memberSections')).toBe('["offline"]');
		dom.unmount();
		render(people);
		expect(sections()).toEqual([['Online· 1', ['ada']], ['Offline· 2', []]]);
		toggle().click();
		flushSync();
		expect(sections()).toEqual([['Online· 1', ['ada']], ['Offline· 2', ['bo', 'cy']]]);
	});

	it('shows your own status as you chose it: a pause doesn\'t change it, and invisible is a ring that says so', () => {
		let rows = render([ada, { user_id: 'bo', name: 'Bo', status: 'online' }], { mutedUntil: true });
		expect(rows.find((row) => row.dataset.user === 'ada')?.dataset.status).toBe('online');
		dom.unmount();
		const hidden = { ...ada, status: 'invisible' };
		rows = render([hidden, { user_id: 'bo', name: 'Bo', status: 'online' }], { you: hidden });
		expect(rows.map((row) => row.dataset.user)).toEqual(['bo', 'ada']);
		expect(rows[1].querySelector('.ap-presence-invisible')?.getAttribute('title')).toBe('Invisible · others see you as offline');
		expect(rows[1].querySelector('button')?.title).toBe('@ada · Invisible · others see you as offline');
	});

	it('says when an offline member was last seen in their tooltip (§4.5.2), and nothing of a seen kept once they are back online', () => {
		const now = Date.UTC(2026, 9, 22, 12);
		vi.useFakeTimers({ now, toFake: ['Date'] });
		try {
			const seen = String(now - 15 * 60_000);
			const rows = render([
				ada, { user_id: 'bo', name: 'Bo', status: 'offline', seen }, { user_id: 'cy', name: 'Cy', status: 'online', seen }, { user_id: 'di', name: 'Di', status: 'offline', seen: 'soon' },
				{ user_id: 'ed', name: 'Ed', status: 'offline', seen: String(now - 5 * 60_000) }
			]);
			const row = (id: string) => rows.find((candidate) => candidate.dataset.user === id)!;
			expect(row('bo').querySelector('button')?.title).toBe('@bo · Offline · last seen 15m ago');
			expect(row('bo').querySelector('.ap-presence-offline')?.getAttribute('title')).toBe('Offline · last seen 15m ago');
			expect(row('bo').querySelector('.ap-sr')?.textContent).toBe(', offline · last seen 15m ago');
			expect(row('cy').querySelector('button')?.title).toBe('@cy · Online');
			expect(row('di').querySelector('button')?.title).toBe('@di · Offline');
			// Under ten minutes, recently: a server may record seen coarsely.
			expect(row('ed').querySelector('button')?.title).toBe('@ed · Offline · last seen recently');
			expect(row('ed').querySelector('.ap-presence-offline')?.getAttribute('title')).toBe('Offline · last seen recently');
			expect(row('ed').querySelector('.ap-sr')?.textContent).toBe(', offline · last seen recently');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows when this page saw a member go offline over an older seen, or none, but never for you', () => {
		const now = Date.UTC(2026, 9, 22, 12);
		vi.useFakeTimers({ now, toFake: ['Date'] });
		try {
			const you = { ...ada, status: 'invisible' };
			const rows = render(
				[you, { user_id: 'bo', name: 'Bo', status: 'offline', seen: String(now - 3 * 60 * 60_000) }, { user_id: 'cy', name: 'Cy', status: 'offline' }, { user_id: 'di', name: 'Di', status: 'offline', seen: String(now - 60 * 60_000) }],
				{ you, sawOffline: { ada: now - 60_000, bo: now - 2 * 60_000, cy: now - 20 * 60_000, di: now - 2 * 60 * 60_000 } }
			);
			const title = (id: string) => rows.find((candidate) => candidate.dataset.user === id)!.querySelector('button')?.title;
			// The floor over an older seen; alone without one; and an older floor leaves a later seen as it is.
			expect([title('bo'), title('cy'), title('di')]).toEqual(['@bo · Offline · last seen recently', '@cy · Offline · last seen 20m ago', '@di · Offline · last seen 1h ago']);
			expect(title('ada')).toBe('@ada · Invisible · others see you as offline');
		} finally {
			vi.useRealTimers();
		}
	});

	it('says nothing of a seen past the last date a Date holds, and goes on updating', () => {
		const now = Date.UTC(2026, 9, 22, 12);
		vi.useFakeTimers({ now, toFake: ['Date'] });
		try {
			const linus = { user_id: 'linus', name: 'Linus', status: 'offline', seen: '9000000000000000' };
			const rows = render([ada, linus, { user_id: 'bo', name: 'Bo', status: 'online' }]);
			const title = (id: string) => document.querySelector<HTMLElement>(`li[data-user="${id}"] button`)?.title;
			expect(rows.map((row) => row.dataset.user)).toEqual(['ada', 'bo', 'linus']);
			expect(title('linus')).toBe('@linus · Offline');
			// The next change still shows.
			const snapshot = { ...blankSnapshot(), capabilities: { ...blankSnapshot().capabilities, status: true }, authenticated: true, you: ada, recordedUsers: {}, userAliases: {} };
			directory.apply({ ...snapshot, users: { ada, linus: { ...linus, seen: String(now - 25 * 60_000) }, bo: { user_id: 'bo', name: 'Bo', status: 'offline', seen: '9007199254740991' } } }, undefined);
			flushSync();
			expect([title('linus'), title('bo')]).toEqual(['@linus · Offline · last seen 25m ago', '@bo · Offline']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows no dot for a cleared status, or one dropped at a sign-in, and the dot again once the server sends it', () => {
		const statuses = (rows: HTMLLIElement[]) => rows.map((row) => [row.dataset.user, row.dataset.status ?? '', row.querySelector('.ap-presence') !== null]);
		const before = render([ada, { user_id: 'bo', name: 'Bo', status: 'idle' }, { user_id: 'cy', name: 'Cy', status: '' }]);
		expect(statuses(before)).toEqual([['ada', 'online', true], ['bo', 'idle', true], ['cy', '', false]]);
		// Signed in again: the client dropped Bo's kept status (§4.5). Unknown, not offline.
		const snapshotWith = (bo: Identity) => ({ ...blankSnapshot(), authenticated: true, you: ada, users: { ada, bo, cy: { user_id: 'cy', name: 'Cy' } }, recordedUsers: {}, userAliases: {} });
		directory.apply(snapshotWith({ user_id: 'bo', name: 'Bo' }), undefined);
		flushSync();
		const dropped = [...document.querySelectorAll<HTMLLIElement>('li.ap-member')];
		expect(statuses(dropped)).toEqual([['ada', 'online', true], ['bo', '', false], ['cy', '', false]]);
		expect(dropped[1].classList.contains('ap-member-offline')).toBe(false);
		// The server sends it again after `auth`, for users who are connected.
		directory.apply(snapshotWith({ user_id: 'bo', name: 'Bo', status: 'online' }), undefined);
		flushSync();
		expect(statuses([...document.querySelectorAll<HTMLLIElement>('li.ap-member')])).toEqual([['ada', 'online', true], ['bo', 'online', true], ['cy', '', false]]);
	});

	it('offers Add member, to someone who can change members, as a plus after the header\'s count that opens a people picker', async () => {
		const joinRoom = vi.fn((_room: string, userId: string) => ({ promise: userId === 'cy' ? Promise.reject(new Error('Denied')) : Promise.resolve({}) }));
		// Cy and Di aren't members yet; Bo is.
		render([ada, { user_id: 'bo', name: 'Bo' }], { users: Object.fromEntries([ada, { user_id: 'bo', name: 'Bo' }, { user_id: 'cy', name: 'Cy' }, { user_id: 'di', name: 'Di' }, { user_id: '~server', name: 'Server' }].map((user) => [user.user_id, user])) }, true, { joinRoom });
		const toggle = document.querySelector<HTMLButtonElement>('.ap-memberlist-head .ap-memberlist-addtoggle')!;
		expect(toggle.previousElementSibling?.getAttribute('data-testid')).toBe('member-count');
		expect(toggle.getAttribute('aria-label')).toBe('Add member');
		toggle.click();
		flushSync();
		expect(queryByText('Add people to General')).not.toBeNull();
		const list = document.querySelector('[data-testid="add-people"]')!;
		const names = () => [...list.querySelectorAll('.ap-pick-who-name')].map((name) => name.textContent);
		expect(names()).toEqual(['Cy', 'Di']);
		// A @user_id typed whole that the client doesn't know is offered to add by it.
		const field = byLabel('Add');
		dom.type(field, '@grace');
		expect(names()).toEqual(['grace']);
		dom.press(field, 'Enter');
		dom.type(field, 'cy');
		dom.press(field, 'Enter');
		flushSync();
		await dom.submit(document.querySelector<HTMLFormElement>('dialog form')!);
		await vi.waitFor(() => expect(dom.byRole('alert').textContent).toBe('Couldn’t add Cy: Denied.'));
		expect(joinRoom.mock.calls).toEqual([['general', 'grace'], ['general', 'cy']]);
		// Who couldn't be added stays picked, to try again; who was added is said in the list.
		expect([...document.querySelectorAll('.ap-pick-chip-name')].map((chip) => chip.textContent)).toEqual(['Cy']);
		expect(dom.byRole('status').textContent).toBe('Added grace.');
		dom.unmount();
		render([ada]);
		expect(dom.queryByRole('button', 'Add member')).toBeNull();
	});
});
