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
});
