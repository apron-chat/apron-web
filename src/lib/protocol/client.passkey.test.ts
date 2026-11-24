import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from './client';
import { PASSKEY_IDLE_POLL_MS } from './client-internals';
import { connect, FakeSocket, settle, startClient } from '$lib/test/client';
import { requestPasskey, signalPasskeyLabel } from './webauthn';
import { ForeignRpIdError, PasskeyPageNeeded, PasskeyPageOffered } from './passkey-route';

vi.mock('./webauthn', () => ({
	requestPasskey: vi.fn(),
	signalPasskeyLabel: vi.fn()
}));

/**
 * Passkeys (§4.10): one explicit ceremony per tap, which waits for requests
 * sent as the old identity, carries a chosen handle, relabels the saved
 * passkey, and never starts on its own after a failed resume.
 */
const storage = new Map<string, string>();

beforeEach(() => {
	vi.useFakeTimers();
	storage.clear();
	vi.mocked(requestPasskey).mockReset();
	vi.mocked(signalPasskeyLabel).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** A guest on a server that offers passkeys. */
async function connected(): Promise<{ client: ChatClient; socket: FakeSocket }> {
	return connect([], { auth: ['webauthn', 'guest'], storage });
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

describe('passkey ceremonies carry a chosen handle', () => {
	it('applies a handle a guest could not set once registration signs them in', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);

		const pending = client.usePasskey('register', ' shazow ');
		await settle();
		// Named at `begin`, so the server can pick the new account's user_id from it.
		expect(socket.request('auth').params).toEqual(expect.objectContaining({ action: 'register', step: 'begin', name: 'shazow' }));
		await ceremony(socket, { user_id: 'u_1', name: 'Guest' });
		const named = await pending;
		expect(named).toBeDefined();
		expect(socket.request('me').params).toEqual({ name: 'shazow' });
		await socket.reply('me', { you: { user_id: 'u_1', name: 'shazow' } });
		await expect(named!.promise).resolves.toEqual({ you: { user_id: 'u_1', name: 'shazow' } });
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
	});
});

describe('passkey ceremonies and requests in flight', () => {
	it('waits for requests sent as the old identity before starting', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		client.setDisplayName('Renamed');
		const pending = client.usePasskey('login');
		// It looks again every PASSKEY_IDLE_POLL_MS while the rename is unanswered.
		await vi.advanceTimersByTimeAsync(PASSKEY_IDLE_POLL_MS * 3);
		expect(authRequests(socket).some((params) => params.scheme === 'webauthn')).toBe(false);
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Renamed' } });
		await vi.advanceTimersByTimeAsync(PASSKEY_IDLE_POLL_MS);
		expect(socket.request('auth').params).toEqual(expect.objectContaining({ action: 'login', step: 'begin' }));
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await expect(pending).resolves.toBeDefined();
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
		expect(vi.mocked(requestPasskey).mock.calls[0]?.[4]).toBe('shazow');
	});

	it('sends no name with a login, which signs in to an account that has one', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		const pending = client.usePasskey('login', 'shazow');
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'login', step: 'begin' });
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await pending;
	});

	it('records a guest who joins after a passkey account signs out as a token’s session', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket, snap, latest } = await connect([], { auth: ['webauthn', 'guest', 'token'], storage });
		const pending = client.usePasskey('login', undefined);
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await pending;
		expect(snap().signedInWith).toBe('webauthn');
		await socket.reply('room_list', { joined: [] });
		await client.signOut();
		await vi.advanceTimersByTimeAsync(1_000);
		await latest().greet([], { auth: ['webauthn', 'guest', 'token'], token: 'st_guest' });
		// Only the guest token gets back in: worth adding another way, not a passkey's session.
		expect(snap().signedInWith).toBe('token');
		expect(storage.get('apron.signin:ws://fake.test/')).toBe('token');
	});

	it('rejects with a refusal’s wait without holding back the next connection', async () => {
		const { client, socket, snap } = await connect([], { auth: ['webauthn', 'guest'], storage });
		const pending = client.usePasskey('login');
		await settle();
		socket.receive({ id: socket.request('auth').id, error: { code: -32002, message: 'Slow down', data: { retry_after: 600 } } });
		await expect(pending).rejects.toThrow('Slow down. Try again in 10m.');
		// The wait is the ceremony's: the connection, signed in as before, owes the server none.
		socket.drop();
		expect(snap().retryAfterMs).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('is busy from the tap on, before the server is asked for a challenge', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const { client, socket } = await connected();
		client.setDisplayName('Renamed');
		const pending = client.usePasskey('login');
		expect(client.snapshot().authBusy).toBe(true);
		// No sheet is up yet: nothing to confirm on the device.
		expect(client.snapshot().passkeyBusy).toBeUndefined();
		await expect(client.usePasskey('register')).rejects.toThrow('Already signing in');
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Renamed' } });
		await vi.advanceTimersByTimeAsync(PASSKEY_IDLE_POLL_MS);
		await ceremony(socket, { user_id: 'u_1', name: 'Existing' });
		await pending;
		expect(client.snapshot().authBusy).toBe(false);
		expect(authRequests(socket).filter((params) => params.step === 'begin')).toHaveLength(1);
	});

	it('stops at once when cancelled while it waits for its turn', async () => {
		const { client, socket } = await connected();
		client.setDisplayName('Renamed');
		const pending = client.usePasskey('login');
		client.cancelPasskeyPrompt();
		const cancelled = expect(pending).rejects.toThrow('Cancelled');
		// At its next look, with the rename still unanswered.
		await vi.advanceTimersByTimeAsync(PASSKEY_IDLE_POLL_MS);
		await cancelled;
		expect(client.snapshot().authBusy).toBe(false);
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Renamed' } });
		expect(authRequests(socket).some((params) => params.scheme === 'webauthn')).toBe(false);
		expect(requestPasskey).not.toHaveBeenCalled();
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
	});
});

