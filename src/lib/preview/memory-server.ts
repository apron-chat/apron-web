import { mergeExt } from '$lib/protocol/client-internals';
import type { WebSocketFactory } from '$lib/protocol/client-types';
import { isJsonObject, type JsonObject, type WireFrame } from '$lib/protocol/types';
import { DAWN, DUSK } from './preview-images';

export type PreviewRoom = {
	room_id: string;
	/** Absent for an untitled room, such as a private conversation, which clients name for its members. */
	title?: string;
	parent_room_id?: string;
	private?: boolean;
	description?: string;
	ext?: JsonObject;
	members: Set<string>;
	messages: JsonObject[];
	reactions: Map<string, Map<string, string[]>>;
	log_id: number;
};

type PreviewSocket = {
	url: string;
	readyState: number;
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	close(): void;
	send(data: string): void;
	deliver(frame: WireFrame): void;
};

type Person = { user_id: string; name: string; avatar?: string; roles?: string[]; status?: string; ext?: JsonObject };

const basePeople: Record<string, Person> = {
	preview_guest: { user_id: 'preview_guest', name: 'You' },
	ada: { user_id: 'ada', name: 'Ada Lovelace', roles: ['admin'] },
	grace: { user_id: 'grace', name: 'Grace Hopper' },
	linus: { user_id: 'linus', name: 'Linus' },
	margaret: { user_id: 'margaret', name: 'Margaret Hamilton', roles: ['moderator'] }
};

const roomId = 'general';

/** What the demo server advertises (§3.1). */
export const PREVIEW_CAPABILITIES = ['history', 'edit', 'rooms', 'reactions', 'activity', 'command', 'ext', 'ext:settings'];

/** Its settings (EXT.md §3): the most private rooms one user may be in at once, so the new-conversation dialog counts. */
export const PREVIEW_SETTINGS = { private_rooms: 5 };

/**
 * Knobs for the browser suite (`e2e/`), read from `window.__APRON_PREVIEW__` when the page's first socket
 * opens (Playwright sets it with `addInitScript`). Without them the preview is the demo, unchanged. With
 * them, the server is also reachable as `window.__apronPreview`, for its `frames` and `post`.
 */
export interface PreviewKnobs {
	/** Capabilities to advertise beyond `PREVIEW_CAPABILITIES`, e.g. `embed:upload` or `status`. */
	capabilities?: string[];
	/**
	 * Plays a server that doesn't keep private rooms (§4.2.4): rooms (`rooms`) or threads (`threads`) created
	 * through `room_set` come back without `private`, whatever was asked.
	 */
	dropPrivate?: 'rooms' | 'threads';
	/** `rich` adds `richPeople` and `richMessages`: long names with four roles, a name clash, avatars, a reply, a mention of you, every embed kind, and a room and a thread to browse. */
	seed?: 'rich';
	/**
	 * Signs the viewer in to an account rather than as a guest: the `auth` result carries a token (§3.2.1), which
	 * makes it a registered session, as starting private conversations needs.
	 */
	account?: boolean;
}

/**
 * The `rich` seed, for layout and contract checks: people whose names and roles push the message header and
 * member list to their limits, and one of each thing the demo seed doesn't show.
 */
const richPeople: Record<string, Person> = {
	wilhelmina: { user_id: 'wilhelmina', name: 'Wilhelmina Featherstonehaugh-Cholmondeley', roles: ['admin', 'moderator', 'release manager', 'on call'] },
	bartholomew: { user_id: 'bartholomew', name: 'Bartholomew Oyelaran-Castellanos de la Vega y Montoya', roles: ['owner', 'moderator', 'reviewer', 'infrastructure'] },
	maximiliana: { user_id: 'maximiliana', name: 'Maximiliana_Konstantinopoulou-Wolfeschlegelsteinhausen', roles: ['admin', 'moderator', 'triage', 'documentation'] },
	ada_b: { user_id: 'ada_b', name: 'Ada Lovelace' },
	rosalind: { user_id: 'rosalind', name: 'Rosalind Franklin', avatar: DAWN.url }
};

