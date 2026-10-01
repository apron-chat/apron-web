import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient } from './client';
import { FakeSocket, settle } from './fake-socket';
import { requestPasskey, signalPasskeyLabel } from './webauthn';

vi.mock('./webauthn', () => ({
	requestPasskey: vi.fn(),
	signalPasskeyLabel: vi.fn()
}));

const storage = new Map<string, string>();

beforeEach(() => {
	FakeSocket.instances = [];
	storage.clear();
	vi.stubGlobal('WebSocket', FakeSocket);
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
		removeItem: (key: string) => void storage.delete(key)
	});
	vi.mocked(requestPasskey).mockReset();
	vi.mocked(signalPasskeyLabel).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function connected(): Promise<{ client: ChatClient; socket: FakeSocket }> {
	const client = new ChatClient('ws://fake.test/');
	client.start();
	const socket = FakeSocket.latest();
	await socket.greet([], { auth: ['webauthn', 'guest'] });
	return { client, socket };
}

function authRequests(socket: FakeSocket): Array<Record<string, unknown>> {
	return socket.sent.filter((frame) => frame.method === 'auth').map((frame) => frame.params as Record<string, unknown>);
}

/** Answers a begin, lets the (mocked) browser respond, then answers the finish. */
async function ceremony(socket: FakeSocket, you: Record<string, unknown>, timeout?: number): Promise<void> {
	await settle();
	await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x', ...(timeout ? { timeout } : {}) } });
	await socket.reply('auth', { you });
}

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
	return { promise, resolve, reject };
};

describe('passkey ceremonies carry a chosen handle', () => {
	it('applies a handle a guest could not set once registration signs them in', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);

		const pending = client.usePasskey('register', ' shazow ');
		await settle();
		expect(socket.request('auth').params).toEqual(expect.objectContaining({ action: 'register', step: 'begin' }));
		await ceremony(socket, { user_id: 'u_1', name: 'Guest' });
		const named = await pending;
		expect(named).toBeDefined();
		expect(socket.request('me').params).toEqual({ name: 'shazow' });
		await socket.reply('me', { you: { user_id: 'u_1', name: 'shazow' } });
		await expect(named!.promise).resolves.toEqual({ you: { user_id: 'u_1', name: 'shazow' } });
		client.stop();
	});

	it('keeps the old handle when the ceremony is cancelled', async () => {
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
		const { client, socket } = await connected();
		const pending = client.usePasskey('register', 'shazow');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await expect(pending).rejects.toThrow('cancelled');
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);

		// A later sign-in without a chosen handle does not pick up the cancelled one.
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await ceremony(socket, { user_id: 'u_2', name: 'Existing' });
		await expect(login).resolves.toBeUndefined();
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);
		client.stop();
	});
});

describe('passkey ceremonies and requests in flight', () => {
	const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	it('waits for requests sent as the old identity before starting', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		client.setDisplayName('Renamed');
		const pending = client.usePasskey('login');
		await pause(120);
		expect(authRequests(socket).some((params) => params.scheme === 'webauthn')).toBe(false);
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Renamed' } });
		await pause(120);
		expect(socket.request('auth').params).toEqual(expect.objectContaining({ action: 'login', step: 'begin' }));
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await expect(pending).resolves.toBeDefined();
		client.stop();
	});
});

describe('one explicit ceremony per tap', () => {
	it('asks the server to name a new passkey after the requested display name', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		const pending = client.usePasskey('register', ' shazow ');
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'register', step: 'begin', name: 'shazow' });
		await ceremony(socket, { user_id: 'u_1', name: 'shazow' });
		await pending;
		// The browser labels the passkey with it too, whatever the server put in the options.
		expect(vi.mocked(requestPasskey).mock.calls[0]?.[3]).toBe('shazow');
		client.stop();
	});

	it('sends no name with a login, which signs in to an account that has one', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		const pending = client.usePasskey('login', 'shazow');
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'login', step: 'begin' });
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await pending;
		client.stop();
	});

	it('is busy from the tap on, before the server is asked for a challenge', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		client.setDisplayName('Renamed');
		const pending = client.usePasskey('login');
		expect(client.snapshot().authBusy).toBe(true);
		expect(client.snapshot().passkeyBusy).toBe(true);
		await expect(client.usePasskey('register')).rejects.toThrow('Already signing in');
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Renamed' } });
		await new Promise((resolve) => setTimeout(resolve, 120));
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await pending;
		expect(client.snapshot().authBusy).toBe(false);
		expect(authRequests(socket).filter((params) => params.step === 'begin')).toHaveLength(1);
		client.stop();
	});

	it('relabels a saved passkey with the account’s name after a login', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential', response: { userHandle: 'dXNlci0x' } });
		const { client, socket } = await connected();
		const pending = client.usePasskey('login');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x', rpId: 'demo.example' } });
		await socket.reply('auth', { you: { user_id: 'u_1', name: 'Ada' } });
		await pending;
		expect(signalPasskeyLabel).toHaveBeenCalledWith('demo.example', 'dXNlci0x', 'Ada');
		client.stop();
	});

	it('relabels with the display name chosen for the login once the server has it', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential', response: { userHandle: 'dXNlci0x' } });
		const { client, socket } = await connected();
		const pending = client.usePasskey('login', 'Ada Lovelace');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x', rpId: 'demo.example' } });
		await socket.reply('auth', { you: { user_id: 'u_1', name: 'Ada' } });
		const named = await pending;
		expect(signalPasskeyLabel).not.toHaveBeenCalled();
		await socket.reply('me', { you: { user_id: 'u_1', name: 'Ada Lovelace' } });
		await named!.promise;
		await settle();
		expect(signalPasskeyLabel).toHaveBeenCalledWith('demo.example', 'dXNlci0x', 'Ada Lovelace');
		client.stop();
	});
});

