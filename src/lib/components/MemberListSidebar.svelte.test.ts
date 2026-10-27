// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import MemberListSidebar from './MemberListSidebar.svelte';
import * as dom from '$lib/test/dom';

afterEach(() => {
	localStorage.clear();
	directory.forget();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The member list of a room whose members carry these statuses, signed in as Ada, on a server with `status`. */
function render(users: Identity[], fields: Partial<ClientSnapshot> = {}, canChange = false) {
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
	dom.render(MemberListSidebar, { client: canChange ? ({} as never) : undefined, session, room, open: true, canChange });
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

	it('offers Add member, to someone who can change members, as a plus after the header\'s count: it opens the form atop the list, and Escape shuts it', async () => {
		render([ada, { user_id: 'bo', name: 'Bo' }], {}, true);
		const body = document.querySelector('[data-testid="room-member-list"]')!;
		const toggle = document.querySelector<HTMLButtonElement>('.ap-memberlist-head .ap-memberlist-addtoggle')!;
		expect(toggle.previousElementSibling?.getAttribute('data-testid')).toBe('member-count');
		expect(toggle.getAttribute('aria-label')).toBe('Add member');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		toggle.click();
		flushSync();
		const form = body.querySelector<HTMLFormElement>('form.ap-memberlist-add')!;
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(body.firstElementChild).toBe(form);
		expect(toggle.getAttribute('aria-controls')).toBe(form.id);
		const input = form.querySelector('input')!;
		await vi.waitFor(() => expect(document.activeElement).toBe(input));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(body.querySelector('form.ap-memberlist-add')).toBeNull();
		expect(document.activeElement).toBe(toggle);
		dom.unmount();
		render([ada]);
		expect(dom.queryByRole('button', 'Add member')).toBeNull();
	});
});