const richMessages: { id: string; from: string; text: string; fields?: JsonObject; body?: JsonObject }[] = [
	{ id: '1710000000040', from: 'wilhelmina', text: 'Long names and four roles: the badges stack and the name gives way, but nothing is cut off.' },
	{ id: '1710000000041', from: 'bartholomew', text: 'Replying to the welcome, with an even longer name.', fields: { reply_to: { message_id: '1710000000001' } } },
	{ id: '1710000000042', from: 'maximiliana', text: 'A name with no spaces to break at, and a link with none either: https://example.com/releases/2026/october/apron-web-release-candidate-with-an-unusually-long-file-name.tar.gz' },
	{ id: '1710000000043', from: 'ada_b', text: 'Another Ada Lovelace: the handle tells us apart.' },
	{ id: '1710000000044', from: 'rosalind', text: 'An avatar, and a mention of @preview_guest.', body: { mentions: ['preview_guest'] } },
	{ id: '1710000000045', from: 'linus', text: 'One embed of each kind.', body: { embeds: [
		{ kind: 'iframe', url: 'https://apron-preview.invalid/live', title: 'Live view', height: 160 },
		{ kind: 'html', html: '<p><b>Bold</b> relayed HTML.</p><script>window.__embedRan = true</script>' },
		{ kind: 'stream', title: 'build.log', format: 'terminal', text: '\u001b[32mok\u001b[0m 12 tests passed\n' },
		{ kind: 'upload', url: 'https://apron-preview.invalid/files/notes.txt', title: 'notes.txt', og: { type: 'text/plain' } },
		{ kind: 'poll', url: 'https://apron-preview.invalid/polls/lunch', title: 'Lunch poll' }
	] } }
];

/**
 * Two finished image uploads (§4.8.4), shaped as a server sends them: `og.image` is the file itself. The
 * preview has no file server, so the images are data URLs and `url` (what a Cmd-click opens) goes nowhere.
 */
const photos = [
	{ kind: 'upload', embed_id: 'preview-dusk', url: 'https://apron-preview.invalid/files/dusk-over-the-ridge.jpg', title: 'dusk-over-the-ridge.jpg', og: { image: { url: DUSK.url, type: 'image/jpeg', width: DUSK.width, height: DUSK.height, alt: 'Layered purple hills under an orange dusk sky, the sun low' } } },
	{ kind: 'upload', embed_id: 'preview-dawn', url: 'https://apron-preview.invalid/files/first-light.jpg', title: 'first-light.jpg', og: { image: { url: DAWN.url, type: 'image/jpeg', width: DAWN.width, height: DAWN.height, alt: 'Blue ridges fading into a pale morning sky' } } }
];

const seed: { id: string; from: string; text: string; embeds?: JsonObject[] }[] = [
	{ id: '1710000000001', from: 'ada', text: 'Welcome to Apron! This is the full app running against an in-memory protocol server.' },
	{ id: '1710000000002', from: 'grace', text: 'Try **markdown**, emoji :wave:, and mentioning @ada.' },
	{ id: '1710000000003', from: 'linus', text: 'This message started in #general; it now lives in the Deploy checklist thread.' },
	{ id: '1710000000004', from: 'margaret', text: 'Open a thread, react to a message, or send something below.' },
	{ id: '1710000000008', from: 'ada', text: '# Heading 1\n\n## Heading 2\n\n### Heading 3 · **bold** · *italic* · ~~strikethrough~~\n\n#### Heading 4\n\n##### Heading 5\n\n###### Heading 6' },
	{ id: '1710000000009', from: 'grace', text: 'Inline `code`, [a titled link](https://example.com "Example") and an autolink: <https://example.com>.\nBare URLs work too: https://example.com. Mention @margaret or jump to #thread_deploy.' },
	{ id: '1710000000010', from: 'linus', text: '> Blockquotes support **inline formatting**.\n>\n> And multiple paragraphs.\n\n- Unordered list\n  - Nested item\n  - Another nested item\n- Final item\n\n1. Ordered list\n2. Second item' },
	{ id: '1710000000014', from: 'margaret', text: '```ts\nconst preview = "markdown";\nconsole.log(preview);\n```\n\n    Indented code blocks work too.\n\n---\n\nA hard line break  \nkeeps both lines in one paragraph.' },
	{ id: '1710000000015', from: 'ada', text: '| Feature | Example |\n| :-- | --: |\n| Strong | **bold** |\n| Inline code | `const x = 1` |\n| Room link | #engineering |\n\nRaw HTML is shown as text: <b>not bold</b>.' },
	{ id: '1710000000016', from: 'grace', text: 'Two from the ridge last week. Click one to see it full screen; ← and → page between them.', embeds: photos },
];

/** A write's `ext` merged into what is kept (§4.12); a write that leaves it out keeps it. */
function mergedExt(kept: JsonObject | undefined, write: unknown): JsonObject | undefined {
	return isJsonObject(write) ? mergeExt(kept, write) : kept;
}

