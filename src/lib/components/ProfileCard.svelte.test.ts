// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { profileCard } from '$lib/ui/profile-card.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import ProfileCard from './ProfileCard.svelte';
import * as dom from '$lib/test/dom';

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
});

afterEach(() => {
	profileCard.close();
	directory.forget();
	vi.unstubAllGlobals();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The card for `userId`, signed in as `you`, with these users known. */
function render(userId: string, users: Identity[], you: Identity = ada, room?: RoomSnapshot, member?: boolean, capabilities: string[] = [], recorded: Identity[] = [], fields: Partial<ClientSnapshot> = {}): HTMLElement {
	const snapshot: ClientSnapshot = {
		...blankSnapshot(), authenticated: true, you, users: Object.fromEntries(users.map((user) => [user.user_id, user])),
		recordedUsers: Object.fromEntries(recorded.map((user) => [user.user_id, user])), userAliases: {}, ...fields
	};
	directory.apply(snapshot, undefined);
	const session = { snapshot, canManageRooms: false, server: { apron: 10, auth: ['guest'], capabilities } } as unknown as SessionView;
	dom.render(ProfileCard, { client: undefined, session, room, canChange: false, canMention: false, onmention: () => undefined });
	const anchor = document.createElement('button');
	document.body.appendChild(anchor);
	profileCard.toggle({ anchor, userId, ...(member !== undefined ? { member } : {}) });
	flushSync();
	return document.querySelector<HTMLElement>('[data-testid="profile-card"]')!;
}

describe('ProfileCard status', () => {
	it('shows your own invisible as you chose it', () => {
		const hidden = { ...ada, status: 'invisible' };
		const card = render('ada', [hidden], hidden);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Invisible · others see you as offline');
		expect(card.querySelector('.ap-presence-invisible')).not.toBeNull();
	});
});

describe('ProfileCard last seen', () => {
	const NOW = Date.UTC(2026, 9, 22, 12);
	const seen = String(NOW - 3 * 60 * 60 * 1000);

	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('says when an offline person was last seen (§4.5.2), with the exact time as its tooltip', () => {
		const card = render('bob', [ada, { user_id: 'bob', name: 'Bob', status: 'offline', seen }]);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Offline');
		const time = card.querySelector<HTMLTimeElement>('[data-testid="profile-seen"]')!;
		expect(time.textContent).toBe('Last seen 3h ago');
		expect(time.getAttribute('datetime')).toBe(new Date(Number(seen)).toISOString());
		expect(time.title).toMatch(/^Last seen \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
	});

	it('says recently under ten minutes ago, with a tooltip that says no more than that, and the time shown as its datetime', () => {
		const recent = String(NOW - 4 * 60 * 1000);
		const card = render('bob', [ada, { user_id: 'bob', name: 'Bob', status: 'offline', seen: recent }]);
		const time = card.querySelector<HTMLTimeElement>('[data-testid="profile-seen"]')!;
		expect([time.textContent, time.getAttribute('datetime'), time.title]).toEqual(['Last seen recently', '2026-10-22T11:56:00.000Z', 'Last seen within the last 10 minutes']);
	});

	it('shows when this page saw them go offline over an older seen from the server', () => {
		const card = render('bob', [ada, { user_id: 'bob', name: 'Bob', status: 'offline', seen }], ada, undefined, undefined, [], [], { sawOffline: { bob: NOW - 60 * 1000 } });
		const time = card.querySelector<HTMLTimeElement>('[data-testid="profile-seen"]')!;
		expect([time.textContent, time.getAttribute('datetime'), time.title]).toEqual(['Last seen recently', '2026-10-22T11:59:00.000Z', 'Last seen within the last 10 minutes']);
	});

	it('says nothing of a seen kept from before they came back online, an unreadable one, one past what a Date holds, a recorded one, or yours', () => {
		// Each with the status the card shows: where it is offline, the seen alone decides.
		const cases: [string, Identity[], Identity, Identity[], string | undefined][] = [
			['back online', [ada, { user_id: 'bob', status: 'online', seen }], ada, [], 'Online'],
			['no status', [ada, { user_id: 'bob', seen }], ada, [], undefined],
			['unreadable', [ada, { user_id: 'bob', status: 'offline', seen: 'yesterday' }], ada, [], 'Offline'],
			// The log_id format allows it, but formatting it as a date throws.
			['past what a Date holds', [ada, { user_id: 'bob', status: 'offline', seen: '9000000000000000' }], ada, [], 'Offline'],
			// Offline in the kept object, with a seen only in the recorded one.
			['recorded only', [ada, { user_id: 'bob', status: 'offline' }], ada, [{ user_id: 'bob', status: 'offline', seen }], 'Offline'],
			['yours', [{ ...ada, status: 'offline', seen }], { ...ada, status: 'offline', seen }, [], 'Offline']
		];
		for (const [what, users, you, recorded, status] of cases) {
			const card = render(what === 'yours' ? 'ada' : 'bob', users, you, undefined, undefined, [], recorded);
			expect(card.querySelector('[data-testid="profile-status"]')?.textContent, what).toBe(status);
			expect(card.querySelector('[data-testid="profile-seen"]'), what).toBeNull();
			profileCard.close();
			dom.unmount();
		}
	});
});

describe('ProfileCard membership', () => {
	const bob: Identity = { user_id: 'bob', name: 'Bob' };
	// A large room that lists only its recently active members, without Bob.
	const general = { id: 'general', title: 'General', joined: true, members: [ada], memberCount: 40 } as unknown as RoomSnapshot;

	it('says a member the listing leaves out may still be one', () => {
		expect(render('bob', [ada, bob], ada, general).textContent).toContain('Not among the recently active members of General');
	});

	it('says they are a member when a lookup found them (a link’s user, §4.2.1)', () => {
		expect(render('bob', [ada, bob], ada, general, true).textContent).toContain('Member of General');
	});
});

describe('ProfileCard bio', () => {
	const bob: Identity = { user_id: 'bob', name: 'Bob', ext: { bio: 'Builds bridges.' } };

	it('shows the kept bio on a server that keeps one (ext:bio)', () => {
		expect(render('bob', [ada, bob], ada, undefined, undefined, ['ext']).querySelector('[data-testid="profile-bio"]')?.textContent).toBe('Builds bridges.');
	});

	it('shows none from a server that keeps none, or once it is cleared', () => {
		expect(render('bob', [ada, bob]).querySelector('[data-testid="profile-bio"]')).toBeNull();
		dom.unmount();
		expect(render('bob', [ada, { ...bob, ext: { bio: '' } }], ada, undefined, undefined, ['ext:bio']).querySelector('[data-testid="profile-bio"]')).toBeNull();
	});

	it('links its http(s) URLs to open in a new tab, and nothing else', () => {
		const linked = { ...bob, ext: { bio: 'Bridges: https://bridges.example/bob\n<b>not bold</b> javascript:alert(1) @ada' } };
		const bio = render('bob', [ada, linked], ada, undefined, undefined, ['ext']).querySelector('[data-testid="profile-bio"]')!;
		expect([...bio.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.target, a.rel])).toEqual([['https://bridges.example/bob', '_blank', 'noreferrer noopener']]);
		expect(bio.querySelectorAll('b, button').length).toBe(0);
		expect(bio.textContent).toBe('Bridges: https://bridges.example/bob\n<b>not bold</b> javascript:alert(1) @ada');
	});

	it('never shows one from a recorded object, which is as of its record', () => {
		expect(render('bob', [ada], ada, undefined, undefined, ['ext'], [bob]).querySelector('[data-testid="profile-bio"]')).toBeNull();
	});
});

describe('ProfileCard Message', () => {
	const bob: Identity = { user_id: 'bob', name: 'Bob' };
	const members = (...ids: string[]) => ids.map((user_id) => ({ user_id }));
	const withBob = { id: 'p1', title: 'Bob', joined: true, private: true, namedForMembers: true, members: members('ada', 'bob') } as unknown as RoomSnapshot;

	/** The card for `userId`, with Message offered to the session as `canMessage` says, and the client's requests answered. */
	function card(userId: string, options: { canMessage?: boolean; rooms?: RoomSnapshot[]; you?: Identity } = {}) {
		const you = options.you ?? ada;
		const rooms = options.rooms ?? [];
		const snapshot: ClientSnapshot = { ...blankSnapshot(), authenticated: true, you, rooms, users: { ada, bob, [you.user_id]: you } };
		directory.apply(snapshot, undefined);
		const session = { snapshot, rooms, you, canManageRooms: true, server: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } } as unknown as SessionView;
		const created = { room_id: 'p2' };
		const client = {
			createRoom: vi.fn(() => ({ id: 'c1', promise: Promise.resolve(created) })),
			joinRoom: vi.fn(() => ({ id: 'c2', promise: Promise.resolve({}) })),
			subscribe: vi.fn((listener: (next: ClientSnapshot) => void) => {
				listener({ ...snapshot, rooms: [...rooms, { id: 'p2', title: 'You', joined: true, private: true } as RoomSnapshot] });
				return () => true;
			})
		};
		const onopenroom = vi.fn();
		dom.render(ProfileCard, { client: client as never, session, room: undefined, canChange: false, canMention: false, canMessage: options.canMessage ?? true, onmention: () => undefined, onopenroom });
		const anchor = document.createElement('button');
		document.body.appendChild(anchor);
		profileCard.toggle({ anchor, userId });
		flushSync();
		return { box: document.querySelector<HTMLElement>('[data-testid="profile-card"]')!, client, onopenroom };
	}

	it('is offered for someone else, signed in, but not on your own card, a system identity’s, or as a guest', () => {
		expect(dom.queryByRole('button', 'Message', card('bob').box)).not.toBeNull();
		dom.unmount();
		expect(dom.queryByRole('button', 'Message', card('ada').box)).toBeNull();
		dom.unmount();
		expect(dom.queryByRole('button', 'Message', card('~server').box)).toBeNull();
		dom.unmount();
		expect(dom.queryByRole('button', 'Message', card('bob', { canMessage: false }).box)).toBeNull();
	});

	it('opens the conversation you already have with them', async () => {
		const { box, client, onopenroom } = card('bob', { rooms: [withBob] });
		dom.button('Message', box).click();
		await vi.waitFor(() => expect(onopenroom).toHaveBeenCalledWith('p1'));
		expect(client.createRoom).not.toHaveBeenCalled();
	});

	it('starts one otherwise: created private, then them added, then opened', async () => {
		const { box, client, onopenroom } = card('bob', { rooms: [{ ...withBob, title: 'Team', namedForMembers: undefined } as unknown as RoomSnapshot] });
		dom.button('Message', box).click();
		flushSync();
		expect(dom.button('Opening…', box).disabled).toBe(true);
		await vi.waitFor(() => expect(onopenroom).toHaveBeenCalledWith('p2'));
		expect(client.createRoom).toHaveBeenCalledWith({ private: true });
		expect(client.joinRoom).toHaveBeenCalledWith('p2', 'bob');
	});
});
