import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { REQUEST_TIMEOUT_MS } from './client-internals';
import { EMAIL_PROPOSAL_MS } from './email-connection';
import { FakeSocket, settle } from './fake-socket';
import { requestPasskey } from './webauthn';

vi.mock('./webauthn', () => ({ requestPasskey: vi.fn(), signalPasskeyLabel: vi.fn() }));

/**
 * How a session's ways back in (§3.2, §4.9, §4.10) survive adds, reconnects,
 * and sign-in codes asked for while signed in.
 */
describe('accounts and their ways back in', () => {
	const storage = new Map<string, string>();
	const TOKEN_KEY = 'apron.session:ws://fake.test/';
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	const latest = () => FakeSocket.latest();
	const frames = (socket: FakeSocket) => socket.sent.map((frame) => {
		const params = (frame.params ?? {}) as { scheme?: string; action?: string; step?: string };
		return [frame.method, params.scheme, params.action ?? params.step].filter((part) => part !== undefined).join(' ');
	});

	function start(): void {
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
	}

	/** The next connection, greeted by a server with these schemes. */
	async function reconnect(auth: string[], extra: Record<string, unknown> = {}): Promise<FakeSocket> {
		latest().drop();
		await vi.advanceTimersByTimeAsync(10_000);
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'], ...extra } });
		await vi.advanceTimersByTimeAsync(0);
		return socket;
	}

	/**
	 * Signs in by email (§4.10): proposes on a connection of its own, greeted
	 * by a server with these schemes, and approves there; the client carries
	 * on with that connection.
	 */
	async function signInByEmail(auth: string[], you: string, extra: Record<string, unknown> = {}): Promise<FakeSocket> {
		const requested = client.requestEmailCode(`${you}@example.com`);
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'], ...extra } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		const signedIn = client.signInWithEmail('1');
		await vi.advanceTimersByTimeAsync(0);
		side.receive({ id: side.request('auth').id, result: { you: { user_id: you } } });
		await signedIn;
		return side;
	}

	/** Registers a passkey on the current connection; the finish result carries no token. */
	async function registerPasskey(socket: FakeSocket, you: string): Promise<void> {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const registered = client.usePasskey('register');
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { you: { user_id: you } });
		await registered;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		storage.clear();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key)
		});
		vi.mocked(requestPasskey).mockReset();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('keeps the token of a session kept before sign-in methods were remembered when it adds an email', async () => {
		storage.set(TOKEN_KEY, 'st_ada');
		start();
		const auth = ['webauthn', 'email', 'token'];
		await latest().greet([], { auth, you: { user_id: 'ada' } });
		expect(snapshot.passkeySession).toBe(true);
		const socket = latest();
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await socket.reply('auth', {});
		await asked;
		const added = client.addEmail('1');
		await vi.advanceTimersByTimeAsync(0);
		socket.receive({ id: socket.request('auth').id, result: {} });
		await added;
		// An add, not a sign-in: the token stays, and the email is another way back in.
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
		// Its method is guessed as a resume guesses it (a kept session means this browser signed in here).
		expect(snapshot.signedInWith).toBe('webauthn');
		expect(snapshot.signInMethods).toEqual(['webauthn', 'email']);
		const next = await reconnect(auth);
		expect(frames(next)[0]).toBe('auth token');
		expect(snapshot.held).toBeUndefined();
	});

	it('keeps the token of a session kept before sign-in methods were remembered when it adds a passkey', async () => {
		storage.set(TOKEN_KEY, 'st_ada');
		start();
		const auth = ['webauthn', 'token', 'guest'];
		await latest().greet([], { auth, you: { user_id: 'ada' } });
		await latest().reply('room_list', { joined: [] }).catch(() => undefined);
		await registerPasskey(latest(), 'ada');
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
		expect(snapshot.signInMethods).toContain('webauthn');
		// After a reload it resumes, rather than becoming a guest.
		client.stop();
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		expect(frames(latest())[0]).toBe('auth token');
	});

	it('offers the passkey login on reconnect to an email session that added a passkey', async () => {
		const auth = ['email', 'webauthn'];
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		const socket = await signInByEmail(auth, 'ada');
		await socket.reply('room_list', { joined: [] });
		expect(snapshot.signedInWith).toBe('email');
		await registerPasskey(socket, 'ada');
		expect(snapshot.signedInWith).toBe('email');
		expect(snapshot.signInMethods).toEqual(['email', 'webauthn']);
		const prompts = vi.mocked(requestPasskey).mock.calls.length;
		const next = await reconnect(auth);
		// No token to resume with: the passkey it added is the way back, not "signed out" by email.
		// Its prompt waits for a tap on the sign-in screen.
		expect(frames(next)).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(vi.mocked(requestPasskey).mock.calls).toHaveLength(prompts);
	});

	it('doesn’t send someone who joined by email back to email where email only signs up', async () => {
		const auth = ['webauthn'];
		const extra = { signup: ['email'] };
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'], ...extra } });
		expect(snapshot.error).toBe('Sign in with a passkey, or join with your email, from the connect screen.');
		await signInByEmail(auth, 'newbie', extra);
		const next = await reconnect(auth, extra);
		expect(frames(next)).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(snapshot.error).toMatch(/doesn’t sign back in with email/);
	});

	it('never signs in as a guest listed only in signup', async () => {
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth: ['email'], signup: ['guest'], capabilities: ['rooms'] } });
		expect(frames(latest())).toEqual([]);
		expect(snapshot.error).toMatch(/email/);
	});

	it('asks for a code on its own connection while a passkey session is up, without a passkey prompt or reconnect', async () => {
		const auth = ['webauthn', 'email'];
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		const main = latest();
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { you: { user_id: 'ada' } });
		await login;
		await main.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		client.selectRoom('general');
		vi.mocked(requestPasskey).mockClear();
		const requested = client.requestEmailCode('bob@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		side.receive({ id: side.request('auth').id, result: {} });
		await requested;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(frames(side)).toEqual(['auth email']);
		expect(requestPasskey).not.toHaveBeenCalled();
		// The signed-in view stays: same connection, same identity, same room.
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.activeRoom).toBe('general');
	});

	it('asks a server that isn’t this client’s own, and says when it doesn’t offer email', async () => {
		start();
		await latest().greet([], { auth: ['guest'] });
		const requested = client.requestEmailCode('ada@example.com', 'ws://other.test/');
		const side = latest();
		expect(side.url).toBe('ws://other.test/');
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: [] } });
		await expect(requested).rejects.toThrow('does not support email');
		expect(side.sent).toEqual([]);
		expect(side.readyState).toBe(FakeSocket.CLOSED);
	});

	it('gives up on a code request that isn’t answered, and on stop', async () => {
		start();
		await latest().greet([], { auth: ['email', 'guest'] });
		const unanswered = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		const failed = expect(unanswered).rejects.toThrow('didn’t answer');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
		expect(side.readyState).toBe(FakeSocket.CLOSED);

		const stopped = client.requestEmailCode('ada@example.com');
		const link = client.signInWithEmailLink('Hk41x9');
		client.stop();
		await expect(stopped).rejects.toThrow('stopped');
		await expect(link).rejects.toThrow('stopped');
		await settle();
		expect(snapshot.authBusy).toBe(false);
		expect(FakeSocket.instances.slice(-2).map((socket) => socket.readyState)).toEqual([FakeSocket.CLOSED, FakeSocket.CLOSED]);
	});

	/** Opens a sign-in proposal on a connection of its own, answered; returns that connection. */
	async function proposeSignIn(auth: string[]): Promise<FakeSocket> {
		const requested = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		return side;
	}

	/** A passkey login on the main connection, as `ada`. */
	async function passkeyLogin(main: FakeSocket): Promise<void> {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { you: { user_id: 'ada' } });
		await login;
	}

	it('opens no link connection it can’t use, and closes one it can’t use by the time it is ready', async () => {
		const auth = ['email', 'guest'];
		start();
		await latest().greet([], { auth });
		const side = await proposeSignIn(auth);
		const inFlight = client.signInWithEmail('1');
		await vi.advanceTimersByTimeAsync(0);
		const sockets = FakeSocket.instances.length;
		await expect(client.signInWithEmailLink('Hk41x9')).rejects.toThrow('Already signing in');
		expect(FakeSocket.instances).toHaveLength(sockets);
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(inFlight).rejects.toThrow('Invalid or expired code');

		// The link's connection opens first, and an approval starts while it waits for its server frame.
		const link = client.signInWithEmailLink('Hk41x9');
		const linkSocket = latest();
		const again = client.signInWithEmail('2');
		await vi.advanceTimersByTimeAsync(0);
		linkSocket.open();
		linkSocket.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		await expect(link).rejects.toThrow('Already signing in');
		expect(linkSocket.sent).toEqual([]);
		expect(linkSocket.readyState).toBe(FakeSocket.CLOSED);
		// The proposal itself stays for its code.
		expect(side.readyState).toBe(FakeSocket.OPEN);
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(again).rejects.toThrow('Invalid or expired code');
		expect(snapshot.emailCode).toBeDefined();
	});

	it('gives up a sign-in code once the main connection signs in another way', async () => {
		const auth = ['webauthn', 'email', 'token', 'guest'];
		start();
		await latest().greet([], { auth });
		const main = latest();
		// A passkey.
		let side = await proposeSignIn(auth);
		await passkeyLogin(main);
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.emailCode).toBeUndefined();
		// A pasted token.
		side = await proposeSignIn(auth);
		client.useToken('st_pasted');
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.emailCode).toBeUndefined();
		await vi.advanceTimersByTimeAsync(0);
		await latest().greet([], { auth, you: { user_id: 'bot' } });
		// An emailed link.
		side = await proposeSignIn(auth);
		const link = client.signInWithEmailLink('Hk41x9');
		const linkSocket = latest();
		linkSocket.open();
		linkSocket.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		linkSocket.receive({ id: linkSocket.request('auth').id, result: { you: { user_id: 'linky' }, token: 'st_link' } });
		await link;
		expect(snapshot.you?.user_id).toBe('linky');
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.emailCode).toBeUndefined();
	});

	it('drops an address proposed for one account once the connection signs in as another', async () => {
		const auth = ['webauthn', 'email', 'guest'];
		start();
		await latest().greet([], { auth });
		const main = latest();
		expect(snapshot.you?.user_id).toBe('guest_1');
		const asked = client.requestEmailCodeToAdd('guest@example.com');
		await main.reply('auth', {});
		await asked;
		// The guest's connection logs in with a passkey: the proposal was the guest's, not Ada's.
		await passkeyLogin(main);
		expect(snapshot.you?.user_id).toBe('ada');
		// Another identity lists its own rooms.
		await main.reply('room_list', { joined: [] });
		const approvals = () => main.sent.filter((frame) => frame.method === 'auth' && (frame.params as { token?: string }).token !== undefined);
		await expect(client.addEmail('418092')).rejects.toThrow('Send a new code');
		expect(approvals()).toEqual([]);
		expect(snapshot.signInMethods ?? []).not.toContain('email');
		// Proposed again as Ada, it adds to Ada.
		const again = client.requestEmailCodeToAdd('ada@example.com');
		await main.reply('auth', {});
		await again;
		const added = client.addEmail('418092');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', {});
		await added;
		expect(approvals()).toHaveLength(1);
		expect(snapshot.signInMethods).toContain('email');
	});

	it('closes a proposal left open past its expiry, and gives up on an approval that isn’t answered', async () => {
		start();
		await latest().greet([], { auth: ['email', 'guest'] });
		const requested = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth: ['email', 'guest'], capabilities: [], ping: 30 } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		// While it waits for the code it keeps the server's liveness rule (§1).
		await vi.advanceTimersByTimeAsync(30_000);
		expect(side.sent.filter((frame) => frame.method === 'ping')).toHaveLength(1);
		const signIn = client.signInWithEmail('1');
		const failed = expect(signIn).rejects.toThrow('didn’t answer');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
		expect(snapshot.authBusy).toBe(false);
		// No answer ends the proposal: a timeout isn't a wrong code.
		expect(snapshot.emailCode).toBeUndefined();
		expect(side.readyState).toBe(FakeSocket.CLOSED);

		const again = client.requestEmailCode('ada@example.com');
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 7, auth: ['email', 'guest'], capabilities: [] } });
		await vi.advanceTimersByTimeAsync(0);
		await next.reply('auth', {});
		await again;
		await vi.advanceTimersByTimeAsync(EMAIL_PROPOSAL_MS);
		expect(next.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.emailCode).toBeUndefined();
	});
});