/** A single, page-lifetime demo server. It owns no network connection or persistent storage. */
export class MemoryProtocolServer {
	private sockets = new Set<PreviewSocket>();
	private rooms = new Map<string, PreviewRoom>();
	private serial = 1710000000100;
	private roomSerial = 1;
	private people: Record<string, Person> = structuredClone(basePeople);
	private knobs: PreviewKnobs;
	/**
	 * With capability `status`, everyone else's shown status (§4.5.1), with `seen` (§4.5.2): when it last became
	 * `offline`. Kept apart from `people`, so no recorded object (a `from`) carries either.
	 */
	private presence = new Map<string, { status: string; seen?: string }>();
	/** When your shown status last became `offline` (a chosen `invisible`), for listings that describe you to others. */
	private yourSeen?: string;
	/** Every frame a client sent, parsed, in the order it arrived: what the browser suite asserts the wire by. */
	readonly frames: WireFrame[] = [];

	constructor(knobs: PreviewKnobs = {}) {
		this.knobs = knobs;
		const people = this.people;
		const general = this.makeRoom(roomId, 'general', ['preview_guest', 'ada', 'grace', 'linus', 'margaret']);
		general.description = 'Say hello. Everything here lives only as long as this page.';
		for (const item of seed) {
			const message = {
				message_id: item.id, log_id: item.id, room_id: roomId,
				from: { ...people[item.from] }, body: { text: item.text, format: 'markdown', ...(item.embeds ? { embeds: item.embeds } : {}) }
			};
			general.messages.push(message);
			general.log_id = Number(item.id);
		}
		const engineering = this.makeRoom('engineering', 'engineering', ['preview_guest', 'ada', 'linus']);
		const thread = this.makeRoom('thread_deploy', 'Deploy checklist', ['preview_guest', 'ada', 'grace'], 'general');
		thread.description = 'What to check before a **deploy**: migrations, flags, and who is on call.';
		for (const [n, author, text] of [
			['1710000000005', 'ada', 'Thread replies are ordinary messages in a child room.'],
			['1710000000006', 'grace', 'The protocol server is shared by all preview app interactions.']
		] as const) {
			thread.messages.push({ message_id: n, log_id: n, room_id: thread.room_id, from: { ...people[author] }, body: { text, format: 'plain' } });
			thread.log_id = Number(n);
		}
		// The same message ID has a newer snapshot in this room: history replay re-homes it here.
		thread.messages.push({
			message_id: seed[2].id, log_id: '1710000000016', room_id: thread.room_id,
			from: { ...people.linus }, body: { text: seed[2].text, format: 'markdown' }
		});
		thread.log_id = 1710000000016;
		engineering.messages.push({
			message_id: '1710000000007', log_id: '1710000000007', room_id: engineering.room_id,
			from: { ...people.linus }, body: { text: 'Engineering room preview. Use #thread_deploy to link to the seeded thread.', format: 'plain' }
		});
		engineering.log_id = 1710000000007;
		// More of general's threads: one joined with news, and three that the guest hasn't joined, which the sidebar
		// lists apart (room_list `not_joined`, §4.2.1) since they deliver nothing live.
		const threads: [id: string, title: string, members: string[], description: string | undefined, messages: [string, string, string][]][] = [
			['thread_cert', 'Expired cert on the runner', ['preview_guest', 'linus', 'margaret'], undefined, [
				['1710000000020', 'linus', 'The build runner’s cert expired overnight, so every deploy since 2am failed.'],
				['1710000000021', 'margaret', 'Renewed it by hand. Rotating to the managed one next.']
			]],
			['thread_offsite', 'Offsite planning', ['ada', 'margaret'], 'Dates, venue, and who is giving talks.', [
				['1710000000022', 'ada', 'Leaning towards the second week of May.']
			]],
			['thread_logo', 'Logo feedback', ['grace', 'linus'], undefined, [
				['1710000000023', 'grace', 'The new mark reads well small; the wordmark less so.']
			]],
			['thread_oncall', 'On-call rotation', ['ada', 'grace', 'linus'], 'Who covers which week, and swaps.', [
				['1710000000024', 'linus', 'I can take the week of the 12th.']
			]]
		];
		for (const [id, title, members, description, messages] of threads) {
			const room = this.makeRoom(id, title, members, 'general');
			if (description) room.description = description;
			for (const [n, author, text] of messages) {
				room.messages.push({ message_id: n, log_id: n, room_id: id, from: { ...people[author] }, body: { text, format: 'plain' } });
				room.log_id = Number(n);
			}
		}
		// A private conversation with Grace (untitled: clients name it for her), and a titled private room of three.
		// Private rooms (§4.2.4) are listed to their members only; ids here start `private_`, which clients never read.
		const withGrace = this.makeRoom('private_1710000000050', undefined, ['preview_guest', 'grace']);
		withGrace.private = true;
		const launch = this.makeRoom('private_1710000000060', 'Launch plans', ['preview_guest', 'ada', 'margaret']);
		launch.private = true;
		launch.description = 'Dates and announcements, until they’re public.';
		for (const [room, n, author, text] of [
			[withGrace, '1710000000051', 'grace', 'Got a minute? I want your take on the onboarding copy before I post it in general.'],
			[withGrace, '1710000000052', 'preview_guest', 'Sure, send it over here.'],
			[launch, '1710000000061', 'ada', 'Announcement goes out Thursday. Keep it here until then.'],
			[launch, '1710000000062', 'margaret', 'I’ll have the post ready by Wednesday.']
		] as const) {
			room.messages.push({ message_id: n, log_id: n, room_id: room.room_id, from: { ...people[author] }, body: { text, format: 'plain' } });
			room.log_id = Number(n);
		}
		if (knobs.seed === 'rich') this.seedRich(general);
		if (this.hasStatus) this.seedPresence();
	}

