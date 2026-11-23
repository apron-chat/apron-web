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

/**
 * An account the mock keeps, by its session token: a member, or a waiting account (one made by signing up in `lobby`
 * mode, which sees only the lobby until welcomed). `general`: it has joined General.
 */
type Account = { you: User; waiting: boolean; general: boolean; token: string };

/** One page's connection to the mock: who it signed in as, if anyone. */
type Connection = { ws: WebSocketRoute; base: Record<string, unknown>; you?: User; account?: Account; welcomed: boolean; signUpName?: string };

/** What the lobby says to newcomers: the server's instructions are its description, as no protocol key carries them. */
export const LOBBY_DESCRIPTION = 'Welcome! Introduce yourself here, and an admin or moderator will welcome you in. Add a passkey to keep your place.';
const LOBBY_ROOM = { room_id: 'lobby', title: 'Public Lobby', log_id: '1', description: LOBBY_DESCRIPTION };
const GENERAL_ROOM = { room_id: 'general', title: 'General', log_id: '2' };
const PRIVATE_SENDER = { user_id: '~private', name: 'System message to you' };

/**
 * A server in an access mode other than `public` (PLAN §4), for `mockServer`'s `access`, with nothing beyond the core
 * protocol: what a newcomer is told comes from the lobby's description and `~private` notices.
 *
 * - `lobby`: guests, and accounts made with a passkey, see only the Public Lobby until an admin runs `/welcome
 *   <user_id>` (`welcome`). A guest welcomed has the display role `welcomed` until it makes an account on its
 *   connection, which is then a member; a waiting account is let in at once, its connections told with `room_update`
 *   `updated` and General's record, now visible to it. `setOpen(false)` closes the lobby: each guest gets a `denied`
 *   error without `id` (§1.1) and its connection closes, and new connections are offered no guest sign-in.
 *   `opened` counts the connections every page opened.
 * - `private`: no guests. An invite token (`INVITE_TOKEN`) makes a member account.
 *
 * Accounts: `admin-token` signs in as Ada (an admin), `member-token` as Bob. The lobby holds an intro from another
 * guest, Nina (`guest_9`). Every connection on every page it serves shares its state.
 */
