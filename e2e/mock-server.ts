import type { Page, WebSocketRoute } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';

/** Any URL off this machine. */
export const OFFSITE = /^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/;

/**
 * What a test changes about the scripted server: `server` frame fields (§3.1), fields of `you` (§3.3), and a `token`
 * its `auth` answers with, which makes the session an account's rather than a guest's. With a `token`, a guest `auth` after
 * the first (signing out) gets a new guest, without the token or those fields. `sent` collects every frame the page sends.
 */
export type MockOptions = {
	server?: Record<string, unknown>;
	/** What the server at an address says in its `server` frame, over `server`, for a link or a typed address to another server. */
	servers?: Record<string, Record<string, unknown>>;
	/** Every address the page opened a WebSocket to, in order. */
	opened?: string[];
	you?: Record<string, unknown>;
	token?: string;
	/** The account a passkey signs in to (`auth` with `scheme: "webauthn"`, §4.10): its `you`. Without it, the mock has no passkeys. */
	passkey?: Record<string, unknown>;
	/**
	 * Passkeys only on the server's passkey page (§4.10.1): a `webauthn` begin answers with `external`
	 * at this `url` and no `public_key`, and a finish with a `code` signs in as `passkey`.
	 */
	passkeyPage?: string;
	/**
	 * External sign-in (§4.12): a begin answers with `external` at this `url`, and an `external` request with a `code`
	 * signs in as `you`, with `token`. Add `external` to the server's `auth` with `server` too.
	 */
	external?: { url: string; you: Record<string, unknown>; token?: string };
	sent?: Record<string, any>[];
	/** The same, each with the address it went to: the page may be talking to more than one server at once. */
	sentTo?: { url: string; frame: Record<string, any> }[];
	/** General's history, oldest first, each message's `log_id` its `message_id` (§3.5); none by default. */
	history?: Record<string, unknown>[];
	/** Set by `mockServer` once the page connects: sends the page a frame, such as a live `message`. */
	deliver?: (frame: Record<string, unknown>) => void;
	/**
	 * An access mode other than `public` (`MockAccess`): the server answers as one in `lobby` or `private` mode instead,
	 * and every other option but `sent`, `opened` and `server` is ignored. One `MockAccess` can serve several pages, as
	 * one server serves several people.
	 */
	access?: MockAccess;
};

/**
 * A scripted server for the app's own route (`/`), which, unlike `/__preview`, connects to a real backend
 * (`wss://server.apron.chat` by default) and shows the connect screen and sign-in. Every WebSocket the page
 * opens is answered here instead, and every request off this machine is refused, so no test reaches the
 * network. It offers guests, passkeys, email and tokens (a server that lists `email` lists `token`, §4.11), and
 * has one room, `General`, with no history unless `history` gives it some, all in one page. With capability
 * `status` (§4.5), General's other members show their status: Bob online, and Ada offline, last seen two hours
 * before the tests' clock (`seen`, §4.5.2).
 */