	private get hasStatus(): boolean {
		return this.knobs.capabilities?.includes('status') ?? false;
	}

	/**
	 * With capability `status`: Ada online, Grace idle, Margaret busy, Linus offline since three hours ago, and of
	 * the rich seed, Rosalind offline since two days ago, the rest online.
	 */
	private seedPresence(): void {
		const ago = (ms: number) => String(Date.now() - ms);
		const hour = 60 * 60 * 1000;
		const statuses: Record<string, { status: string; seen?: string }> = {
			ada: { status: 'online' }, grace: { status: 'idle' }, margaret: { status: 'dnd' }, linus: { status: 'offline', seen: ago(3 * hour) },
			rosalind: { status: 'offline', seen: ago(2 * 24 * hour) }
		};
		for (const id of Object.keys(this.people)) {
			if (id !== 'preview_guest') this.presence.set(id, statuses[id] ?? { status: 'online' });
		}
	}

	/**
	 * Someone else's shown status changes (§4.5.2), as if it did now: a `user` notification with it, and with a new
	 * `seen` when it changes to `offline`: now, or `recorded`, as a server that records it coarsely might (an earlier
	 * time). A `seen` kept from before stays, but goes out only with `offline`.
	 */
	setPresence(userId: string, status: string, recorded?: string): void {
		if (!this.people[userId] || userId === 'preview_guest') throw new Error(`Unknown user: ${userId}`);
		const before = this.presence.get(userId);
		if (before?.status === status) return;
		const seen = status === 'offline' ? recorded ?? String(Date.now()) : before?.seen;
		this.presence.set(userId, { status, ...(seen !== undefined ? { seen } : {}) });
		const update = { user_id: userId, status, ...(status === 'offline' ? { seen } : {}) };
		for (const peer of this.sockets) peer.deliver({ method: 'user', params: { new: update } });
	}

	/** A recorded object for a `from` or a membership's `user` (§3.3): as of now, without a status or `seen`. */
	private recorded(userId: string): JsonObject {
		const { status: _status, ...person } = this.people[userId];
		return structuredClone(person) as JsonObject;
	}

	/**
	 * Everyone's complete current objects, for a listing's `users` (§3.3). With capability `status`, each carries the
	 * shown status, and `seen` with a shown `offline` (§4.5.2): yours too, as others see you (`invisible` shows
	 * `offline`), which the client takes neither of.
	 */
	private users(): JsonObject[] {
		return Object.keys(this.people).map((id) => {
			const person = this.recorded(id);
			if (!this.hasStatus) return id === 'preview_guest' && this.people[id].status !== undefined ? { ...person, status: this.people[id].status! } : person;
			const shown = id === 'preview_guest' ? this.yourShown() : this.presence.get(id);
			if (!shown) return person;
			return { ...person, status: shown.status, ...(shown.status === 'offline' && shown.seen !== undefined ? { seen: shown.seen } : {}) };
		});
	}

	/**
	 * How others see you (§4.5.1): connected, so your chosen status (never chosen: the default, `online`), but
	 * `invisible` shows `offline` and `""` shows `""`.
	 */
	private yourShown(): { status: string; seen?: string } {
		const chosen = this.people.preview_guest.status ?? 'online';
		return chosen === 'invisible' ? { status: 'offline', ...(this.yourSeen !== undefined ? { seen: this.yourSeen } : {}) } : { status: chosen };
	}

	private seedRich(general: PreviewRoom): void {
		Object.assign(this.people, structuredClone(richPeople));
		// You have an avatar too, which the profile offers to remove.
		this.people.preview_guest.avatar = DUSK.url;
		for (const id of Object.keys(richPeople)) general.members.add(id);
		for (const item of richMessages) {
			general.messages.push({ message_id: item.id, log_id: item.id, room_id: general.room_id, from: { ...this.people[item.from] },
				body: { text: item.text, format: 'markdown', ...item.body }, ...item.fields });
			general.log_id = Number(item.id);
		}
		// A room to browse (not joined), and a fourth thread not joined, which the sidebar folds behind "N more…".
		const design = this.makeRoom('design', 'Design reviews', ['ada', 'grace']);
		design.description = 'Critiques, every other Thursday.';
		const thread = this.makeRoom('thread_fonts', 'Font licensing', ['grace', 'margaret'], 'general');
		thread.messages.push({ message_id: '1710000000025', log_id: '1710000000025', room_id: thread.room_id, from: { ...this.people.grace }, body: { text: 'The display face needs a web license.', format: 'plain' } });
		thread.log_id = 1710000000025;
	}

