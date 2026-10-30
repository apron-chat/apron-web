import { mergeExt } from '$lib/protocol/client-internals';
import type { WebSocketFactory } from '$lib/protocol/client-types';
import type { LiveFetch } from '$lib/protocol/live-text';
import { isJsonObject, type JsonObject, type WireFrame } from '$lib/protocol/types';
import { memorySocket, type MemoryHost, type MemorySocket } from './memory-socket';
import { DAWN, DUSK } from './preview-images';
import { APPEND_DEMO, TERMINAL_DEMO, type DemoStep } from './live-demos';

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
export const PREVIEW_CAPABILITIES = ['history', 'edit', 'rooms', 'reactions', 'activity', 'command', 'embed:terminal', 'embed:append', 'ext', 'ext:settings', 'ext:permissions'];

/**
 * The origin the preview's server is at (`ws://apron-preview.invalid`): the live text it mints (§4.8.3) is served
 * here, through `fetchLive` (the page routes these URLs to it, `setLiveFetch`), since there is no network.
 */
export const PREVIEW_ORIGIN = 'http://apron-preview.invalid';

/** How long a write URL a command minted waits for its `PUT` before it stops working, as the servers' 5 minutes. */
export const PREVIEW_PENDING_MS = 5 * 60_000;

/** How long after `/embed-terminal` or `/embed-append` the preview plays its demo in place of a `PUT` that can't come. */
export const PREVIEW_DEMO_AFTER_MS = 1500;

/**
 * One live text (`append` or `terminal`, §4.8.3): pending until its `PUT` starts (a command's posts its message
 * then), live while it streams, ended once its text has.
 */
interface LiveWrite {
	kind: 'append' | 'terminal';
	embed_id: string;
	write: string;
	read: string;
	title?: string;
	state: 'pending' | 'live' | 'ended';
	/** A command's: the message it posts when the write starts. */
	command?: { room: string; text: string; reply_to?: JsonObject };
	message_id?: string;
	chunks: Uint8Array[];
	readers: Set<ReadableStreamDefaultController<Uint8Array>>;
	timers: ReturnType<typeof setTimeout>[];
}

/** Its settings (`ext:settings`): the most private rooms one user may be a member of, so the new-conversation dialog counts. */
export const PREVIEW_SETTINGS = { private_rooms: 5 };

/** What it lets you do (`ext:permissions`): add people to any room, as the demo's member list shows. */
export const PREVIEW_PERMISSIONS = { add_members: true };

/**
 * Knobs for the browser suite (`e2e/`), read from `window.__APRON_PREVIEW__` when the page's first socket
 * opens (Playwright sets it with `addInitScript`). Without them the preview is the demo, unchanged. With
 * them, the server is also reachable as `window.__apronPreview`, for its `frames` and `post`.
 */
export interface PreviewKnobs {
	/** Capabilities to advertise beyond `PREVIEW_CAPABILITIES`, e.g. `embed:upload` or `status`. */
	capabilities?: string[];
	/** Capabilities of `PREVIEW_CAPABILITIES` not to advertise, e.g. `ext:permissions`. */
	withoutCapabilities?: string[];
	/** Refuses adding others (`room_join` with a `user_id`, §4.2.2) to a room that isn't private with `denied`, as server policy may. */
	denyAdding?: boolean;
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
	/** `you.ext.permissions` (`ext:permissions`) in place of `PREVIEW_PERMISSIONS`, e.g. `{ write: false }` for a guest who only reads. */
	permissions?: JsonObject;
	/** Fields of the `server` frame (§3.1) to add or replace, e.g. `title` or `avatar`; `ext` merges by its keys, e.g. `emoji`. */
	server?: JsonObject;
	/** Fields of the seeded people to add or replace, by `user_id`, e.g. a `name` or `roles`, before anything is seeded. */
	people?: Record<string, JsonObject>;
	/** The `title` and `description` of seeded rooms and threads, by `room_id`, in place of the demo's. */
	rooms?: Record<string, { title?: string; description?: string }>;
	/** `off`: `/embed-terminal` and `/embed-append` wait for a `PUT` (`fetchLive`, or `liveWrite`) rather than playing their demo. */
	liveDemo?: 'off';
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
		{ kind: 'terminal', embed_id: 'preview-build-log', title: 'build.log', output: '\u001b[32mok\u001b[0m 12 tests passed\n' },
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
	private sockets = new Set<MemorySocket>();
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
	/** Live text (§4.8.3), by `embed_id`. */
	private lives = new Map<string, LiveWrite>();
	private liveSerial = 1;