describe('console diagnostics', () => {
	it('warns with the stage and the server’s refusal when a passkey sign-up fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential', rawId: 'credential', type: 'public-key', response: {} });
		const { client, socket } = await connected();
		const pending = client.usePasskey('register', 'ericd');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x', rp: { id: 'apron.chat' } } });
		await settle();
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Passkey verification failed' } });
		await expect(pending).rejects.toThrow('Passkey verification failed');
		await vi.waitFor(() => expect(warn).toHaveBeenCalled());
		const [line, details] = warn.mock.calls.at(-1) as [string, Record<string, unknown>];
		expect(line).toBe('[apron] passkey register failed during finish: Passkey verification failed');
		expect(details).toMatchObject({
			stage: 'finish',
			error: { message: 'Passkey verification failed', code: -32001 },
			server: 'ws://fake.test/',
			requestedName: 'ericd',
			options: { rp: { id: 'apron.chat' } },
			credential: { rawIdMatchesId: true, type: 'public-key' }
		});
		warn.mockRestore();
	});

	it('only notes a dismissed sheet', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('Dismissed', 'NotAllowedError'));
		const { client, socket } = await connected();
		const pending = client.usePasskey('login');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await expect(pending).rejects.toThrow('Dismissed');
		await vi.waitFor(() => expect(info).toHaveBeenCalledWith('[apron] passkey login failed during browser: Dismissed', expect.objectContaining({ stage: 'browser' })));
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
		info.mockRestore();
	});
});

describe('a failed session resume never prompts on its own', () => {
	const key = 'apron.session:ws://fake.test/';
	const server = { method: 'server', params: { apron: 10, auth: ['webauthn', 'token', 'guest'], capabilities: [] } };

	async function resuming(): Promise<{ client: ChatClient; socket: FakeSocket; auth: { id: string } }> {
		storage.set(key, 'session-1');
		const { client, socket } = startClient({ storage });
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
	});

	it('keeps the refused connection open, so one tap signs in again on it', async () => {
		const { client, socket, auth } = await resuming();
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Session expired; sign in with your passkey' } });
		await settle();
		const snapshot = client.snapshot();
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(snapshot.status).toBe('connected');
		expect(socket.readyState).not.toBe(FakeSocket.CLOSED);
		expect(requestPasskey).not.toHaveBeenCalled();

		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await socket.reply('auth', { you: { user_id: 'u_1', name: 'Ada' }, token: 'session-2' });
		await login;
		expect(FakeSocket.instances).toHaveLength(1);
		expect(client.snapshot().authenticated).toBe(true);
		expect(client.snapshot().held).toBeUndefined();
		expect(storage.get(key)).toBe('session-2');
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
	});
});