	/**
	 * A message from someone else (not you), as if they sent it now: stored, and delivered live to the room's
	 * members. `body` is the text, or the whole body. Returns its `message_id`.
	 */
	post(roomId: string, from: string, body: string | JsonObject, fields: JsonObject = {}): string {
		const room = this.rooms.get(roomId);
		const author = this.people[from];
		if (!room || !author) throw new Error(`Unknown room or user: ${roomId}, ${from}`);
		const id = this.nextLog(room);
		const record: JsonObject = { message_id: id, log_id: id, room_id: room.room_id, from: this.recorded(from),
			body: typeof body === 'string' ? { text: body, format: 'markdown' } : body, ...fields };
		room.messages.push(record);
		this.broadcast({ method: 'message', params: record }, room);
		return id;
	}

	/**
	 * Someone else starts a private room (§4.2.4) and adds you, as if they did it now: you get it in a `room_update`
	 * `joined`, with their membership and yours. Untitled unless `title` is given. Returns its `room_id`.
	 */
	addYouToPrivate(from: string, title?: string, others: string[] = []): string {
		if (!this.people[from]) throw new Error(`Unknown user: ${from}`);
		const room = this.makeRoom(`private_${this.serial++}`, title, [from, ...others, 'preview_guest']);
		room.private = true;
		const memberships = [from, ...others, 'preview_guest'].map((id) => ({ log_id: this.nextLog(room), room_id: room.room_id, members: [{ user: this.recorded(id), joined: true }] }));
		for (const peer of this.sockets) peer.deliver({ method: 'room_update', params: { joined: [this.roomRecord(room, true)], memberships, users: this.users() } });
		return room.room_id;
	}

	factory: WebSocketFactory = (url) => this.createSocket(url);

	private makeRoom(id: string, title: string | undefined, members: string[], parent?: string): PreviewRoom {
		const room: PreviewRoom = { room_id: id, ...(title !== undefined ? { title } : {}), members: new Set(members), messages: [], reactions: new Map(), log_id: this.serial++, ...(parent ? { parent_room_id: parent } : {}) };
		this.rooms.set(id, room);
		return room;
	}

	private createSocket(url: string): WebSocket {
		const server = this;
		let socket: PreviewSocket;
		socket = {
			url, readyState: 0,
			onopen: null,
			onmessage: null,
			onerror: null,
			onclose: null,
			close: () => {
				if (socket.readyState === 3) return;
				socket.readyState = 3;
				server.sockets.delete(socket);
				socket.onclose?.({} as CloseEvent);
			},
			send: (data) => {
				if (socket.readyState !== 1) return;
				let frame: WireFrame;
				try { frame = JSON.parse(data) as WireFrame; } catch { return; }
				queueMicrotask(() => server.receive(socket, frame));
			},
			deliver: (frame) => {
				if (socket.readyState === 1) socket.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
			}
		};
		queueMicrotask(() => {
			if (socket.readyState !== 0) return;
			server.sockets.add(socket);
			socket.readyState = 1;
			socket.onopen?.({} as Event);
			const capabilities = [...PREVIEW_CAPABILITIES, ...(server.knobs.capabilities ?? [])];
			// With `status`, the optional statuses it takes (§4.5).
			const statuses = capabilities.includes('status') ? { status: ['dnd', 'invisible'] } : {};
			socket.deliver({ method: 'server', params: { apron: 9, agent: 'apron-preview', auth: ['guest'], ping: 60, capabilities, ...statuses, ext: { settings: PREVIEW_SETTINGS } } });
		});
		return socket as unknown as WebSocket;
	}

