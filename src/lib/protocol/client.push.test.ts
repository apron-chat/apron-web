import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from './client';
import { FakeSocket, settle, startClient, type ClientHarness } from '$lib/test/client';

/**
 * Push registration (§4.9): one `push_id` per account, registered after each
 * `auth` as the account it was made for, unregistered as the right account,
 * one request per URL at a time.
 */
let harness: ClientHarness;
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	harness = startClient({ onSnapshot: (next) => (snapshot = next) });
	({ client, socket } = harness);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const webpush = { kind: 'webpush', url: 'https://push.example/a', push_id: 'a1', keys: { p256dh: 'BPk', auth: 'c2Vj' } };
const sent = (method: string) => socket.sent.filter((frame) => frame.method === method).map((frame) => frame.params);

async function greet(push?: Record<string, unknown>, you = 'ada'): Promise<void> {
	socket.open();
	socket.receive({ method: 'server', params: { apron: 9, auth: ['token', 'guest'], capabilities: [], ...(push ? { push } : {}) } });
	// Nothing is registered before auth.
	expect(sent('push_register')).toEqual([]);
	await socket.reply('auth', { you: { user_id: you, name: you } });
}

/** The connection drops, and the next one opens a moment later. */
function reconnect(): void {
	socket = harness.reconnect();
}

/** Signs in to an account with a pasted token: a new connection, greeted. */
async function signIn(push: Record<string, unknown> = { webpush: { key: 'BNcR' } }, you = 'ada'): Promise<void> {
	client.useToken('apron_token');
	vi.advanceTimersByTime(0);
	socket = FakeSocket.latest();
	await greet(push, you);
}

