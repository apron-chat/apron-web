import { mergeExt } from '$lib/protocol/client-internals';
import type { WebSocketFactory } from '$lib/protocol/client-types';
import { isJsonObject, type JsonObject, type WireFrame } from '$lib/protocol/types';
import { DAWN, DUSK } from './preview-images';

export type PreviewRoom = {
	room_id: string;
	title: string;
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

const people: Record<string, { user_id: string; name: string; avatar?: string; roles?: string[]; ext?: JsonObject }> = {
	preview_guest: { user_id: 'preview_guest', name: 'You' },
	ada: { user_id: 'ada', name: 'Ada Lovelace', roles: ['admin'] },
	grace: { user_id: 'grace', name: 'Grace Hopper' },
	linus: { user_id: 'linus', name: 'Linus' },
	margaret: { user_id: 'margaret', name: 'Margaret Hamilton', roles: ['moderator'] }
};

const roomId = 'general';

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

	constructor() {
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
	}

	factory: WebSocketFactory = (url) => this.createSocket(url);

	private makeRoom(id: string, title: string, members: string[], parent?: string): PreviewRoom {
		const room: PreviewRoom = { room_id: id, title, members: new Set(members), messages: [], reactions: new Map(), log_id: this.serial++, ...(parent ? { parent_room_id: parent } : {}) };
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
			socket.deliver({ method: 'server', params: { apron: 8, agent: 'apron-preview', auth: ['guest'], ping: 60, capabilities: ['history', 'edit', 'rooms', 'reactions', 'activity', 'command', 'ext'] } });
		});
		return socket as unknown as WebSocket;
	}

	private receive(socket: PreviewSocket, frame: WireFrame): void {
		if (socket.readyState !== 1) return;
		if (frame.method === 'ping') { socket.deliver({ method: 'pong' }); return; }
		const params = frame.params ?? {};
		const reply = (result: JsonObject = {}) => { if (frame.id) socket.deliver({ id: frame.id, result }); };
		const fail = (message: string, code = -32602) => { if (frame.id) socket.deliver({ id: frame.id, error: { code, message } }); };
		try {
			switch (frame.method) {
				case 'auth': {
					if (typeof params.name === 'string' && params.name) people.preview_guest.name = params.name;
					// The complete `you` (§3.3); anything the sign-in causes would follow the result (§3.2).
					reply({ you: structuredClone(people.preview_guest) });
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
				default: fail(`Unsupported preview method: ${String(frame.method)}`, -32601);
			}
		} catch (error) { fail(error instanceof Error ? error.message : 'Preview request failed'); }
	}

	private roomRecord(room: PreviewRoom, members = false): JsonObject {
		return { room_id: room.room_id, title: room.title, log_id: String(room.log_id), latest_log_id: String(room.log_id), history_log_id: room.messages.length ? room.messages[0].log_id : null,
			...(room.parent_room_id ? { parent_room_id: room.parent_room_id } : {}), ...(room.private ? { private: true } : {}), ...(room.description ? { description: room.description } : {}),
			...(room.ext ? { ext: structuredClone(room.ext) } : {}),
			...(members ? { members: [...room.members].map((id) => ({ user_id: id })) } : {}) };
	}

	private listRooms(params: JsonObject): JsonObject {
		const parent = typeof params.parent_room_id === 'string' ? params.parent_room_id : undefined;
		const exact = typeof params.room_id === 'string' ? params.room_id : undefined;
		// A private room is invisible to anyone but its members (§4.3.4); the one viewer here is preview_guest.
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
		if (params.filter === 'joined') return { joined, users: Object.values(people) };
		if (params.filter === 'not_joined') return { not_joined: notJoined, users: Object.values(people) };
		return { joined, not_joined: notJoined, users: Object.values(people) };
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
		const from = previous && isJsonObject(previous.message.from) ? previous.message.from : { ...people.preview_guest };
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
		const record = { room_id: room.room_id, log_id: log, message_id: target.message.message_id, reactions: [...byUser].map(([user, emojis]) => ({ from: { ...people[user] }, emojis })) };
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
			const id = parent ? `thread_preview_${this.roomSerial++}` : `room_preview_${this.roomSerial++}`;
			room = this.makeRoom(id, typeof p.title === 'string' ? p.title : id, ['preview_guest'], parent);
			// A thread created without `private` takes its parent's (§4.3.4).
			if (p.private === true || (p.private === undefined && parent && this.rooms.get(parent)?.private)) room.private = true;
		} else {
			// An update resubmits every client field; one left out is cleared, except `private`, which is kept,
			// and `ext`, which merges (§4.3.4, §4.12). It is a new room record.
			room.title = typeof p.title === 'string' ? p.title : room.room_id;
			this.nextLog(room);
		}
		room.description = typeof p.description === 'string' && p.description ? p.description : undefined;
		room.ext = mergedExt(room.ext, p.ext);
		const record = this.roomRecord(room, true);
		socket.deliver({ method: 'room_update', params: { joined: [record], users: Object.values(people) } });
		this.broadcast({ method: 'room_update', params: { updated: [this.roomRecord(room)] } }, room);
		reply({ room_id: room.room_id, log_id: String(room.log_id) });
	}

	private joinRoom(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id));
		if (!room || this.hidden(room)) return fail('Unknown room');
		if (typeof p.user_id === 'string' && p.user_id !== 'preview_guest') return this.changeMember(room, p.user_id, true, reply, fail);
		room.members.add('preview_guest');
		socket.deliver({ method: 'room_update', params: { joined: [this.roomRecord(room, true)], users: Object.values(people) } });
		reply();
	}
	private leaveRoom(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const room = this.rooms.get(String(p.room_id));
		if (room && typeof p.user_id === 'string' && p.user_id !== 'preview_guest') return this.changeMember(room, p.user_id, false, reply, fail);
		room?.members.delete('preview_guest');
		socket.deliver({ method: 'room_update', params: { left: [{ room_id: String(p.room_id) }] } });
		reply();
	}
	/** Adds or removes another user (§4.3.2): a membership record in `room_update` to the room's members, before and after. */
	private changeMember(room: PreviewRoom, userId: string, joined: boolean, reply: (result?: JsonObject) => void, fail: (message: string) => void): void {
		const user = people[userId];
		if (!user || !Object.hasOwn(people, userId)) return fail('Unknown user');
		if (joined) room.members.add(userId);
		const record = { log_id: this.nextLog(room), room_id: room.room_id, members: [{ user: { ...user }, joined }] };
		this.broadcast({ method: 'room_update', params: { memberships: [record] } }, room);
		if (!joined) room.members.delete(userId);
		reply();
	}

	/** `me` (§3.3): given fields replace, `""` clears, omitted ones stay, and `ext` merges by its keys (§4.12). */
	private updateMe(socket: PreviewSocket, p: JsonObject, reply: (result?: JsonObject) => void): void {
		const me = people.preview_guest;
		const changed: JsonObject = { user_id: me.user_id };
		if (typeof p.name === 'string') changed.name = me.name = p.name || 'You';
		if (typeof p.avatar === 'string') {
			if (p.avatar) me.avatar = p.avatar;
			else delete me.avatar;
			changed.avatar = p.avatar;
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
		this.broadcast({ method: 'activity', params: { ...p, from: { ...people.preview_guest } } }, this.rooms.get(p.room_id));
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
	previewServer ??= new MemoryProtocolServer();
	return previewServer.factory(url);
};