	private receive(socket: PreviewSocket, frame: WireFrame): void {
		if (socket.readyState !== 1) return;
		this.frames.push(frame);
		if (frame.method === 'ping') { socket.deliver({ method: 'pong' }); return; }
		const params = frame.params ?? {};
		const reply = (result: JsonObject = {}) => { if (frame.id) socket.deliver({ id: frame.id, result }); };
		const fail = (message: string, code = -32602) => { if (frame.id) socket.deliver({ id: frame.id, error: { code, message } }); };
		try {
			switch (frame.method) {
				case 'auth': {
					if (typeof params.name === 'string' && params.name) this.people.preview_guest.name = params.name;
					// The complete `you` (§3.3); anything the sign-in causes would follow the result (§3.2).
					reply({ you: structuredClone(this.people.preview_guest), ...(this.knobs.account ? { token: 'preview-account' } : {}) });
					return;
				}
				case 'room_list': reply(this.listRooms(params)); return;
				case 'history': reply(this.history(params)); return;
				case 'message': this.message(socket, params, reply, fail); return;
				case 'reactions': this.react(socket, params, reply, fail); return;
				case 'room_set': this.setRoom(socket, params, reply, fail); return;
				case 'room_join': this.joinRoom(socket, params, reply, fail); return;
				case 'room_leave': this.leaveRoom(socket, params, reply, fail); return;
				case 'me': this.updateMe(socket, params, reply); return;
				case 'activity': this.activity(socket, params); return;
				case 'command': this.command(socket, params, reply, fail); return;
				// `idle` and mutes (§4.5), for a server given the `status` capability: taken, and kept nowhere. A mute
				// comes back as a `status` before the result, as a server tells each connection of the user.
				case 'status':
					if (params.mute !== undefined) socket.deliver({ method: 'status', params: { ...(typeof params.room_id === 'string' ? { room_id: params.room_id } : {}), mute: params.mute } });
					reply();
					return;
				default: fail(`Unsupported preview method: ${String(frame.method)}`, -32601);
			}
		} catch (error) { fail(error instanceof Error ? error.message : 'Preview request failed'); }
	}

	private roomRecord(room: PreviewRoom, members = false): JsonObject {
		return { room_id: room.room_id, ...(room.title !== undefined ? { title: room.title } : {}), log_id: String(room.log_id), latest_log_id: String(room.log_id), history_log_id: room.messages.length ? room.messages[0].log_id : null,
			...(room.parent_room_id ? { parent_room_id: room.parent_room_id } : {}), ...(room.private ? { private: true } : {}), ...(room.description ? { description: room.description } : {}),
			...(room.ext ? { ext: structuredClone(room.ext) } : {}),
			...(members ? { members: [...room.members].map((id) => ({ user_id: id })) } : {}) };
	}

	private listRooms(params: JsonObject): JsonObject {
		const parent = typeof params.parent_room_id === 'string' ? params.parent_room_id : undefined;
		const exact = typeof params.room_id === 'string' ? params.room_id : undefined;
		// A private room is invisible to anyone but its members (§4.2.4); the one viewer here is preview_guest.
		const rooms = [...this.rooms.values()].filter((room) => !this.hidden(room)).filter((room) => exact
			? room.room_id === exact
			: parent
				? room.parent_room_id === parent
				: params.filter === 'not_joined'
					? room.parent_room_id === undefined
					: true);
		const withMembers = params.members === true;
		const joined = rooms.filter((room) => room.members.has('preview_guest')).map((room) => this.roomRecord(room, withMembers));
		const notJoined = rooms.filter((room) => !room.members.has('preview_guest')).map((room) => this.roomRecord(room, withMembers));
		if (params.filter === 'joined') return { joined, users: this.users() };
		if (params.filter === 'not_joined') return { not_joined: notJoined, users: this.users() };
		return { joined, not_joined: notJoined, users: this.users() };
	}

	/** A private room, or a thread of one, the viewer isn't in. */
	private hidden(room: PreviewRoom | undefined): boolean {
		if (!room) return false;
		if (room.private && !room.members.has('preview_guest')) return true;
		return this.hidden(room.parent_room_id ? this.rooms.get(room.parent_room_id) : undefined);
	}

	private history(params: JsonObject): JsonObject {
		const room = this.rooms.get(String(params.room_id ?? roomId));
		if (!room) throw new Error('Unknown room');
		const hasBefore = params.before !== undefined;
		const before = Number(params.before ?? Number.MAX_SAFE_INTEGER);
		const after = Number(params.after ?? 1);
		const limit = Math.max(1, Math.min(Number(params.limit) || 200, 200));
		const all = room.messages.filter((message) => Number(message.log_id) >= after && Number(message.log_id) <= before).sort((a, b) => Number(a.log_id) - Number(b.log_id));
		const page = hasBefore ? all.slice(-limit) : all.slice(0, limit);
		return { messages: page, more: all.length > page.length, latest_log_id: String(room.log_id), history_log_id: room.messages[0]?.log_id ?? null,
			...(page.length ? { first_log_id: page[0].log_id, last_log_id: page.at(-1)!.log_id } : {}) };
	}