export class MockAccess {
	static readonly INVITE_TOKEN = 'apron_join_e2e';
	open: boolean;
	readonly accounts = new Map<string, Account>([
		['admin-token', { you: { user_id: 'ada', name: 'Ada', roles: ['admin'] }, waiting: false, general: true, token: 'admin-token' }],
		['member-token', { you: { user_id: 'bob', name: 'Bob' }, waiting: false, general: true, token: 'member-token' }]
	]);
	readonly connections: Connection[] = [];
	/** How many connections the pages it serves have opened. */
	opened = 0;
	/** Every frame a page sent, with the `user_id` it was signed in as. */
	readonly sent: { from?: string; frame: Record<string, any> }[] = [];
	#guests = 0;
	#logId = 100;
	readonly #lobbyHistory: Record<string, unknown>[] = [
		{ message_id: '10', log_id: '10', room_id: 'lobby', from: { user_id: 'guest_9', name: 'Nina' }, body: { text: 'Hi! I’m Nina, here for the meetup.' } }
	];
	/** Nina's join, logged as a server may log it: under the name she joined with, before she renamed herself. */
	readonly #lobbyMemberships: Record<string, unknown>[] = [
		{ log_id: '9', room_id: 'lobby', members: [{ user: { user_id: 'guest_9', name: 'Guest 9' }, joined: true }] }
	];

	constructor(readonly mode: 'lobby' | 'private', options: { open?: boolean } = {}) {
		this.open = options.open ?? true;
	}

	/** Seeds a waiting account, as one a passkey made in an earlier visit. */
	waiting(userId: string, token: string): void {
		this.accounts.set(token, { you: { user_id: userId, name: userId[0].toUpperCase() + userId.slice(1), roles: ['waiting'] }, waiting: true, general: false, token });
	}

	/** Sees only the lobby: a guest, or a waiting account. */
	#restricted(conn: Connection): boolean {
		return this.mode === 'lobby' && conn.you !== undefined && (conn.account === undefined || conn.account.waiting);
	}

	/** The `server` frame (§3.1): guests only in `lobby` mode while it's open; tokens for invites in either. */
	#frame(base: Record<string, unknown>): Record<string, unknown> {
		const guests = this.mode === 'lobby' && this.open;
		return {
			apron: 10, agent: 'apron-e2e-mock', ping: 60, capabilities: ['history', 'rooms', 'status', 'command', 'ext:command_list'], ...base,
			auth: guests ? ['guest', 'webauthn', 'token'] : ['webauthn', 'token'],
			signup: guests ? ['webauthn', 'token'] : ['token']
		};
	}

	#send(conn: Connection, frame: Record<string, unknown>): void {
		conn.ws.send(JSON.stringify(frame));
	}

	#notice(conn: Connection, room: string, text: string): void {
		this.#send(conn, { method: 'message', params: { room_id: room, from: PRIVATE_SENDER, body: { text } } });
	}

	#lobby(conn: Connection): Record<string, unknown> {
		const restricted = this.connections.filter((other) => other.you && this.#restricted(other)).map((other) => other.you!.user_id);
		const members = [...new Set(['guest_9', ...restricted, ...(conn.you ? [conn.you.user_id] : [])])].map((user_id) => ({ user_id }));
		return { ...LOBBY_ROOM, latest_log_id: String(this.#lobbyHistory.at(-1)?.log_id ?? '1'), history_log_id: '9', members };
	}

	#general(conn: Connection): Record<string, unknown> {
		return { ...GENERAL_ROOM, latest_log_id: '2', history_log_id: null, members: [{ user_id: 'ada' }, { user_id: 'bob' }, ...(conn.account?.general ? [{ user_id: conn.you!.user_id }] : [])] };
	}

	/** The rooms this connection sees: the lobby alone while restricted; General besides, joined or not, once a member. */
	#rooms(conn: Connection): { joined: Record<string, unknown>[]; not_joined: Record<string, unknown>[] } {
		if (this.#restricted(conn)) return { joined: [this.#lobby(conn)], not_joined: [] };
		return conn.account?.general ? { joined: [this.#general(conn), this.#lobby(conn)], not_joined: [] } : { joined: [this.#lobby(conn)], not_joined: [this.#general(conn)] };
	}

	#sees(conn: Connection, roomId: unknown): boolean {
		const rooms = this.#rooms(conn);
		return [...rooms.joined, ...rooms.not_joined].some((room) => room.room_id === roomId);
	}

	#users(conn: Connection): User[] {
		// Nina's current object names no one, as Go's carry no name: her name is her messages'.
		const known: User[] = [{ user_id: 'guest_9', status: 'online' }, { user_id: 'ada', name: 'Ada', roles: ['admin'] }, { user_id: 'bob', name: 'Bob' }];
		for (const other of this.connections) if (other.you && !known.some((user) => user.user_id === other.you!.user_id)) known.push(other.you);
		return known.filter((user) => user.user_id !== conn.you?.user_id).concat(conn.you ? [conn.you] : []);
	}

	/**
	 * The server's `/welcome <user_id>`, as an admin runs it (PLAN §4.4, §4.5, with its new name): a guest's connection is
	 * welcomed, and a waiting account let in on each of its connections. Returns what the admin is told.
	 */
	welcome(userId: string, by = 'Ada'): string {
		const id = userId.replace(/^@/, '');
		const conns = this.connections.filter((conn) => conn.you?.user_id === id);
		if (!conns.length) throw new Error(`no one connected is ${id}`);
		const account = conns[0].account;
		if (account && !account.waiting) return `${id} is already a member.`;
		if (account) {
			account.waiting = false;
			account.you = { ...account.you, roles: [] };
			for (const conn of conns) {
				conn.you = account.you;
				this.#send(conn, { method: 'user', params: { you: { user_id: id, roles: [] } } });
				// The rooms it may see now, which it hasn't joined.
				this.#send(conn, { method: 'room_update', params: { updated: [this.#general(conn)] } });
				this.#notice(conn, 'lobby', `${by} welcomed you in.`);
			}
			return `You welcomed ${id} in.`;
		}
		for (const conn of conns) {
			conn.welcomed = true;
			conn.you = { ...conn.you!, roles: ['welcomed'] };
			this.#send(conn, { method: 'user', params: { you: { user_id: id, roles: ['welcomed'] } } });
			this.#notice(conn, 'lobby', `${by} welcomed you. Add a passkey to finish joining; until you do, closing this page ends your visit.`);
		}
		// Everyone else sees the role.
		for (const other of this.connections) if (other.you && other.you.user_id !== id) this.#send(other, { method: 'user', params: { new: { user_id: id, roles: ['welcomed'] } } });
		return `You welcomed ${id}. They join once they add a passkey.`;
	}

	/** What `ext:command_list` lists for an admin. */
	static readonly ADMIN_COMMANDS = [
		{ name: 'welcome', hint: '[@user]', description: 'Let someone in from the Public Lobby: named, mentioned, or the author of the message replied to.', uses: ['body.mentions', 'reply_to'], group: 'role' },
		{ name: 'lobby open', description: 'Let guests and sign-ups in to the Public Lobby.', group: 'role' },
		{ name: 'lobby close', description: 'Stop letting guests and sign-ups in.', group: 'role' }
	];

	/** The message a guest is denied with as the lobby closes. */
	static readonly CLOSED = 'The Public Lobby is closed. Ask for an invite link.';

	/**
	 * `/toggle lobby` (PLAN §4.7): closing it ends every guest's session, as §1.1 has it: an error without `id`, `denied`,
	 * after which clients don't reconnect by themselves, then the close.
	 */
	setOpen(open: boolean): void {
		this.open = open;
		for (const conn of [...this.connections]) {
			if (!open && conn.you && !conn.account) {
				this.#send(conn, { error: { code: -32001, message: MockAccess.CLOSED } });
				void conn.ws.close({ code: 1008, reason: 'The Public Lobby is closed' });
				continue;
			}
			// Every other connection gets a new `server` frame, a visitor's on the sign-in screen included.
			this.#send(conn, { method: 'server', params: this.#frame(conn.base) });
		}
	}

	serve(ws: WebSocketRoute, options: MockOptions): void {
		const base = { ...options.server };
		const conn: Connection = { ws, base, welcomed: false };
		this.opened++;
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
			const signedIn = (you: User, account?: Account) => {
				conn.you = you;
				conn.account = account;
				conn.welcomed = false;
				reply({ you, ...(account ? { token: account.token } : {}) });
			};
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': {
					if (params.scheme === 'guest') {
						if (this.mode === 'private' || !this.open) return refuse(-32001, 'This server is invite-only; ask for an invite link');
						this.#guests++;
						return signedIn({ user_id: `guest_${this.#guests}`, name: `Guest ${this.#guests}`, status: 'online' });
					}
					if (params.scheme === 'token') {
						if (params.token === MockAccess.INVITE_TOKEN) {
							const account = { you: { user_id: 'iris', name: typeof params.name === 'string' && params.name ? params.name : 'Iris', status: 'online' }, waiting: false, general: true, token: 'iris-token' };
							this.accounts.set(account.token, account);
							return signedIn(account.you, account);
						}
						const account = this.accounts.get(params.token);
						if (!account) return refuse(-32001, 'Unknown token');
						return signedIn({ ...account.you, status: 'online' }, account);
					}
					if (params.scheme === 'webauthn' && params.action === 'register') {
						if (this.mode === 'private' || (!this.open && !conn.you)) return refuse(-32001, 'This server is invite-only; ask for an invite link');
						if (params.step === 'begin') {
							if (typeof params.name === 'string' && params.name) conn.signUpName = params.name;
							const rpId = new URL(ws.url()).hostname;
							return reply({ challenge_id: 'challenge_1', public_key: { challenge: 'AAAA', rp: { id: rpId, name: 'Mock' }, user: { id: 'AAAA', name: params.name ?? 'guest', displayName: params.name ?? 'guest' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } });
						}
						// A welcomed guest's passkey makes a member; any other sign-up, a waiting account. Either is a new user, apart
						// from the guest and its history (shazow/apron#137): everyone else sees the guest leave the lobby and the
						// account join it, with no `old`.
						const member = conn.welcomed;
						const guest = conn.you && !conn.account ? conn.you : undefined;
						const account: Account = member
							? { you: { user_id: 'grace', name: conn.signUpName ?? 'Grace', status: 'online' }, waiting: false, general: true, token: 'grace-token' }
							: { you: { user_id: 'wanda', name: conn.signUpName ?? 'Wanda', roles: ['waiting'], status: 'online' }, waiting: true, general: false, token: 'wanda-token' };
						this.accounts.set(account.token, account);
						signedIn(account.you, account);
						if (guest) {
							const logId = String(++this.#logId);
							const members = [{ user: { user_id: guest.user_id, name: guest.name }, joined: false }, { user: { user_id: account.you.user_id, name: account.you.name }, joined: true }];
							for (const other of this.connections) {
								if (other === conn || !other.you) continue;
								this.#send(other, { method: 'user', params: { new: account.you } });
								this.#send(other, { method: 'room_update', params: { memberships: [{ log_id: logId, room_id: 'lobby', members }] } });
							}
						}
						return;
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
						const joined = rooms.joined.filter((room) => room.room_id === params.room_id);
						const notJoined = rooms.not_joined.filter((room) => room.room_id === params.room_id);
						if (!joined.length && !notJoined.length) return refuse(-32602, 'No such room');
						return reply({ joined, not_joined: notJoined, users: this.#users(conn) });
					}
					return reply(params.filter === 'not_joined' ? { joined: [], not_joined: rooms.not_joined, users: this.#users(conn) } : { joined: rooms.joined, users: this.#users(conn) });
				}
				case 'status': return reply({});
				// The commands this user may use (`ext:command_list`): Ada's `/welcome` and `/lobby`, as both servers list them
				// to admins and moderators; none for anyone else.
				case 'ext:command_list': return reply({ commands: conn.account?.you.user_id === 'ada' ? MockAccess.ADMIN_COMMANDS : [] });
				case 'history': {
					if (!conn.you || !this.#sees(conn, params.room_id)) return refuse(-32602, 'No such room');
					const lobby = params.room_id === 'lobby';
					const messages = lobby ? this.#lobbyHistory : [];
					return reply({ messages, ...(lobby ? { memberships: this.#lobbyMemberships } : {}), more: false, latest_log_id: lobby ? String(messages.at(-1)?.log_id ?? '1') : '2', history_log_id: lobby ? '9' : null });
				}
				case 'message': {
					if (!conn.you || !this.#sees(conn, params.room_id)) return refuse(-32602, 'No such room');
					const id = String(++this.#logId);
					const message = { message_id: id, log_id: id, room_id: params.room_id, from: { user_id: conn.you.user_id, name: conn.you.name }, body: params.body };
					if (params.room_id === 'lobby') this.#lobbyHistory.push(message);
					reply({ message_id: id });
					for (const other of this.connections) if (other.you && this.#rooms(other).joined.some((room) => room.room_id === params.room_id)) this.#send(other, { method: 'message', params: message });
					return;
				}
				case 'command': {
					const text = String(params.body?.text ?? '');
					const welcome = /^\/welcome(?:\s+(\S+))?\s*$/.exec(text);
					if (welcome && conn.account?.you.user_id === 'ada') {
						// Its target, as the servers find it: a typed user_id (with or without `@`), else the one mention,
						// else the author of the message replied to.
						const mentions: unknown[] = Array.isArray(params.body?.mentions) ? params.body.mentions : [];
						const replied = this.#lobbyHistory.find((message) => message.message_id === params.reply_to?.message_id);
						const target = welcome[1] ?? (mentions.length === 1 ? String(mentions[0]) : (replied?.from as User | undefined)?.user_id);
						if (!target) return refuse(-32602, 'Welcome whom? Name them, or reply to their message');
						let said: string;
						try {
							said = this.welcome(target);
						} catch {
							return refuse(-32602, 'No such user');
						}
						this.#notice(conn, params.room_id ?? 'lobby', said);
						return reply({});
					}
					return refuse(-32001, 'Not allowed');
				}
				default:
					if (frame.id !== undefined) refuse(-32601, `Not in the mock: ${frame.method}`);
			}
		});
		ws.send(JSON.stringify({ method: 'server', params: this.#frame(base) }));
	}
}