export async function mockServer(page: Page, options: MockOptions = {}): Promise<void> {
	await page.route(OFFSITE, (route) => route.abort());
	let auths = 0;
	await page.routeWebSocket(/.*/, (ws) => {
		options.opened?.push(ws.url());
		if (options.access) return options.access.serve(ws, options);
		let you: Record<string, unknown> = { user_id: 'guest_1', name: 'Guest 1', status: 'online', ...options.you };
		// Complete objects, as the listing carries them: the shown status, and `seen` with a shown `offline`.
		const ada = { user_id: 'ada', name: 'Ada', status: 'offline', seen: String(NOW.getTime() - 2 * 60 * 60 * 1000) };
		const bob = { user_id: 'bob', name: 'Bob', status: 'online' };
		const history = options.history ?? [];
		const latest = String(history.at(-1)?.log_id ?? '1');
		const oldest = history.length ? String(history[0].log_id) : null;
		options.deliver = (frame) => ws.send(JSON.stringify(frame));
		const general = { room_id: 'general', title: 'General', log_id: '1', latest_log_id: latest, history_log_id: oldest, members: [{ user_id: you.user_id }, { user_id: ada.user_id }, { user_id: bob.user_id }] };
		ws.onMessage((data) => {
			const frame = JSON.parse(String(data));
			options.sent?.push(frame);
			options.sentTo?.push({ url: ws.url(), frame });
			const reply = (result: unknown) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, result }));
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': {
					if (options.external && frame.params?.scheme === 'external') {
						if (frame.params.code === undefined) return reply({ external: { url: options.external.url } });
						you = { status: 'online', ...options.external.you };
						return reply({ you, ...(options.external.token ? { token: options.external.token } : {}) });
					}
					if (options.passkeyPage && options.passkey && frame.params?.scheme === 'webauthn') {
						if (frame.params.step === 'begin') return reply({ challenge_id: 'challenge_1', external: { url: options.passkeyPage } });
						you = { status: 'online', ...options.passkey };
						return reply({ you });
					}
					if (options.passkey && frame.params?.scheme === 'webauthn') {
						// Nothing is verified: `begin` gives a challenge for this server's host, and `finish` signs in as the account.
						if (frame.params.step === 'begin') return reply({ challenge_id: 'challenge_1', public_key: { challenge: 'AAAA', rpId: new URL(ws.url()).hostname } });
						you = { status: 'online', ...options.passkey };
						return reply({ you });
					}
					if (options.token && frame.params?.scheme === 'guest' && auths++ > 0) {
						you = { user_id: 'guest_2', name: 'Guest 2', status: 'online' };
						return reply({ you });
					}
					return reply({ you, ...(options.token ? { token: options.token } : {}) });
				}
				case 'me': {
					you = { ...you, ...(typeof frame.params?.name === 'string' ? { name: frame.params.name } : {}) };
					return reply({ you });
				}
				case 'room_list': return reply({ joined: [general], users: [you, ada, bob] });
				// Idle reports (§4.5.3): taken, and kept nowhere.
				case 'status': return reply({});
				case 'history': return reply({ messages: frame.params?.room_id === 'general' ? history : [], more: false, latest_log_id: latest, history_log_id: oldest });
				default:
					if (frame.id !== undefined) ws.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: `Not in the mock: ${frame.method}` } }));
			}
		});
		ws.send(JSON.stringify({ method: 'server', params: { apron: 10, agent: 'apron-e2e-mock', auth: ['guest', 'webauthn', 'email', 'token'], signup: ['guest', 'webauthn'], ping: 60, capabilities: ['history', 'rooms', 'status'], ...options.server, ...options.servers?.[ws.url()] } }));
	});
}

/** A user object, as the mock keeps and sends it. */
type User = Record<string, unknown> & { user_id: string; name?: string };

/** An account the mock keeps, by its session token: a member, or a waiting account (limited to the lobby until let in). */
type Account = { you: User; waiting: boolean; token: string };

/** One page's connection to the mock: who it signed in as, if anyone. */
type Connection = { ws: WebSocketRoute; you?: User; account?: Account; invited: boolean; sent?: Record<string, any>[]; frame?: string };

const LOBBY_ROOM = { room_id: 'lobby', title: 'Public Lobby', log_id: '1' };
const GENERAL_ROOM = { room_id: 'general', title: 'General', log_id: '2' };
const PRIVATE_SENDER = { user_id: '~private', name: 'System message to you' };

/**
 * A server in an access mode other than `public` (PLAN §4), for `mockServer`'s `access`:
 *
 * - `lobby`: guests, and accounts made by signing up (a passkey), see only the Public Lobby (`lobby`) until an admin
 *   lets them in with `/invite` (`invite`). A guest let in is `invited` until it makes an account on its connection,
 *   which is then a member; a waiting account is let in at once. `/toggle lobby` (`setOpen`) closes the lobby: guests
 *   are told and closed with 1008, and new connections are offered no guest sign-in.
 * - `private`: no guests. An invite token (`INVITE_TOKEN`) makes a member account.
 *
 * It has two rooms, the lobby and General. Its accounts: `admin-token` signs in as Ada, an admin who may invite, and
 * `member-token` as Bob, a member who may not. The lobby's history holds an intro from another guest, Nina (`guest_9`).
 * Every connection on every page it serves shares its state, so one page's `/invite` reaches another's guest.
 */