	private nextLog(room: PreviewRoom): string { room.log_id = Math.max(room.log_id + 1, ++this.serial); return String(room.log_id); }
	private broadcast(frame: WireFrame, room?: PreviewRoom): void {
		for (const peer of this.sockets) if (!room || room.members.has('preview_guest')) peer.deliver(frame);
	}
	private message(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id ?? roomId));
		if (!room) return fail('Unknown room');
		const id = typeof p.message_id === 'string' ? p.message_id : this.nextLog(room);
		const log = this.nextLog(room);
		const previous = typeof p.message_id === 'string' ? this.findMessage(id) : undefined;
		const reactions = new Map<string, string[]>();
		if (typeof p.message_id === 'string') {
			for (const candidate of this.rooms.values()) {
				const existingReactions = candidate.reactions.get(id);
				if (existingReactions) {
					for (const [user, emojis] of existingReactions) reactions.set(user, [...emojis]);
					candidate.reactions.delete(id);
				}
				for (let index = candidate.messages.length - 1; index >= 0; index--) {
					if (candidate.messages[index].message_id === id) candidate.messages.splice(index, 1);
				}
			}
		}
		const from = previous && isJsonObject(previous.message.from) ? previous.message.from : this.recorded('preview_guest');
		// A save merges `ext` into the stored one, a creation into nothing (§4.12); a tombstone has neither `body` nor `ext` (§4.4).
		const kept = previous && isJsonObject(previous.message.ext) ? previous.message.ext : undefined;
		const ext = p.deleted ? undefined : mergedExt(kept, p.ext);
		const record: JsonObject = {
			message_id: id, log_id: log, room_id: room.room_id, from,
			...(p.body && !p.deleted ? { body: p.body } : {}),
			...(p.reply_to ? { reply_to: p.reply_to } : {}),
			...(ext ? { ext } : {}),
			...(p.deleted ? { deleted: true } : {})
		};
		if (reactions.size) room.reactions.set(id, reactions);
		room.messages.push(record);
		this.broadcast({ method: 'message', params: record }, room);
		reply({ message_id: id, log_id: log });
	}

	private react(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const target = this.findMessage(String(p.message_id ?? ''));
		if (!target) return fail('Message not found');
		const room = target.room;
		const byUser = room.reactions.get(target.message.message_id as string) ?? new Map<string, string[]>();
		byUser.set('preview_guest', Array.isArray(p.emojis) ? p.emojis.filter((e): e is string => typeof e === 'string') : []);
		room.reactions.set(target.message.message_id as string, byUser);
		const log = this.nextLog(room);
		const record = { room_id: room.room_id, log_id: log, message_id: target.message.message_id, reactions: [...byUser].map(([user, emojis]) => ({ from: this.recorded(user), emojis })) };
		this.broadcast({ method: 'reactions', params: record }, room);
		reply();
	}

	private findMessage(id: string): { room: PreviewRoom; message: JsonObject } | undefined {
		let found: { room: PreviewRoom; message: JsonObject } | undefined;
		for (const room of this.rooms.values()) {
			for (const message of room.messages) {
				if (message.message_id !== id) continue;
				if (!found || Number(message.log_id) >= Number(found.message.log_id)) found = { room, message };
			}
		}
		return found;
	}

	private setRoom(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		let room = typeof p.room_id === 'string' ? this.rooms.get(p.room_id) : undefined;
		if (!room) {
			const parent = typeof p.parent_room_id === 'string' ? p.parent_room_id : undefined;
			if (parent && !this.rooms.has(parent)) return fail('Unknown parent room');
			const id = parent ? `thread_preview_${this.roomSerial++}` : p.private === true ? `private_${this.serial++}` : `room_preview_${this.roomSerial++}`;
			// A private room may go untitled (a conversation, which clients name for its members); others are named by their id.
			room = this.makeRoom(id, typeof p.title === 'string' && p.title ? p.title : p.private === true && !parent ? undefined : id, ['preview_guest'], parent);
			// A thread created without `private` takes its parent's (§4.2.4), unless a test knob plays a server that drops it.
			const dropped = this.knobs.dropPrivate === (parent ? 'threads' : 'rooms');
			if (!dropped && (p.private === true || (p.private === undefined && parent && this.rooms.get(parent)?.private))) room.private = true;
		} else {
			// An update resubmits every client field; one left out is cleared, except `private`, which is kept,
			// and `ext`, which merges (§4.2.4, §4.12). It is a new room record.
			room.title = typeof p.title === 'string' && p.title ? p.title : room.private && !room.parent_room_id ? undefined : room.room_id;
			this.nextLog(room);
		}
		room.description = typeof p.description === 'string' && p.description ? p.description : undefined;
		room.ext = mergedExt(room.ext, p.ext);
		const record = this.roomRecord(room, true);
		socket.deliver({ method: 'room_update', params: { joined: [record], users: this.users() } });
		this.broadcast({ method: 'room_update', params: { updated: [this.roomRecord(room)] } }, room);
		reply({ room_id: room.room_id, log_id: String(room.log_id) });
	}

	private joinRoom(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id));
		if (!room || this.hidden(room)) return fail('Unknown room');
		if (typeof p.user_id === 'string' && p.user_id !== 'preview_guest') return this.changeMember(room, p.user_id, true, reply, fail);
		room.members.add('preview_guest');
		socket.deliver({ method: 'room_update', params: { joined: [this.roomRecord(room, true)], users: this.users() } });
		reply();
	}
	private leaveRoom(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id));
		if (room && typeof p.user_id === 'string' && p.user_id !== 'preview_guest') return this.changeMember(room, p.user_id, false, reply, fail);
		room?.members.delete('preview_guest');
		if (room) this.dropIfEmpty(room);
		socket.deliver({ method: 'room_update', params: { left: [{ room_id: String(p.room_id) }] } });
		reply();
	}
	/** A private room goes once its last member leaves (§4.2.4 leaves it to the server), its threads with it. */
	private dropIfEmpty(room: PreviewRoom): void {
		if (!room.private || room.members.size > 0) return;
		this.rooms.delete(room.room_id);
		for (const thread of [...this.rooms.values()]) if (thread.parent_room_id === room.room_id) this.rooms.delete(thread.room_id);
	}
	/** Adds or removes another user (§4.2.2): a membership record in `room_update` to the room's members, before and after. */
	private changeMember(room: PreviewRoom, userId: string, joined: boolean, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const user = this.people[userId];
		if (!user || !Object.hasOwn(this.people, userId)) return fail('Unknown user');
		if (joined) room.members.add(userId);
		const record = { log_id: this.nextLog(room), room_id: room.room_id, members: [{ user: this.recorded(userId), joined }] };
		this.broadcast({ method: 'room_update', params: { memberships: [record] } }, room);
		if (!joined) {
			room.members.delete(userId);
			this.dropIfEmpty(room);
		}
		reply();
	}

	/** `me` (§3.3): given fields replace, `""` clears, omitted ones stay, and `ext` merges by its keys (§4.12). */
	private updateMe(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void): void {
		const me = this.people.preview_guest;
		const changed: JsonObject = { user_id: me.user_id };
		if (typeof p.name === 'string') changed.name = me.name = p.name || 'You';
		if (typeof p.avatar === 'string') {
			if (p.avatar) me.avatar = p.avatar;
			else delete me.avatar;
			changed.avatar = p.avatar;
		}
		if (typeof p.status === 'string') {
			// Choosing invisible changes how others see you to `offline` (§4.5.2): `seen` is now.
			if (p.status === 'invisible' && me.status !== 'invisible') this.yourSeen = String(Date.now());
			// A chosen `""` (none, §4.5.1) is kept as itself: unlike never choosing (the default, `online`), others see
			// `""`, and the complete `you` carries it (§4.5.2).
			me.status = p.status;
			changed.status = p.status;
		}
		if (isJsonObject(p.ext) && Object.keys(p.ext).length) {
			const ext = mergedExt(me.ext, p.ext);
			if (ext) me.ext = ext;
			else delete me.ext;
			// The notification carries the keys that changed, cleared ones as their empty values.
			changed.ext = structuredClone(p.ext);
		}
		for (const peer of this.sockets) peer.deliver({ method: 'user', params: { you: changed } });
		// The result's `you` is complete.
		reply({ you: structuredClone(me) });
	}
	private activity(socket: PreviewSocket, p: JsonObject): void {
		if (typeof p.room_id !== 'string') return;
		this.broadcast({ method: 'activity', params: { ...p, from: this.recorded('preview_guest') } }, this.rooms.get(p.room_id));
	}
	private command(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const text = (p.body as JsonObject | undefined)?.text;
		if (text === '/help') {
			socket.deliver({ method: 'message', params: { room_id: String(p.room_id ?? roomId), from: { user_id: '~private', name: 'System message to you' }, body: { text: 'Preview commands: /help. Room and message operations are handled in memory.' } } });
			reply();
		} else fail(`Unknown command: ${String(text ?? '')}`);
	}
}

let previewServer: MemoryProtocolServer | undefined;
export const previewWebSocketFactory: WebSocketFactory = (url) => {
	if (!previewServer) {
		const scope = globalThis as { __APRON_PREVIEW__?: PreviewKnobs; __apronPreview?: MemoryProtocolServer };
		previewServer = new MemoryProtocolServer(scope.__APRON_PREVIEW__);
		// Only a test that set knobs reaches the server; the demo exposes nothing.
		if (scope.__APRON_PREVIEW__) scope.__apronPreview = previewServer;
	}
	return previewServer.factory(url);
};