/** The server's passkey page (§4.10.1): where this page can't use the RP ID, the ceremony goes there. */
describe('the passkey page', () => {
	const page = { url: 'https://chat.example/passkey?action=login' };
	const redeem = { code: 'Hk41x9', code_verifier: 'dBjftJ', redirect_uri: 'https://web.example/signed-in/', client_id: 'apron-web' };

	/** Begins `action` and answers with `result`; resolves with what `usePasskey` threw. */
	async function begin(client: ChatClient, socket: FakeSocket, action: 'login' | 'register', result: Record<string, unknown>): Promise<unknown> {
		const pending = client.usePasskey(action).then(() => undefined, (cause: unknown) => cause);
		await settle();
		await socket.reply('auth', result);
		return pending;
	}

	it('goes to the page when the browser refuses the RP ID, and only then', async () => {
		const { client, socket } = await connected();
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('The RP ID is not valid for this origin', 'SecurityError'));
		const refused = await begin(client, socket, 'login', { challenge_id: 'c1', public_key: { challenge: 'x', rpId: 'fake.test' }, external: page });
		expect(refused).toBeInstanceOf(PasskeyPageNeeded);
		expect(refused).toMatchObject({ action: 'login', external: page, account: undefined });
		// No finish step: the page's code finishes it.
		expect(authRequests(socket).filter((params) => params.step === 'finish')).toEqual([]);
		expect(client.snapshot().authBusy).toBe(false);

		// The RP ID check failed (§4.10): the page too, never this page's ceremony.
		vi.mocked(requestPasskey).mockRejectedValue(new ForeignRpIdError('not its own'));
		await expect(begin(client, socket, 'login', { challenge_id: 'c2', public_key: { challenge: 'x', rpId: 'other.example' }, external: page })).resolves.toBeInstanceOf(PasskeyPageNeeded);

		// A sign-in that used no passkey (dismissed, or none for the RP ID) is the user's no, and stays one:
		// the page isn't opened, but offered, since it may find a passkey this page can't.
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('Dismissed', 'NotAllowedError'));
		const offered = await begin(client, socket, 'login', { challenge_id: 'c3', public_key: { challenge: 'x' }, external: page });
		expect(offered).toBeInstanceOf(PasskeyPageOffered);
		expect((offered as PasskeyPageOffered).needed).toMatchObject({ action: 'login', external: page });
		expect((offered as PasskeyPageOffered).cause).toMatchObject({ name: 'NotAllowedError' });
		// Without a page, or for a new passkey, it's the browser's error as it was.
		await expect(begin(client, socket, 'login', { challenge_id: 'c4', public_key: { challenge: 'x' } })).resolves.toMatchObject({ name: 'NotAllowedError' });
		await expect(begin(client, socket, 'register', { challenge_id: 'c5', public_key: { challenge: 'x' }, external: page })).resolves.toMatchObject({ name: 'NotAllowedError' });
	});

	it('goes straight to the page when the server sends no public_key, and says where passkeys work without one', async () => {
		const { client, socket } = await connected();
		await expect(begin(client, socket, 'login', { challenge_id: 'c1', external: page })).resolves.toBeInstanceOf(PasskeyPageNeeded);
		expect(requestPasskey).not.toHaveBeenCalled();
		// A page that isn't a secure web address is no page.
		const none = await begin(client, socket, 'login', { challenge_id: 'c2', external: { url: 'javascript:alert(1)' } });
		expect((none as Error).message).toBe('fake.test’s passkeys work only in its own apps and website.');
		vi.mocked(requestPasskey).mockRejectedValue(new DOMException('The RP ID is not valid for this origin', 'SecurityError'));
		const refused = await begin(client, socket, 'register', { challenge_id: 'c3', public_key: { challenge: 'x' } });
		expect((refused as Error).message).toBe('fake.test’s passkeys work only in its own apps and website.');
	});

	it('names the signed-in account a registration on the page adds to', async () => {
		const { client, socket } = await connected();
		const needed = await begin(client, socket, 'register', { challenge_id: 'c1', external: { url: 'https://chat.example/passkey?action=register&request=rq_7' } });
		// A guest is signed in too (§4.10): the passkey is added to the guest's account, whose connection alone takes the code.
		expect(needed).toMatchObject({ action: 'register', account: 'guest_1' });
	});

	it('finishes with the page’s code on this connection, as a ceremony here would', async () => {
		const { client, socket } = await connected();
		const finished = client.finishPasskeyWithCode('login', redeem, { server: 'ws://fake.test/' });
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'login', step: 'finish', ...redeem });
		await socket.reply('auth', { you: { user_id: 'ada', name: 'Ada' }, token: 'st_ada' });
		await finished;
		const snapshot = client.snapshot();
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.signedInWith).toBe('webauthn');
	});

	it('finishes a registration with the name it began with, and only for its server and account', async () => {
		const { client, socket } = await connected();
		const sent = socket.sent.length;
		await expect(client.finishPasskeyWithCode('register', redeem, { server: 'ws://other.test/' })).rejects.toThrow('another server');
		expect(socket.sent).toHaveLength(sent);
		expect(client.snapshot().authBusy).toBe(false);

		// Begun as another account: the code goes anyway, since a server may have made it a new account's
		// (Cloudflare does for a guest), and a refusal names the account it was for.
		const elsewhere = client.finishPasskeyWithCode('register', redeem, { server: 'ws://fake.test/', account: 'ada' });
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'register', step: 'finish', ...redeem });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Invalid code' } });
		await expect(elsewhere).rejects.toThrow('That passkey is for @ada, which this page isn’t signed in as now.');
		expect(client.snapshot().authBusy).toBe(false);

		const finished = client.finishPasskeyWithCode('register', redeem, { server: 'ws://fake.test/', account: 'guest_1', name: 'Ada' });
		await settle();
		expect(socket.request('auth').params).toEqual({ scheme: 'webauthn', action: 'register', step: 'finish', ...redeem });
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'guest_1' } });
		const named = await finished;
		expect(named).toBeDefined();
		expect(socket.request('me').params).toEqual({ name: 'Ada' });
		expect(client.snapshot().passkeySession).toBe(true);
	});
});