describe('a failed session resume never prompts on its own', () => {
	const key = 'apron.session:ws://fake.test/';
	const server = { method: 'server', params: { apron: 7, auth: ['webauthn', 'token', 'guest'], capabilities: [] } };

	async function resuming(): Promise<{ client: ChatClient; socket: FakeSocket; auth: { id: string } }> {
		vi.useFakeTimers();
		storage.set(key, 'session-1');
		const client = new ChatClient('ws://fake.test/');
		client.start();
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive(server);
		const auth = socket.request('auth');
		expect(auth.params).toEqual(expect.objectContaining({ scheme: 'token', token: 'session-1' }));
		return { client, socket, auth };
	}

	it('keeps the token through retry_after and resumes after the window', async () => {
		const { client, socket, auth } = await resuming();
		socket.receive({ id: auth.id, error: { code: -32002, message: 'Demo capacity reached', data: { retry_after: 60 } } });
		await settle();
		expect(storage.get(key)).toBe('session-1');
		expect(socket.readyState).toBe(FakeSocket.CLOSED);
		socket.drop();
		await vi.advanceTimersByTimeAsync(59_000);
		expect(FakeSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1_000);
		const next = FakeSocket.latest();
		expect(next).not.toBe(socket);
		next.open();
		next.receive(server);
		expect(next.request('auth').params).toEqual(expect.objectContaining({ scheme: 'token', token: 'session-1' }));
		expect(requestPasskey).not.toHaveBeenCalled();
		client.stop();
	});

	it('waits for Sign in after the server denies the token', async () => {
		const { client, socket, auth } = await resuming();
		let snapshot = client.snapshot();
		client.subscribe((next) => (snapshot = next));
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Session expired; sign in with your passkey' } });
		await settle();
		expect(storage.has(key)).toBe(false);
		socket.drop();
		expect(snapshot.held).toBe(true);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(requestPasskey).not.toHaveBeenCalled();

		expect(snapshot.signInNeeded).toBe('webauthn');

		// The tap on Sign in reconnects; the passkey waits for the sign-in screen's tap.
		client.retryNow();
		const next = FakeSocket.latest();
		next.open();
		next.receive(server);
		await settle();
		expect(authRequests(next)).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(requestPasskey).not.toHaveBeenCalled();

		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await settle();
		expect(next.request('auth').params).toEqual(expect.objectContaining({ scheme: 'webauthn', action: 'login', step: 'begin' }));
		await next.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await next.reply('auth', { you: { user_id: 'u_1', name: 'Ada' } });
		await login;
		expect(requestPasskey).toHaveBeenCalledTimes(1);
		expect(snapshot.held).toBeUndefined();
		expect(snapshot.signInNeeded).toBeUndefined();
		expect(snapshot.authenticated).toBe(true);
		client.stop();
	});

	it('stays held, without prompting again, when that sign-in is dismissed', async () => {
		const { client, socket, auth } = await resuming();
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Session expired; sign in with your passkey' } });
		await settle();
		socket.drop();
		client.retryNow();
		const next = FakeSocket.latest();
		next.open();
		next.receive(server);
		await settle();
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('Dismissed', 'NotAllowedError'));
		const login = client.usePasskey('login');
		await settle();
		await next.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await expect(login).rejects.toThrow('Dismissed');
		expect(client.snapshot().signInNeeded).toBe('webauthn');
		// The server closes the unauthenticated socket; nothing reconnects or prompts until the next tap.
		next.drop();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(requestPasskey).toHaveBeenCalledTimes(1);
		client.stop();
	});
});