	constructor(knobs: PreviewKnobs = {}) {
		this.knobs = knobs;
		const people = this.people;
		for (const [id, fields] of Object.entries(knobs.people ?? {})) if (people[id]) Object.assign(people[id], structuredClone(fields));
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
		for (const [id, fields] of Object.entries(knobs.rooms ?? {})) {
			const room = this.rooms.get(id);
			if (!room) continue;
			if (fields.title !== undefined) room.title = fields.title;
			if (fields.description !== undefined) room.description = fields.description;
		}
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

	/** Your complete object, as `you` carries it (§3.3): with your permissions (`ext:permissions`), which only `you` carries. */
	private you(): JsonObject {
		const me = structuredClone(this.people.preview_guest) as JsonObject;
		const permissions = this.knobs.permissions ?? PREVIEW_PERMISSIONS;
		return { ...me, ext: { ...(isJsonObject(me.ext) ? me.ext : {}), permissions: structuredClone(permissions) } };
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

	/** Someone else sets their complete reaction set on a message (§4.7), as if they did it now: stored as sent, and broadcast. */
	reactAs(from: string, messageId: string, emojis: string[]): void {
		const target = this.findMessage(messageId);
		if (!target || !this.people[from]) throw new Error(`Unknown message or user: ${messageId}, ${from}`);
		const byUser = target.room.reactions.get(messageId) ?? new Map<string, string[]>();
		byUser.set(from, [...emojis]);
		target.room.reactions.set(messageId, byUser);
		const record = { room_id: target.room.room_id, log_id: this.nextLog(target.room), message_id: messageId, reactions: [{ from: this.recorded(from), emojis: [...emojis] }] };
		this.broadcast({ method: 'reactions', params: record }, target.room);
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

	/**
	 * Someone else posts a message with a live `terminal` or `append` embed (§4.8.3), as if their `PUT` just began:
	 * it streams what `liveWrite` writes (or `playDemo`) until `liveEnd`. `body` is the rest of the body (an append's
	 * opening text, in Markdown by default). Returns the embed's `embed_id`.
	 */
	startLive(roomId: string, from: string, kind: 'terminal' | 'append', fields: { title?: string; body?: JsonObject } = {}): string {
		const live = this.newLive(kind, fields.title);
		live.state = 'live';
		const embeds = [this.liveEmbed(live)];
		live.message_id = this.post(roomId, from, { text: '', ...(kind === 'append' ? { format: 'markdown' } : {}), ...fields.body, embeds });
		return live.embed_id;
	}

	/** Writes to a live text, as its `PUT` body would: every reader gets it, and later readers get it from the start. */
	liveWrite(embedId: string, data: string | Uint8Array): void {
		const live = this.lives.get(embedId);
		if (!live || live.state !== 'live') throw new Error(`No live text: ${embedId}`);
		const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
		if (!bytes.byteLength) return;
		live.chunks.push(bytes);
		for (const reader of live.readers) reader.enqueue(bytes);
	}

	/**
	 * Ends a live text, as the end of its `PUT` body does: its readers' responses end, and a snapshot finishes the
	 * message: a terminal's embed with its `output`, an append's text moved into the body and the embed gone.
	 */
	liveEnd(embedId: string): void {
		const live = this.lives.get(embedId);
		if (!live || live.state === 'ended') return;
		const started = live.state === 'live';
		this.stopLive(live);
		const found = started && live.message_id ? this.findMessage(live.message_id) : undefined;
		if (!found || !isJsonObject(found.message.body)) return;
		const text = new TextDecoder().decode(concat(live.chunks));
		const body = structuredClone(found.message.body) as JsonObject;
		const embeds = (Array.isArray(body.embeds) ? body.embeds : []).filter(isJsonObject);
		const at = embeds.findIndex((embed) => embed.embed_id === embedId);
		if (at === -1) return;
		if (live.kind === 'terminal') {
			embeds[at] = { embed_id: live.embed_id, kind: 'terminal', ...(live.title ? { title: live.title } : {}), output: text };
		} else {
			embeds.splice(at, 1);
			// The appended text doesn't change the mentions (§4.8.5).
			body.text = `${typeof body.text === 'string' ? body.text : ''}${text}`;
		}
		if (embeds.length) body.embeds = embeds;
		else delete body.embeds;
		this.republish(found.room, found.message, { body });
	}

	/** Drops every reader's connection to a live text mid-stream, as a network would: a reader that reconnects gets it all again. */
	liveDrop(embedId: string): void {
		const live = this.lives.get(embedId);
		if (!live) return;
		for (const reader of live.readers) reader.error(new TypeError('The connection dropped'));
		live.readers.clear();
	}

	/** Plays a canned stream into a live text (`live-demos.ts`), then ends it: what `/embed-terminal` and `/embed-append` show here. */
	playDemo(embedId: string, steps: readonly DemoStep[] = this.lives.get(embedId)?.kind === 'append' ? APPEND_DEMO : TERMINAL_DEMO): void {
		const live = this.lives.get(embedId);
		if (!live || live.state !== 'live') return;
		let at = 0;
		for (const step of steps) {
			at += step.wait;
			live.timers.push(setTimeout(() => {
				if (live.state === 'live') this.liveWrite(embedId, step.data);
			}, at));
		}
		live.timers.push(setTimeout(() => this.liveEnd(embedId), at + 300));
	}

	/**
	 * The preview's HTTP, for the live text it minted: `GET` a live text's `url` (the text kept, then more as it
	 * arrives, until it ends; §4.8.3), and `PUT` to a `write_url` (the body streams in, and its end ends the text).
	 * Anything else is a 404, as is a write URL that expired or was used.
	 */
	fetchLive: LiveFetch = async (url, init) => {
		const path = url.startsWith(`${PREVIEW_ORIGIN}/`) ? url.slice(PREVIEW_ORIGIN.length) : '';
		const method = (init.method ?? 'GET').toUpperCase();
		const [, area, token] = /^\/(live|write)\/([^/?#]+)$/.exec(path) ?? [];
		const live = [...this.lives.values()].find((candidate) => (area === 'live' ? candidate.read : candidate.write) === token);
		if (!live) return new Response('Not found', { status: 404 });
		if (area === 'write' && method === 'PUT') return this.receiveWrite(live, init.body);
		// A command's live text has no message, so no url anyone knows of, until its write starts.
		if (area !== 'live' || method !== 'GET' || (live.command && live.state === 'pending')) return new Response('Not found', { status: 404 });
		const signal = init.signal ?? undefined;
		let reader: ReadableStreamDefaultController<Uint8Array> | undefined;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				reader = controller;
				for (const chunk of live.chunks) controller.enqueue(chunk);
				if (live.state === 'ended') controller.close();
				else live.readers.add(controller);
				signal?.addEventListener('abort', () => {
					if (!live.readers.delete(controller)) return;
					controller.error(new DOMException('The request was aborted', 'AbortError'));
				}, { once: true });
			},
			cancel() {
				if (reader) live.readers.delete(reader);
			}
		});
		return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } });
	};

	/** A `PUT` to a write URL: a command's starts its message now; then the body streams in, and its end ends the text. */
	private async receiveWrite(live: LiveWrite, body: RequestInit['body']): Promise<Response> {
		if (live.write === '' || live.state === 'ended') return new Response('Not found', { status: 404 });
		this.beginLive(live);
		// Used once: a second PUT to it is a 404.
		live.write = '';
		const stream = new Response(body ?? null).body;
		if (stream) {
			const reader = stream.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done || live.state !== 'live') break;
				this.liveWrite(live.embed_id, value);
			}
		}
		this.liveEnd(live.embed_id);
		return new Response(null, { status: 204 });
	}

	private newLive(kind: 'append' | 'terminal', title?: string): LiveWrite {
		const serial = this.liveSerial++;
		const token = () => `${serial}${Math.random().toString(36).slice(2, 10)}`;
		const live: LiveWrite = { kind, embed_id: `preview-live-${serial}`, write: token(), read: token(), state: 'pending', chunks: [], readers: new Set(), timers: [], ...(title ? { title } : {}) };
		this.lives.set(live.embed_id, live);
		return live;
	}

	/** The embed as broadcast while live: with its `url` (§4.8.3). */
	private liveEmbed(live: LiveWrite): JsonObject {
		return { embed_id: live.embed_id, kind: live.kind, ...(live.title ? { title: live.title } : {}), url: `${PREVIEW_ORIGIN}/live/${live.read}` };
	}

	/** What the sender is told of each new live text: its write URL, for it alone (§4.8.3). */
	private liveResult(live: LiveWrite): JsonObject {
		return { embed_id: live.embed_id, kind: live.kind, write_url: `${PREVIEW_ORIGIN}/write/${live.write}` };
	}

	/** Its write started: a command's posts its message now, from the command's sender, in its room (the contract's step 4). */
	private beginLive(live: LiveWrite): void {
		if (live.state !== 'pending') return;
		live.state = 'live';
		for (const timer of live.timers.splice(0)) clearTimeout(timer);
		const command = live.command;
		if (!command) return;
		const room = this.rooms.get(command.room);
		if (!room) return;
		const id = this.nextLog(room);
		const body = live.kind === 'append' ? { text: command.text, format: 'markdown', embeds: [this.liveEmbed(live)] } : { text: '', embeds: [this.liveEmbed(live)] };
		const record: JsonObject = { message_id: id, log_id: id, room_id: room.room_id, from: this.recorded('preview_guest'), body, ...(command.reply_to ? { reply_to: command.reply_to } : {}) };
		room.messages.push(record);
		live.message_id = id;
		this.broadcast({ method: 'message', params: record }, room);
	}

	/** Ends its readers and timers, and its write URL: no snapshot. */
	private stopLive(live: LiveWrite): void {
		live.state = 'ended';
		live.write = '';
		for (const timer of live.timers.splice(0)) clearTimeout(timer);
		for (const reader of live.readers) reader.close();
		live.readers.clear();
	}

	/** A new snapshot of a message, as the server makes one (§3.5): the same `message_id`, a new `log_id`. */
	private republish(room: PreviewRoom, message: JsonObject, fields: JsonObject): void {
		const record: JsonObject = { ...structuredClone(message), ...fields, log_id: this.nextLog(room) };
		const index = room.messages.indexOf(message);
		if (index !== -1) room.messages.splice(index, 1);
		room.messages.push(record);
		this.broadcast({ method: 'message', params: record }, room);
	}

	/**
	 * A message request's live embeds (§4.8.2, §4.8.3): new ones get an `embed_id` and a `url`, listed with their write
	 * URLs for the result; kept ones (sent back by `embed_id`) get their `url` or `output` back from the records; one a
	 * save leaves out ends early, with nothing appended. At most one `append` per message (§4.8.5).
	 */
	private liveEmbeds(body: JsonObject, previous: JsonObject | undefined): { body: JsonObject; results: JsonObject[]; created: LiveWrite[] } | string {
		const embeds = Array.isArray(body.embeds) ? body.embeds : [];
		if (embeds.filter((embed) => isJsonObject(embed) && embed.kind === 'append').length > 1) return 'A message has at most one append embed';
		const before = isJsonObject(previous?.body) && Array.isArray(previous.body.embeds) ? previous.body.embeds.filter(isJsonObject) : [];
		const results: JsonObject[] = [];
		const created: LiveWrite[] = [];
		const kept = new Set<string>();
		const next = embeds.map((embed) => {
			if (!isJsonObject(embed) || (embed.kind !== 'terminal' && embed.kind !== 'append')) return embed;
			const id = typeof embed.embed_id === 'string' ? embed.embed_id : undefined;
			const stored = id ? before.find((entry) => entry.embed_id === id) : undefined;
			if (stored) {
				kept.add(id!);
				const { url: _url, output: _output, ...given } = embed;
				return { ...given, ...(stored.url !== undefined ? { url: stored.url } : {}), ...(stored.output !== undefined ? { output: stored.output } : {}) };
			}
			const live = this.newLive(embed.kind, typeof embed.title === 'string' && embed.title ? embed.title : undefined);
			created.push(live);
			results.push(this.liveResult(live));
			return this.liveEmbed(live);
		});
		for (const entry of before) {
			const id = typeof entry.embed_id === 'string' ? entry.embed_id : undefined;
			const live = id ? this.lives.get(id) : undefined;
			if (live && !kept.has(id!) && live.state !== 'ended') this.stopLive(live);
		}
		return { body: next.length ? { ...body, embeds: next } : body, results, created };
	}

	factory: WebSocketFactory = (url) => this.createSocket(url);

	private makeRoom(id: string, title: string | undefined, members: string[], parent?: string): PreviewRoom {
		const room: PreviewRoom = { room_id: id, ...(title !== undefined ? { title } : {}), members: new Set(members), messages: [], reactions: new Map(), log_id: this.serial++, ...(parent ? { parent_room_id: parent } : {}) };
		this.rooms.set(id, room);
		return room;
	}

	private host: MemoryHost = {
		opened: (socket) => {
			this.sockets.add(socket);
			const capabilities = [...PREVIEW_CAPABILITIES.filter((name) => !this.knobs.withoutCapabilities?.includes(name)), ...(this.knobs.capabilities ?? [])];
			// With `status`, the optional statuses it takes (§4.5).
			const statuses = capabilities.includes('status') ? { status: ['dnd', 'invisible'] } : {};
			// A test's fields replace the demo's, `ext` key by key.
			const extra = structuredClone(this.knobs.server ?? {});
			const ext = { settings: PREVIEW_SETTINGS, ...(isJsonObject(extra.ext) ? extra.ext : {}) };
			socket.deliver({ method: 'server', params: { apron: 10, agent: 'apron-preview', auth: ['guest'], ping: 60, capabilities, ...statuses, ...extra, ext } });
		},
		received: (socket, frame) => this.receive(socket, frame),
		closed: (socket) => this.sockets.delete(socket)
	};

	private createSocket(url: string): WebSocket {
		return memorySocket(url, this.host);
	}

	private receive(socket: MemorySocket, frame: WireFrame): void {
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
					reply({ you: this.you(), ...(this.knobs.account ? { token: 'preview-account' } : {}) });
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
	private message(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id ?? roomId));
		if (!room) return fail('Unknown room');
		const id = typeof p.message_id === 'string' ? p.message_id : this.nextLog(room);
		const log = this.nextLog(room);
		const previous = typeof p.message_id === 'string' ? this.findMessage(id) : undefined;
		// Live text: new embeds get their URLs, kept ones their server-owned fields; a tombstone ends any still live.
		const lived = isJsonObject(p.body) && !p.deleted ? this.liveEmbeds(p.body, previous?.message) : undefined;
		if (typeof lived === 'string') return fail(lived);
		if (p.deleted) for (const live of this.lives.values()) if (live.message_id === id && live.state !== 'ended') this.stopLive(live);
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
			...(p.body && !p.deleted ? { body: lived?.body ?? p.body } : {}),
			...(p.reply_to ? { reply_to: p.reply_to } : {}),
			...(ext ? { ext } : {}),
			...(p.deleted ? { deleted: true } : {})
		};
		if (reactions.size) room.reactions.set(id, reactions);
		room.messages.push(record);
		for (const live of lived?.created ?? []) live.message_id = id;
		this.broadcast({ method: 'message', params: record }, room);
		// The write URLs of its new live text, for the sender alone, after the broadcast (§4.8.3).
		reply({ message_id: id, log_id: log, ...(lived?.results.length ? { embeds: lived.results } : {}) });
	}

	private react(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
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

	private setRoom(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
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

	private joinRoom(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string, code?: number) => void): void {
		const room = this.rooms.get(String(p.room_id));
		if (!room || this.hidden(room)) return fail('Unknown room');
		if (typeof p.user_id === 'string' && p.user_id !== 'preview_guest') {
			if (this.knobs.denyAdding && !room.private) return fail('Only moderators add people here', -32001);
			return this.changeMember(room, p.user_id, true, reply, fail);
		}
		room.members.add('preview_guest');
		socket.deliver({ method: 'room_update', params: { joined: [this.roomRecord(room, true)], users: this.users() } });
		reply();
	}
	private leaveRoom(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
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
	private updateMe(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void): void {
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
		reply({ you: this.you() });
	}
	private activity(socket: MemorySocket, p: JsonObject): void {
		if (typeof p.room_id !== 'string') return;
		this.broadcast({ method: 'activity', params: { ...p, from: this.recorded('preview_guest') } }, this.rooms.get(p.room_id));
	}
	private command(socket: MemorySocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const body = isJsonObject(p.body) ? p.body : {};
		const text = typeof body.text === 'string' ? body.text : '';
		const room = String(p.room_id ?? roomId);
		const notice = (markdown: string) => socket.deliver({ method: 'message', params: { room_id: room, from: { user_id: '~private', name: 'System message to you' }, body: { text: markdown, format: 'markdown' } } });
		const [, name = '', rest = ''] = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim()) ?? [];
		if (name !== 'embed-terminal' && name !== 'embed-append' && Array.isArray(body.embeds) && body.embeds.some((embed) => isJsonObject(embed) && (embed.kind === 'terminal' || embed.kind === 'append'))) {
			return fail('Live text embeds go in a message, or come from /embed-terminal or /embed-append');
		}
		if (name === 'help') {
			notice('Preview commands:\n\n- `/help`: this list.\n- `/embed-terminal [title]`: a terminal to stream a program\'s output into (80×40).\n- `/embed-append [markdown]`: a message whose text streams in after the Markdown you give.\n\nRoom and message operations are handled in memory.');
			reply();
		} else if (name === 'embed-terminal' || name === 'embed-append') {
			if (!this.rooms.has(room)) return fail('Unknown room');
			const kind = name === 'embed-terminal' ? 'terminal' : 'append';
			const live = this.newLive(kind, kind === 'terminal' ? rest.trim() || undefined : undefined);
			// A paragraph break after opening text starts the streamed text on a paragraph of its own.
			const opening = kind === 'append' ? rest.trim() : '';
			live.command = { room, text: opening ? `${opening}\n\n` : '', ...(isJsonObject(p.reply_to) ? { reply_to: structuredClone(p.reply_to) } : {}) };
			const writeUrl = `${PREVIEW_ORIGIN}/write/${live.write}`;
			// Its write URL stops working if no PUT comes in time (§4.8.3).
			live.timers.push(setTimeout(() => {
				if (live.state === 'pending') this.stopLive(live);
			}, PREVIEW_PENDING_MS));
			reply({ embeds: [this.liveResult(live)] });
			const recipe = kind === 'terminal'
				? `Stream a terminal into this room within 5 minutes (80×40):\n\n\`\`\`sh\nscript -qfc 'stty cols 80 rows 40; YOUR_COMMAND' /dev/null | curl -sT - '${writeUrl}'\n\`\`\``
				: `Stream text into this room within 5 minutes:\n\n\`\`\`sh\nyour-llm-command | curl -sT - '${writeUrl}'\n\`\`\``;
			const demo = this.knobs.liveDemo !== 'off';
			notice(`${recipe}${demo ? '\n\nThis preview has no network, so it plays a demo here in a moment instead.' : ''}`);
			if (demo) {
				live.timers.push(setTimeout(() => {
					if (live.state !== 'pending') return;
					this.beginLive(live);
					this.playDemo(live.embed_id);
				}, PREVIEW_DEMO_AFTER_MS));
			}
		} else fail(`Unknown command: ${text}`);
	}
}

/** One buffer of all of them, in order. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let at = 0;
	for (const chunk of chunks) {
		all.set(chunk, at);
		at += chunk.byteLength;
	}
	return all;
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

/** The preview's live text, for `setLiveFetch`: its own origin's URLs from its server (`fetchLive`), any other from the network. */
export const previewLiveFetch: LiveFetch = (url, init) => {
	if (!url.startsWith(`${PREVIEW_ORIGIN}/`)) return fetch(url, init);
	return previewServer ? previewServer.fetchLive(url, init) : Promise.resolve(new Response('Not found', { status: 404 }));
};
