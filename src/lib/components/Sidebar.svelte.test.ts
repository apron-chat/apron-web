// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { capabilitiesOf, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import { createTimeline } from '$lib/protocol/reducer';
import { blankSnapshot, SessionView } from '$lib/ui/session.svelte';
import Sidebar from './Sidebar.svelte';
import { serverPane } from '$lib/ui/server-pane.svelte';
import { RoomOrder } from '$lib/ui/room-order.svelte';
import { loadRoomOrder, saveRoomOrder } from '$lib/ui/storage';
import * as dom from '$lib/test/dom';

// jsdom has no Web Animations: the rooms' flip as they make way (svelte/animate) asks an element for its own.
beforeAll(() => {
	if (!('getAnimations' in Element.prototype)) Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
});

afterEach(() => {
	localStorage.clear();
});

const server = { apron: 10, auth: ['token'], capabilities: ['history', 'rooms'] };
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

	it('lists the threads of a room open without joining right under its row in Other Rooms, all of them, to read one without joining; joining one sets the rest apart again', () => {
		const client = fake();
		const session = new SessionView();
		const listing = (id: string, title: string, parentRoomId?: string) => ({ id, title, joined: false, record: { room_id: id, ...(parentRoomId ? { parent_room_id: parentRoomId } : {}) }, members: [] });
		const design = { ...general, id: 'design', title: 'Design', joined: false, timeline: createTimeline('design') } as RoomSnapshot;
		const titles = ['Palette', 'Fonts', 'Icons', 'Motion'];
		const threads = titles.map((title, n) => listing(`t${n}`, title, 'design'));
		session.apply(live({ rooms: [general, design], activeRoom: 'design', directory: [listing('design', 'Design'), listing('quiet', 'Quiet')], threadDirectory: { design: threads } } as never), client);
		const onopenthread = vi.fn();
		const onjoin = vi.fn();
		const root = sidebar(client, session, { onopenthread, onjoin });
		flushSync();
		const directory = () => root.querySelector('[data-testid="room-directory"]')!;
		const rows = () => [...directory().querySelectorAll('[data-other-thread]')].map((row) => row.querySelector('.ap-room-name')?.textContent);
		// Under the open one only, with no Other Threads heading and none held back behind N more…, there being none of yours to set them apart from.
		expect([rows(), directory().querySelector('.ap-threads-head'), directory().querySelector('[data-testid="more-threads"]')]).toEqual([titles, null, null]);
		// Picking one reads it, which joins nothing.
		directory().querySelector<HTMLButtonElement>('[data-other-thread="t0"]')!.click();
		expect([onopenthread.mock.calls, onjoin.mock.calls]).toEqual([[['t0']], []]);

		// Once one is joined, the rest are others to it again: under their heading, the first few showing.
		dom.unmount(root);
		const joined = { id: 't0', parentRoomId: 'design', title: 'Palette', loaded: false, participants: [], joined: true };
		session.apply(live({ rooms: [general, design], activeRoom: 'design', directory: [listing('design', 'Design')], threadDirectory: { design: threads.slice(1) } } as never), client);
		const again = sidebar(client, session, { threads: [joined] });
		flushSync();
		const others = again.querySelector('[data-testid="room-directory"]')!;
		expect(others.querySelector('[data-thread="t0"] .ap-room-name')?.textContent).toBe('Palette');
		expect(others.querySelector('.ap-threads-head')?.textContent).toContain('Other Threads');
		expect([...others.querySelectorAll('[data-other-thread]')].map((row) => row.querySelector('.ap-room-name')?.textContent)).toEqual(['Fonts', 'Icons', 'Motion']);
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

	it('names the server in its head, which opens the server pane, and opens your profile from its foot', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'wss://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const session = new SessionView();
		session.apply(live(), client);
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', serverLook: { title: 'Fake' }, serverAddress: client.url, threads: [], mentions: {}, unread: {}, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onsignin: vi.fn() } as never);
		const head = document.querySelector('.ap-shell-sidehead')!;
		expect(head.querySelector('.ap-shell-sidehead-name')?.textContent).toBe('Fake');
		expect(head.querySelector('.ap-shell-sidehead-host')?.textContent).toBe('fake.test');
		const server = dom.button(/^Server: .*Fake.*fake\.test$/s);
		expect(server.getAttribute('aria-expanded')).toBe('false');
		server.click();
		flushSync();
		expect(serverPane.anchor).toBe(server);
		expect(server.getAttribute('aria-expanded')).toBe('true');
		server.click();
		flushSync();
		expect(serverPane.anchor).toBeUndefined();
		// One button at the foot: your profile, in the preferences.
		expect(dom.button(/^Open preferences\. Your profile on fake\.test: /)).toBeTruthy();
		session.dispose();
	});

	it('folds the open room’s threads to those with news when it is picked again, and unfolds them when picked once more or from the … on its row', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const thread = (id: string, title: string): RoomSnapshot => ({ ...general, id, title, parentRoomId: 'general', timeline: createTimeline(id) }) as RoomSnapshot;
		const random: RoomSnapshot = { ...general, id: 'random', title: 'Random', timeline: createTimeline('random') } as RoomSnapshot;
		const session = new SessionView();
		session.apply(live({ rooms: [general, random, thread('deploy', 'Deploy'), thread('cert', 'Expired cert')] }), client);
		const onroom = vi.fn();
		const threads = [thread('deploy', 'Deploy'), thread('cert', 'Expired cert')].map((room) => ({ id: room.id, parentRoomId: 'general', title: room.title, loaded: true, participants: [], joined: true }));
		const props = $state({ client, session, backendLabel: 'fake.test', account: 'acct', threads, activeThread: undefined as string | undefined, mentions: {}, unread: { cert: 2 }, displayName: 'Ada', onroom, onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn() });
		dom.render(Sidebar, props as never);
		flushSync();
		const listed = () => [...document.querySelectorAll<HTMLElement>('button[data-thread]')].map((button) => button.dataset.thread);
		const room = (id: string) => document.querySelector<HTMLElement>(`button[data-room="${id}"]`)!;
		const expand = () => document.querySelector<HTMLElement>('[data-testid="expand-threads"]');
		expect(listed()).toEqual(['deploy', 'cert']);
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

		// The … on its row unfolds it too.
		room('general').click();
		flushSync();
		expand()!.click();
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		expect(onroom).toHaveBeenCalledTimes(3);
		session.dispose();
	});

	it('keeps a room folded as you come and go, lists the thread you open in it while you read it, and remembers it on this device', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const thread = (id: string, title: string): RoomSnapshot => ({ ...general, id, title, parentRoomId: 'general', timeline: createTimeline(id) }) as RoomSnapshot;
		const random: RoomSnapshot = { ...general, id: 'random', title: 'Random', timeline: createTimeline('random') } as RoomSnapshot;
		const session = new SessionView();
		session.apply(live({ rooms: [general, random, thread('deploy', 'Deploy'), thread('cert', 'Expired cert')] }), client);
		const threads = [thread('deploy', 'Deploy'), thread('cert', 'Expired cert')].map((room) => ({ id: room.id, parentRoomId: 'general', title: room.title, loaded: true, participants: [], joined: true }));
		const props = $state({ client, session, backendLabel: 'fake.test', account: 'acct', threads, activeThread: undefined as string | undefined, mentions: {}, unread: { cert: 2 }, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn() });
		const listed = () => [...document.querySelectorAll<HTMLElement>('button[data-thread]')].map((button) => button.dataset.thread);
		const room = (id: string) => document.querySelector<HTMLElement>(`button[data-room="${id}"]`)!;
		const expand = () => document.querySelector<HTMLElement>('[data-testid="expand-threads"]');
		dom.render(Sidebar, props as never);
		flushSync();
		room('general').click();
		flushSync();
		expect(listed()).toEqual(['cert']);

		// Another room opened, then this one again: still folded.
		session.apply(live({ rooms: session.rooms, activeRoom: 'random' }), client);
		flushSync();
		session.apply(live({ rooms: session.rooms, activeRoom: 'general' }), client);
		flushSync();
		expect(listed()).toEqual(['cert']);
		expect(expand()).not.toBeNull();

		// A quiet thread opened in it shows, picked out, while it's open, and goes when you're back in the room.
		props.activeThread = 'deploy';
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		expect(document.querySelector('button[data-thread="deploy"]')!.getAttribute('aria-current')).toBe('page');
		expect(expand()).not.toBeNull();
		props.activeThread = undefined;
		flushSync();
		expect(listed()).toEqual(['cert']);

		// Kept for the account: a new page starts folded, and unfolding is kept too.
		dom.unmount();
		dom.render(Sidebar, props as never);
		flushSync();
		expect(listed()).toEqual(['cert']);
		expand()!.click();
		flushSync();
		dom.unmount();
		dom.render(Sidebar, props as never);
		flushSync();
		expect(listed()).toEqual(['deploy', 'cert']);
		session.dispose();
	});

	it('lists the rooms in the order kept for the account, new ones last, and moves one with Alt+↑/↓, saying so', () => {
		const client = new Proxy({ listRooms: () => Promise.resolve(), url: 'ws://fake.test/' }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }) as unknown as ChatClient;
		const room = (id: string, title: string): RoomSnapshot => ({ ...general, id, title, timeline: createTimeline(id) }) as RoomSnapshot;
		saveRoomOrder('acct', ['random', 'general']);
		const order = new RoomOrder();
		order.load('acct');
		const session = new SessionView();
		// The server lists them in another order, with one it hasn't before.
		session.apply(live({ rooms: [general, room('ops', 'Ops'), room('random', 'Random')] }), client);
		dom.render(Sidebar, { client, session, backendLabel: 'fake.test', account: 'acct', order, threads: [], mentions: {}, unread: {}, displayName: 'Ada', onroom: vi.fn(), onthread: vi.fn(), onopenthread: vi.fn(), onjoin: vi.fn(), onleavethread: vi.fn(), oncreateroom: vi.fn(), onnewthread: vi.fn(), onsignout: vi.fn(), onconnect: vi.fn() } as never);
		flushSync();
		const listed = () => [...document.querySelectorAll<HTMLElement>('[data-testid="room-list"] button[data-room]')].map((button) => button.dataset.room);
		expect(listed()).toEqual(['random', 'general', 'ops']);
		expect(loadRoomOrder('acct')).toEqual(['random', 'general', 'ops']);

		const random = document.querySelector<HTMLElement>('button[data-room="random"]')!;
		random.focus();
		random.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
		flushSync();
		expect(listed()).toEqual(['general', 'random', 'ops']);
		expect(loadRoomOrder('acct')).toEqual(['general', 'random', 'ops']);
		// Where the keyboard ends up is the browser's to show: e2e/room-order.spec.ts.
		expect(dom.byRole('status').textContent).toBe('Random moved down, 2 of 3');
		// Not past the top; a plain arrow doesn't move it.
		const general_ = document.querySelector<HTMLElement>('button[data-room="general"]')!;
		general_.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
		general_.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		flushSync();
		expect(listed()).toEqual(['general', 'random', 'ops']);
		session.dispose();
	});

	it('on a phone, folds the open room’s threads when it’s picked, staying in the list rather than going back to the room', () => {
		const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		try {
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
			room('general').click();
			flushSync();
			expect(listed()).toEqual(['cert']);
			expect(onroom).not.toHaveBeenCalled();
			room('general').click();
			flushSync();
			expect(listed()).toEqual(['deploy', 'cert']);
			expect(onroom).not.toHaveBeenCalled();
			// Another room is picked as ever, out of the list.
			room('random').click();
			expect(onroom).toHaveBeenCalledOnce();
			session.dispose();
		} finally {
			if (width) Object.defineProperty(window, 'innerWidth', width);
		}
	});
});