describe('push registration', () => {
	it('registers on each connection while the server offers the kind, and unregisters a replaced one', async () => {
		client.setPushRegistration(webpush, 'ada');
		// A guest has no one to push to: nothing is registered.
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_register')).toEqual([]);
		// Signed in to the account, it registers.
		await signIn();
		expect(sent('push_register')).toEqual([webpush]);
		// The same registration again sends nothing.
		client.setPushRegistration({ ...webpush, keys: { auth: 'c2Vj', p256dh: 'BPk' }, push_id: 'a1' }, 'ada');
		expect(sent('push_register')).toHaveLength(1);
		await socket.reply('push_register', {});
		// A new subscription (another key) unregisters the old endpoint.
		const renewed = { ...webpush, url: 'https://push.example/b' };
		client.setPushRegistration(renewed, 'ada');
		expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
		expect(sent('push_register')).toEqual([webpush, renewed]);
		await socket.reply('push_unregister', {});
		// Each connection registers again.
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_register')).toEqual([renewed]);
		await socket.reply('push_register', {});
		// Turning push off unregisters.
		client.setPushRegistration(undefined);
		expect(sent('push_unregister')).toEqual([{ url: renewed.url }]);
		// A server without the kind is never asked, until a replacing server frame offers it.
		client.setPushRegistration(renewed, 'ada');
		reconnect();
		await greet({ relay: {} });
		expect(sent('push_register')).toEqual([]);
		socket.receive({ method: 'server', params: { apron: 9, auth: ['token', 'guest'], capabilities: [], push: { webpush: { key: 'BNcR' } } } });
		expect(sent('push_register')).toEqual([renewed]);
	});

	it('registers again, on the same url, when the wake scopes change, once the last registration is answered', async () => {
		client.setPushRegistration({ ...webpush, wake: ['mentions', 'replies'] }, 'ada');
		await signIn({ webpush: { key: 'BNcR' }, wake: ['mentions', 'replies', 'private'] });
		client.setPushRegistration({ ...webpush, wake: ['private'] }, 'ada');
		// One request for a url at a time (§1): the new scopes go after the reply.
		expect(sent('push_register')).toEqual([{ ...webpush, wake: ['mentions', 'replies'] }]);
		await socket.reply('push_register', {});
		expect(sent('push_register')).toEqual([{ ...webpush, wake: ['mentions', 'replies'] }, { ...webpush, wake: ['private'] }]);
		// The same url: nothing to unregister.
		expect(sent('push_unregister')).toEqual([]);
	});

	it('registers only for the account it was made for', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn(undefined, 'bob');
		expect(sent('push_register')).toEqual([]);
		client.setPushRegistration({ ...webpush, push_id: 'b2' }, 'bob');
		expect(sent('push_register')).toEqual([{ ...webpush, push_id: 'b2' }]);
	});

	it('unregisters a replaced registration after the next auth when it couldn\'t at once', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		socket.drop();
		const renewed = { ...webpush, url: 'https://push.example/b' };
		client.setPushRegistration(renewed, 'ada');
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		await greet({ webpush: { key: 'BNcR' } });
		expect(socket.sent.filter((frame) => frame.method === 'push_unregister' || frame.method === 'push_register').map((frame) => [frame.method, frame.params]))
			.toEqual([['push_unregister', { url: webpush.url }], ['push_register', renewed]]);
		await socket.reply('push_unregister', {});
		// One lost with its connection goes again; one the server answered doesn't.
		client.setPushRegistration(undefined);
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_unregister')).toEqual([{ url: renewed.url }]);
		await socket.reply('push_unregister', {});
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_unregister')).toEqual([]);
	});

	it('turns push off then on in order: the register waits for the unregister\'s reply', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		await socket.reply('push_register', {});
		const order = () => socket.sent.filter((frame) => frame.method === 'push_unregister' || frame.method === 'push_register').map((frame) => frame.method);
		client.setPushRegistration(undefined);
		client.setPushRegistration(webpush, 'ada');
		expect(order()).toEqual(['push_register', 'push_unregister']);
		await socket.reply('push_unregister', {});
		expect(order()).toEqual(['push_register', 'push_unregister', 'push_register']);
		// Other urls don't wait.
		client.setPushOff('https://push.example/old');
		expect(sent('push_unregister')).toEqual([{ url: webpush.url }, { url: 'https://push.example/old' }]);
	});

	it('sends a queued unregister only as the account it belongs to', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		socket.drop();
		// Turned off while offline: ada's registration is to go after the next auth as ada.
		client.setPushRegistration(undefined);
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		// Bob signs in instead: unregistering would remove Bob's registration of that url, if any.
		await greet({ webpush: { key: 'BNcR' } }, 'bob');
		expect(sent('push_unregister')).toEqual([]);
		reconnect();
		await greet({ webpush: { key: 'BNcR' } }, 'ada');
		expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
	});

	it('shows a refused registration, until one succeeds', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		socket.receive({ id: socket.request('push_register').id, error: { code: -32001, message: 'Push is for members only' } });
		await settle();
		expect(snapshot.pushError).toBe('Push is for members only');
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		await socket.reply('push_register', {});
		expect(snapshot.pushError).toBeUndefined();
	});

	it('unregisters this browser\'s endpoint after each auth while push is off for the account', async () => {
		client.setPushOff('https://push.example/old');
		await signIn();
		expect(sent('push_unregister')).toEqual([{ url: 'https://push.example/old' }]);
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_unregister')).toEqual([{ url: 'https://push.example/old' }]);
		// Not for the endpoint it registers.
		client.setPushOff(undefined);
		client.setPushRegistration({ ...webpush, url: 'https://push.example/old' }, 'ada');
		reconnect();
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_unregister')).toEqual([]);
	});

	it('unregisters on sign-out, without waiting for a registration in flight', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		expect(sent('push_register')).toEqual([webpush]);
		const signedOut = socket;
		await client.signOut();
		expect(signedOut.sent.filter((frame) => frame.method === 'push_unregister').map((frame) => frame.params)).toEqual([{ url: webpush.url }]);
		// Forgotten: the next account isn't registered with it.
		vi.advanceTimersByTime(0);
		socket = FakeSocket.latest();
		await signIn();
		expect(sent('push_register')).toEqual([]);
	});

	it('sends a sign-out\'s unanswered unregister again when that account signs in, and only then', async () => {
		client.setPushRegistration(webpush, 'ada');
		await signIn();
		await socket.reply('push_register', {});
		const signedOut = socket;
		await client.signOut();
		// The connection is replaced as a guest before the answer comes: it is lost.
		expect(signedOut.sent.filter((frame) => frame.method === 'push_unregister').map((frame) => frame.params)).toEqual([{ url: webpush.url }]);
		vi.advanceTimersByTime(0);
		socket = FakeSocket.latest();
		await greet({ webpush: { key: 'BNcR' } }, 'guest_1');
		expect(sent('push_unregister')).toEqual([]);
		// Another account isn't asked: it would drop that account's registration of the url.
		await signIn(undefined, 'bob');
		expect(sent('push_unregister')).toEqual([]);
		// The same account signs in again: the unregister goes, and push stays off.
		await signIn();
		expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
		expect(sent('push_register')).toEqual([]);
		await socket.reply('push_unregister', {});
		// Answered, it is done.
		const answered = socket;
		socket.drop();
		vi.advanceTimersByTime(60_000);
		socket = FakeSocket.latest();
		expect(socket).not.toBe(answered);
		await greet({ webpush: { key: 'BNcR' } });
		expect(sent('push_unregister')).toEqual([]);
	});
});
