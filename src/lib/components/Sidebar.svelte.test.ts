// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilitiesOf, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import { createTimeline } from '$lib/protocol/reducer';
import { blankSnapshot, SessionView } from '$lib/ui/session.svelte';
import Sidebar from './Sidebar.svelte';
import * as dom from '$lib/test/dom';

afterEach(() => {
	localStorage.clear();
});

const server = { apron: 9, auth: ['token'], capabilities: ['history', 'rooms'] };
const general: RoomSnapshot = { id: 'general', title: 'General', joined: true, timeline: createTimeline('general'), recovering: false, loaded: true, loading: false, notices: [] } as RoomSnapshot;
const live = (fields: Partial<ClientSnapshot> = {}): ClientSnapshot => ({
	...blankSnapshot(), status: 'connected', authenticated: true, you: { user_id: 'ada', name: 'Ada' }, roomsListed: true,
	server, capabilities: capabilitiesOf(server), rooms: [general], activeRoom: 'general', ...fields
});

describe('Sidebar', () => {
	it('lists the rooms to browse again on each connection, through a quiet reconnect too', () => {
		const listRooms = vi.fn((_parent?: string) => Promise.resolve());
		// Anything else the sidebar asks of the client does nothing here.
		const client = new Proxy({ listRooms, url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const session = new SessionView();
		session.apply(live(), client);
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', threads: [], mentions: {}, unread: {}, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onconnect: vi.fn() } as never);
		flushSync();
		const listed = () => listRooms.mock.calls.filter(([parent]) => parent === undefined).length;
		expect(listed()).toBe(1);

		// A short drop: the + stays (the session is steady), and the new connection, which has no listing, lists again.
		session.apply({ ...blankSnapshot(), status: 'reconnecting', disconnectedAt: Date.now(), retryingSince: Date.now() }, client);
		flushSync();
		expect(document.querySelector('[aria-label="Create room"]')).not.toBeNull();
		session.apply(live(), client);
		flushSync();
		expect(listed()).toBe(2);
		session.dispose();
	});

	it('names the server in its head, and reaches the connect screen from the profile, closing it', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'wss://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const session = new SessionView();
		session.apply(live(), client);
		const onconnect = vi.fn();
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', serverLook: { title: 'Fake' }, serverAddress: client.url, threads: [], mentions: {}, unread: {}, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onsignin: vi.fn(), onconnect } as never);
		const head = document.querySelector('.ap-shell-sidehead')!;
		expect(head.querySelector('.ap-shell-sidehead-name')?.textContent).toBe('Fake');
		expect(head.querySelector('.ap-shell-sidehead-host')?.textContent).toBe('fake.test');
		expect(head.querySelector('button')).toBeNull();
		dom.button(/^Your profile on fake\.test/).click();
		flushSync();
		const editor = dom.byRole('dialog', 'Edit profile');
		dom.button('Connect to a server…', editor).click();
		flushSync();
		expect(onconnect).toHaveBeenCalledOnce();
		expect(dom.queryByRole('dialog', 'Edit profile')).toBeNull();
		session.dispose();
	});

	it('folds the open room’s threads to those with news when it is picked again, and unfolds them when picked once more, from the … on its row, or on leaving it', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const thread = (id: string, title: string): RoomSnapshot => ({ ...general, id, title, parentRoomId: 'general', timeline: createTimeline(id) }) as RoomSnapshot;
		const random: RoomSnapshot = { ...general, id: 'random', title: 'Random', timeline: createTimeline('random') } as RoomSnapshot;
		const session = new SessionView();
		session.apply(live({ rooms: [general, random, thread('deploy', 'Deploy'), thread('cert', 'Expired cert')] }), client);
		const onroom = vi.fn();
		const threads = [thread('deploy', 'Deploy'), thread('cert', 'Expired cert')].map((room) => ({ id: room.id, parentRoomId: 'general', title: room.title, loaded: true, participants: [], joined: true }));
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', threads, mentions: {}, unread: { cert: 2 }, displayName: 'Ada', onroom, onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onconnect: vi.fn() } as never);
		flushSync();
		const listed = () => [...document.querySelectorAll<HTMLElement>('button[data-thread]')].map((button) => button.dataset.thread);
		const room = (id: string) => document.querySelector<HTMLElement>(`button[data-room="${id}"]`)!;
		expect(listed()).toEqual(['deploy', 'cert']);

		const expand = () => document.querySelector<HTMLElement>('[data-testid="expand-threads"]');
		expect(expand()).toBeNull();

		room('general').click();
		flushSync();
		expect(listed()).toEqual(['cert']);
		expect(expand()?.getAttribute('aria-label')).toBe('Show all threads in General');
		// On the room's own row, beside its +.
		expect(expand()!.closest('.ap-roomstart')?.querySelector('[data-room="general"]')).not.toBeNull();
		expect(onroom).toHaveBeenCalledTimes(1);
		room('general').click();
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		expect(expand()).toBeNull();

		// The … after the folded list unfolds it too.
		room('general').click();
		flushSync();
		expand()!.click();
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		expect(onroom).toHaveBeenCalledTimes(3);

		// Folded, then another room opened and this one again: it opens unfolded.
		room('general').click();
		flushSync();
		session.apply(live({ rooms: session.rooms, activeRoom: 'random' }), client);
		flushSync();
		session.apply(live({ rooms: session.rooms, activeRoom: 'general' }), client);
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		session.dispose();
	});
});