export class MockAccess {
	static readonly INVITE_TOKEN = 'apron_join_e2e';
	open: boolean;
	readonly accounts = new Map<string, Account>([
		['admin-token', { you: { user_id: 'ada', name: 'Ada', roles: ['admin'], ext: { permissions: { invite: true } } }, waiting: false, token: 'admin-token' }],
		['member-token', { you: { user_id: 'bob', name: 'Bob' }, waiting: false, token: 'member-token' }]
	]);
	readonly connections: Connection[] = [];
	/** Every frame a page sent, with the `user_id` it was signed in as. */
	readonly sent: { from?: string; frame: Record<string, any> }[] = [];
	#guests = 0;
	#logId = 100;
	readonly #lobbyHistory: Record<string, unknown>[] = [
		{ message_id: '10', log_id: '10', room_id: 'lobby', from: { user_id: 'guest_9', name: 'Nina' }, body: { text: 'Hi! I’m Nina, here for the meetup.' } }
	];

	constructor(readonly mode: 'lobby' | 'private', options: { open?: boolean } = {}) {
		this.open = options.open ?? true;
	}

	/** Limited to the lobby: a guest, or a waiting account. */
	#restricted(conn: Connection): boolean {
		return this.mode === 'lobby' && conn.you !== undefined && (conn.account === undefined || conn.account.waiting);
	}

	/** The `server` frame this connection gets (§3.1), as PLAN §4.7 and §5 have it. */
	#frame(conn: Connection, base: Record<string, unknown>): Record<string, unknown> {
		const frame: Record<string, unknown> = { apron: 10, agent: 'apron-e2e-mock', ping: 60, capabilities: ['history', 'rooms', 'status', 'command', 'ext:settings', 'ext:permissions'], ...base };
		const guests = this.mode === 'lobby' && this.open;
		frame.auth = guests ? ['guest', 'webauthn', 'token'] : ['webauthn', 'token'];
		frame.signup = guests ? ['webauthn', 'token'] : ['token'];
		// The lobby is advertised to signed-in connections, and to others only while it's open.
		if (this.mode === 'lobby' && (conn.you !== undefined || this.open)) frame.ext = { settings: { lobby: { room_id: 'lobby', open: this.open } } };
		return frame;
	}

	/** Sends this connection its `server` frame again, where it changed (on signing in, or the lobby opening or closing). */
	#greet(conn: Connection, base: Record<string, unknown>, always = false): void {
		const frame = JSON.stringify({ method: 'server', params: this.#frame(conn, base) });
		if (!always && frame === conn.frame) return;
		conn.frame = frame;
		conn.ws.send(frame);
	}

	#send(conn: Connection, frame: Record<string, unknown>): void {
		conn.ws.send(JSON.stringify(frame));
	}

	#notice(conn: Connection, room: string, text: string): void {
		this.#send(conn, { method: 'message', params: { room_id: room, from: PRIVATE_SENDER, body: { text } } });
	}

	/** The rooms this connection sees, joined: the lobby alone for someone limited to it; General and the lobby for a member. */
	#rooms(conn: Connection): Record<string, unknown>[] {
		const latest = String(this.#lobbyHistory.at(-1)?.log_id ?? '1');
		const lobbyMembers = [{ user_id: 'guest_9' }, ...this.connections.filter((other) => other.you && this.#restricted(other)).map((other) => ({ user_id: other.you!.user_id }))];
		const lobby = { ...LOBBY_ROOM, latest_log_id: latest, history_log_id: '10', members: conn.you && !lobbyMembers.some((member) => member.user_id === conn.you!.user_id) ? [...lobbyMembers, { user_id: conn.you.user_id }] : lobbyMembers };
		if (this.#restricted(conn)) return [lobby];
		return [{ ...GENERAL_ROOM, latest_log_id: '2', history_log_id: null, members: [{ user_id: 'ada' }, { user_id: 'bob' }, ...(conn.you ? [{ user_id: conn.you.user_id }] : [])] }, lobby];
	}

	#users(conn: Connection): User[] {
		const known: User[] = [{ user_id: 'guest_9', name: 'Nina', status: 'online' }, { user_id: 'ada', name: 'Ada', roles: ['admin'] }, { user_id: 'bob', name: 'Bob' }];
		for (const other of this.connections) if (other.you && !known.some((user) => user.user_id === other.you!.user_id)) known.push(other.you);
		return known.filter((user) => user.user_id !== conn.you?.user_id).concat(conn.you ? [conn.you] : []);
	}

	#signIn(conn: Connection, you: User, account?: Account): void {
		conn.you = you;
		conn.account = account;
		conn.invited = false;
	}

	/** A guest's `you`, limited to the lobby (`ext.permissions.lobby`, PLAN §5). */
	#guest(): User {
		this.#guests++;
		return { user_id: `guest_${this.#guests}`, name: `Guest ${this.#guests}`, status: 'online', ext: { permissions: { lobby: 'waiting' } } };
	}

	/** The account a passkey made on this connection: a member for an invited guest, else a waiting account. */
	#register(conn: Connection, name: string | undefined): Account {
		const member = conn.invited;
		const token = member ? 'grace-token' : 'wanda-token';
		const you: User = member
			? { user_id: 'grace', name: name || 'Grace', status: 'online' }
			: { user_id: 'wanda', name: name || 'Wanda', roles: ['waiting'], status: 'online', ext: { permissions: { lobby: 'waiting' } } };
		const account = { you, waiting: !member, token };
		this.accounts.set(token, account);
		return account;
	}

	/**
	 * The server's `/invite <user_id>`, as an admin runs it (PLAN §4.4, §4.5): a guest's connection becomes invited, and a
	 * waiting account is let in on each of its connections. Returns what the admin is told.
	 */
	invite(userId: string, inviter = 'Ada'): string {
		const id = userId.replace(/^@/, '');
		const conns = this.connections.filter((conn) => conn.you?.user_id === id);
		if (!conns.length) throw new Error(`no one connected is ${id}`);
		const account = conns[0].account;
		if (account && !account.waiting) return `${id} is already a member.`;
		if (account) {
			account.waiting = false;
			account.you = { ...account.you, roles: [], ext: { permissions: {} } };
			for (const conn of conns) {
				conn.you = account.you;
				this.#send(conn, { method: 'user', params: { you: { user_id: id, roles: [], ext: { permissions: {} } } } });
				this.#send(conn, { method: 'room_update', params: { joined: [this.#rooms(conn)[0]] } });
				this.#notice(conn, 'general', `${inviter} invited you in.`);
			}
			return `You let ${id} in.`;
		}
		for (const conn of conns) {
			conn.invited = true;
			conn.you = { ...conn.you!, roles: ['invited'], ext: { permissions: { lobby: 'invited' } } };
			this.#send(conn, { method: 'user', params: { you: { user_id: id, roles: ['invited'], ext: { permissions: { lobby: 'invited' } } } } });
			this.#notice(conn, 'lobby', `${inviter} invited you. Add a passkey to finish joining; until you do, closing this page ends your visit.`);
		}
		return `You invited ${id}. They join once they add a passkey.`;
	}

	/** `/toggle lobby` (PLAN §4.7): closing it ends every guest's session (a notice, then 1008); every other connection is told. */
	setOpen(open: boolean): void {
		this.open = open;
		for (const conn of [...this.connections]) {
			if (!open && conn.you && !conn.account) {
				this.#notice(conn, 'lobby', 'The Public Lobby is closed.');
				void conn.ws.close({ code: 1008, reason: 'The Public Lobby is closed' });
				continue;
			}
			this.#greet(conn, conn.frame ? (JSON.parse(conn.frame).params as Record<string, unknown>) : {});
		}
	}

	serve(ws: WebSocketRoute, options: MockOptions): void {
		const conn: Connection = { ws, invited: false };
		const base = { ...options.server };
		this.connections.push(conn);
		ws.onClose(() => {
			const at = this.connections.indexOf(conn);
			if (at >= 0) this.connections.splice(at, 1);
		});
		ws.onMessage((data) => {
			const frame = JSON.parse(String(data));
			options.sent?.push(frame);
			this.sent.push({ from: conn.you?.user_id, frame });
			const reply = (result: unknown) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, result }));
			const refuse = (code: number, message: string) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, error: { code, message } }));
			const params = frame.params ?? {};
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': {
					const signedIn = (you: User, account?: Account) => {
						this.#signIn(conn, you, account);
						reply({ you, ...(account ? { token: account.token } : {}) });
						this.#greet(conn, base);
					};
					if (params.scheme === 'guest') {
						if (this.mode === 'private' || !this.open) return refuse(-32001, 'This server is invite-only; ask for an invite link');
						return signedIn(this.#guest());
					}
					if (params.scheme === 'token') {
						if (params.token === MockAccess.INVITE_TOKEN) {
							const account = { you: { user_id: 'iris', name: typeof params.name === 'string' && params.name ? params.name : 'Iris', status: 'online' }, waiting: false, token: 'iris-token' };
							this.accounts.set(account.token, account);
							return signedIn(account.you, account);
						}
						const account = this.accounts.get(params.token);
						if (!account) return refuse(-32001, 'Unknown token');
						return signedIn({ ...account.you, status: 'online' }, account);
					}
					if (params.scheme === 'webauthn' && params.action === 'register') {
						if (this.mode === 'private' || (!this.open && !conn.you)) return refuse(-32001, 'This server is invite-only; ask for an invite link');
						const rpId = new URL(ws.url()).hostname;
						if (params.step === 'begin') {
							return reply({ challenge_id: 'challenge_1', public_key: { challenge: 'AAAA', rp: { id: rpId, name: 'Mock' }, user: { id: 'AAAA', name: params.name ?? 'guest', displayName: params.name ?? 'guest' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } });
						}
						const account = this.#register(conn, conn.you?.name as string | undefined);
						return signedIn(account.you, account);
					}
					return refuse(-32602, 'Not in the mock');
				}
				case 'me': {
					if (!conn.you) return refuse(-32001, 'Sign in first');
					conn.you = { ...conn.you, ...(typeof params.name === 'string' ? { name: params.name } : {}) };
					return reply({ you: conn.you });
				}
				case 'room_list': {
					if (!conn.you) return refuse(-32001, 'Sign in first');
					const rooms = this.#rooms(conn);
					if (typeof params.room_id === 'string') {
						const room = rooms.find((candidate) => candidate.room_id === params.room_id);
						if (!room) return refuse(-32602, 'No such room');
						return reply({ joined: [room], not_joined: [], users: this.#users(conn) });
					}
					return reply(params.filter === 'not_joined' ? { joined: [], not_joined: [], users: this.#users(conn) } : { joined: rooms, users: this.#users(conn) });
				}
				case 'status': return reply({});
				case 'history': {
					if (!conn.you || !this.#rooms(conn).some((room) => room.room_id === params.room_id)) return refuse(-32602, 'No such room');
					const messages = params.room_id === 'lobby' ? this.#lobbyHistory : [];
					return reply({ messages, more: false, latest_log_id: params.room_id === 'lobby' ? String(messages.at(-1)?.log_id ?? '1') : '2', history_log_id: params.room_id === 'lobby' ? '10' : null });
				}
				case 'message': {
					if (!conn.you || !this.#rooms(conn).some((room) => room.room_id === params.room_id)) return refuse(-32602, 'No such room');
					const id = String(++this.#logId);
					const message = { message_id: id, log_id: id, room_id: params.room_id, from: { user_id: conn.you.user_id, name: conn.you.name }, body: params.body };
					if (params.room_id === 'lobby') this.#lobbyHistory.push(message);
					reply({ message_id: id });
					for (const other of this.connections) if (other.you && this.#rooms(other).some((room) => room.room_id === params.room_id)) this.#send(other, { method: 'message', params: message });
					return;
				}
				case 'command': {
					const text = String(params.body?.text ?? '');
					const invite = /^\/invite\s+(\S+)\s*$/.exec(text);
					const admin = conn.account?.you.user_id === 'ada';
					if (invite && admin) {
						let said: string;
						try {
							said = this.invite(invite[1]);
						} catch {
							return refuse(-32602, 'No such user');
						}
						this.#notice(conn, params.room_id ?? 'general', said);
						return reply({});
					}
					if (/^\/toggle\s+lobby\s*$/.test(text) && admin) {
						this.setOpen(!this.open);
						this.#notice(conn, params.room_id ?? 'general', this.open ? 'The Public Lobby is open.' : 'The Public Lobby is closed.');
						return reply({});
					}
					return refuse(-32001, 'Not allowed');
				}
				default:
					if (frame.id !== undefined) refuse(-32601, `Not in the mock: ${frame.method}`);
			}
		});
		this.#greet(conn, base, true);
	}
}
