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

	const fake = (listRooms = vi.fn((_parent?: string) => Promise.resolve())) =>
		new Proxy({ listRooms, url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
	const sidebar = (client: ChatClient, session: SessionView, props: Record<string, unknown> = {}) =>
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', threads: [], mentions: {}, unread: {}, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onconnect: vi.fn(), ...props } as never);
	const names = (testid: string) => [...document.querySelectorAll(`[data-testid="${testid}"] .ap-room-name`)].map((name) => name.textContent);

	it('shows Other Rooms open from the start, each with its member count and Join, and folds it to nothing, there being no news there', () => {
		const listRooms = vi.fn((_parent?: string) => Promise.resolve());
		const client = fake(listRooms);
		const session = new SessionView();
		const listing = (id: string, title: string, memberCount?: number) => ({ id, title, joined: false, record: { room_id: id }, members: [], memberCount });
		session.apply(live({ directory: [listing('design', 'Design', 12), listing('quiet', 'Quiet')] as never }), client);
		const onjoin = vi.fn();
		sidebar(client, session, { onjoin });
		flushSync();
		const toggle = document.querySelector<HTMLButtonElement>('[data-testid="browse-rooms"]')!;
		expect([toggle.textContent, toggle.getAttribute('aria-expanded')]).toEqual(['Other Rooms', 'true']);
		const directory = document.querySelector('[data-testid="room-directory"]')!;
		expect([...directory.querySelectorAll('.ap-room-topic')].map((topic) => topic.textContent)).toEqual(['12 members · Join', 'Join']);
		expect(directory.querySelector('.ap-sect-note')).toBeNull();
		directory.querySelector<HTMLButtonElement>('[data-join="design"]')!.click();
		expect(onjoin).toHaveBeenCalledWith('design');
		toggle.click();
		flushSync();
		expect([toggle.getAttribute('aria-expanded'), names('room-directory')]).toEqual(['false', []]);
		expect(localStorage.getItem('apron.sidebarFolds')).toBe('["otherRooms"]');
		// Its …, as the heading does, shows them all again, listed afresh.
		const listed = listRooms.mock.calls.length;
		dom.button('Show all Other Rooms').click();
		flushSync();
		expect([toggle.getAttribute('aria-expanded'), names('room-directory'), listRooms.mock.calls.length]).toEqual(['true', ['Design', 'Quiet'], listed + 1]);
		expect(dom.queryByRole('button', 'Show all Other Rooms')).toBeNull();
		session.dispose();
	});

	it('folds Rooms to those with news, in them or their threads, and the open one, until the heading or its … unfolds it, kept as left', () => {
		const client = fake();
		const session = new SessionView();
		const room = (id: string, title: string, fields: Partial<RoomSnapshot> = {}) => ({ ...general, id, title, timeline: createTimeline(id), ...fields }) as RoomSnapshot;
		const rooms = [general, room('ops', 'Ops'), room('design', 'Design'), room('quiet', 'Quiet'), room('t1', 'Deploy', { parentRoomId: 'design' })];
		session.apply(live({ rooms }), client);
		sidebar(client, session, { unread: { ops: 3, t1: 1 } });
		flushSync();
		expect(names('room-list')).toEqual(['General', 'Ops', 'Design', 'Deploy', 'Quiet']);
		dom.button('Rooms').click();
		flushSync();
		// General is open; Ops has unread, Design a thread with news; Quiet has none.
		expect([names('room-list'), dom.button('Rooms').getAttribute('aria-expanded')]).toEqual([['General', 'Ops', 'Design', 'Deploy'], 'false']);
		expect(localStorage.getItem('apron.sidebarFolds')).toBe('["rooms"]');
		dom.button('Show all Rooms').click();
		flushSync();
		expect([names('room-list'), document.activeElement]).toEqual([['General', 'Ops', 'Design', 'Deploy', 'Quiet'], dom.button('Rooms')]);
		expect(localStorage.getItem('apron.sidebarFolds')).toBe('[]');
		dom.button('Rooms').click();
		dom.unmount();
		// Folded the next time the page opens, too.
		sidebar(client, session, { unread: { ops: 3, t1: 1 } });
		flushSync();
		expect(names('room-list')).toEqual(['General', 'Ops', 'Design', 'Deploy']);
		session.dispose();
	});

	it('heads each section with an h2, and folds Private alone to those with mentions, to none at all, or to the open one', () => {
		const client = fake();
		const session = new SessionView();
		const room = (id: string, title: string, fields: Partial<RoomSnapshot> = {}) => ({ ...general, id, title, timeline: createTimeline(id), ...fields }) as RoomSnapshot;
		const rooms = [general, room('quiet', 'Quiet'), room('bo', 'Bo', { private: true }), room('cy', 'Cy', { private: true }), room('t1', 'Plans', { parentRoomId: 'cy', private: true })];
		session.apply(live({ rooms }), client);
		sidebar(client, session, { onnewprivate: vi.fn(), mentions: { t1: 1 } });
		flushSync();
		expect(dom.byRole('heading', 'Rooms').tagName).toBe('H2');
		expect(dom.byRole('heading', 'Private').querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
		dom.button('Private').click();
		flushSync();
		// Cy's thread has a mention, and nothing else unread: Cy stays, with it; Bo goes. Rooms is left as it was.
		expect([names('private-list'), names('room-list')]).toEqual([['Cy', 'Plans'], ['General', 'Quiet']]);
		expect(localStorage.getItem('apron.sidebarFolds')).toBe('["private"]');
		dom.button('Rooms').click();
		flushSync();
		// Nothing in Rooms has news but the open room.
		expect(names('room-list')).toEqual(['General']);
		dom.unmount();
		sidebar(client, session, { onnewprivate: vi.fn(), mentions: {} });
		flushSync();
		// No news anywhere: a folded section with none of its rooms open shows its heading and … alone.
		expect([names('private-list'), dom.button('Show all Private').isConnected]).toEqual([[], true]);
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
