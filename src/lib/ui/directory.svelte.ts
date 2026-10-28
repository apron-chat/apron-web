import { bioOf, serverMedia, userIn, type ClientSnapshot } from '$lib/protocol/client';
import { safeAvatar } from '$lib/protocol/embeds';
import { shownPerson, withoutBidiOverrides } from '$lib/protocol/plain-text';
import type { EmojiResolver, LinkResolver, MentionResolver, MentionTarget, RoomMentionResolver } from '$lib/protocol/markdown';
import type { Identity } from '$lib/protocol/types';
import { readPlaceLink, writeApronLink } from './apron-link';
import { backendHost } from './connection';
import { customEmoji } from './custom-emoji.svelte';
import { shownSeen } from './user-status';

type Users = Pick<ClientSnapshot, 'users' | 'recordedUsers' | 'userAliases'>;

/**
 * Who and where names refer to on the active backend: the kept user object
 * per `user_id` (§3.3), followed through renames, the latest recorded object
 * as a fallback, room titles for `#room_id` references, the chat server's
 * origin, the only one streams load from, and the origins besides it that
 * embed media load from (`ext:media`).
 * Every message renders its sender from here, field by field: the kept
 * object, then the `from` the message carries, then the `user_id`. So a
 * rename or a new avatar shows on old messages too.
 */
class Directory {
	origin = $state<string | undefined>();
	/** The chat server's WebSocket URL: what an Apron link in a message names to be one of its rooms (Appendix A.4). */
	server = $state<string | undefined>();
	/** The origins the server names for its media (`ext.media.origins`, EXT.md §6); replaced only when they change. */
	mediaOrigins = $state.raw<readonly string[]>([]);
	you = $state.raw<Identity | undefined>();
	private users = $state.raw<Users>({ users: {}, recordedUsers: {}, userAliases: {} });
	/** When this client saw each user go offline (`ClientSnapshot.sawOffline`): a floor under their `seen`. */
	private sawOffline = $state.raw<Record<string, number>>({});
	/** The statuses held through a resume until its listing (`ClientSnapshot.statusesBeforeResume`). */
	private beforeResume = $state.raw<Record<string, string>>({});
	private rooms = $state.raw<Record<string, string>>({});
	/** The rooms among them that are threads without a title, which `rooms` calls "Untitled". */
	private untitled = $state.raw<Record<string, true>>({});
	/** The threads among them, by the room each is in. */
	private parents = $state.raw<Record<string, string>>({});
	/**
	 * Every known `user_id` by the display name it shows under: its kept name,
	 * else (only when nothing is kept for it, not when it was cleared) the name
	 * it was last recorded with, else its `user_id`; as shown, without bidi
	 * embeddings and overrides (§3.5.2), so none tells two alike names apart.
	 * Retired IDs count as the identity that replaced them.
	 */
	private readonly byName = $derived.by(() => {
		const { users, recordedUsers, userAliases } = this.users;
		const names = new Map<string, Set<string>>();
		for (const id of new Set([...Object.keys(users), ...Object.keys(recordedUsers)])) {
			if (userAliases[id] !== undefined) continue;
			const kept = users[id];
			const name = withoutBidiOverrides((kept && Object.hasOwn(kept, 'name') ? kept.name : recordedUsers[id]?.name) || '') || id;
			let ids = names.get(name);
			if (!ids) names.set(name, (ids = new Set()));
			ids.add(id);
		}
		return names;
	});

	/**
	 * Takes an authenticated snapshot; the last one is kept while a reconnect
	 * rebuilds the view. The client emits fresh records on every frame, so
	 * unchanged ones are kept: every message body renders from them, and a
	 * typing notice or an upload's progress should not render them all again.
	 */
	apply(snapshot: ClientSnapshot, origin: string | undefined, server?: string): void {
		this.origin = origin;
		this.server = server;
		const { origins } = serverMedia(snapshot.server);
		if (origins.join(' ') !== this.mediaOrigins.join(' ')) this.mediaOrigins = origins;
		// Its custom emoji (`ext:emoji`), kept through a reconnect until the next server frame says otherwise.
		if (snapshot.server) customEmoji.apply(snapshot.server, server);
		if (!snapshot.authenticated) return;
		this.you = snapshot.you;
		const current = this.users;
		if (!sameEntries(current.users, snapshot.users) || !sameEntries(current.recordedUsers, snapshot.recordedUsers) || !sameEntries(current.userAliases, snapshot.userAliases)) {
			this.users = { users: snapshot.users, recordedUsers: snapshot.recordedUsers, userAliases: snapshot.userAliases };
		}
		const sawOffline = snapshot.sawOffline ?? {};
		if (!sameEntries(this.sawOffline, sawOffline)) this.sawOffline = sawOffline;
		const beforeResume = snapshot.statusesBeforeResume ?? {};
		if (!sameEntries(this.beforeResume, beforeResume)) this.beforeResume = beforeResume;
		const rooms: Record<string, string> = {};
		const untitled: Record<string, true> = {};
		const parents: Record<string, string> = {};
		for (const room of [...(snapshot.directory ?? []), ...Object.values(snapshot.threadDirectory).flat(), ...snapshot.rooms]) {
			rooms[room.id] = room.title; // shown already (`roomTitle`)
			if (room.untitled) untitled[room.id] = true;
			else delete untitled[room.id];
			if (room.parentRoomId !== undefined) parents[room.id] = room.parentRoomId;
		}
		if (!sameEntries(this.rooms, rooms)) this.rooms = rooms;
		if (!sameEntries(this.untitled, untitled)) this.untitled = untitled;
		if (!sameEntries(this.parents, parents)) this.parents = parents;
	}

	/**
	 * Everything names, avatars and mentions are read from, one value per piece:
	 * reading it depends on all of them, and a rendering made from the same
	 * pieces is still current (`samePieces`).
	 */
	get pieces(): readonly unknown[] {
		return [this.origin, this.server, this.you, this.users, this.rooms, this.untitled, this.parents, customEmoji.catalog, customEmoji.reducedMotion];
	}

	/** Draws a custom emoji's key (`ext:emoji`) as its image, once the catalog has it; asks for the catalog the first time one is seen. */
	readonly resolveEmoji: EmojiResolver = (key) => customEmoji.resolve(key);

	forget(): void {
		this.you = undefined;
		this.users = { users: {}, recordedUsers: {}, userAliases: {} };
		this.sawOffline = {};
		this.beforeResume = {};
		this.rooms = {};
		this.untitled = {};
		this.parents = {};
	}

	/**
	 * How to show a user a frame names (a `from`, a member): the kept fields,
	 * else the recorded ones; the name and roles as shown, without bidi
	 * embeddings and overrides (§3.5.2, `shownPerson`).
	 */
	person(from: Identity | undefined): Identity | undefined {
		return from ? shownPerson(userIn(this.users, from)) : undefined;
	}

	/** A display name: the kept `name`, else the recorded one where none is kept; empty or unknown shows the `user_id`. */
	name(from: Identity | undefined): string {
		const person = this.person(from);
		return person?.name || person?.user_id || 'Unknown sender';
	}

	/** An avatar this client will load, if the user has one. */
	avatar(from: Identity | undefined): string | undefined {
		return safeAvatar(this.person(from)?.avatar, this.origin);
	}

	/**
	 * A user's `status` (§4.5), from the kept current object only: a recorded
	 * one (a `from`) is as of its record, not now. Undefined when the server
	 * sends none, or cleared it with `""` (§3.3), so nothing is shown.
	 */
	status(from: Identity | undefined): string | undefined {
		const id = this.person(from)?.user_id;
		const status = id === undefined ? undefined : this.users.users[id]?.status;
		return typeof status === 'string' && status !== '' ? status : undefined;
	}

	/**
	 * A user's status as the member list showed it before a resume, until its joined listing arrives
	 * (`ClientSnapshot.statusesBeforeResume`); never yours. Kept here, replaced only when it changes, as the users are,
	 * so a list that reads it doesn't render again with every snapshot.
	 */
	statusBeforeResume(from: Identity | undefined): string | undefined {
		const id = this.person(from)?.user_id;
		return id === undefined || this.you?.user_id === id ? undefined : this.beforeResume[id];
	}

	/**
	 * When a user was last seen (§4.5.2), from the kept current object only,
	 * as their status is: only while that shows `offline`, and never for you
	 * (`shownSeen`). Never earlier than when this client saw them go offline
	 * (`sawOffline`), which shows even where the server kept no `seen`.
	 */
	seen(from: Identity | undefined): string | undefined {
		const id = this.person(from)?.user_id;
		return id === undefined ? undefined : shownSeen(this.users.users[id], this.you?.user_id === id, this.sawOffline[id]);
	}

	/**
	 * A user's bio (extension `ext:bio`), from the kept current object only,
	 * as their status is: a recorded one (a `from`) is as of its record.
	 */
	bio(from: Identity | undefined): string | undefined {
		const id = this.person(from)?.user_id;
		return id === undefined ? undefined : bioOf(this.users.users[id]);
	}

	/**
	 * Whether another known `user_id` shows under the same display name, so
	 * this one must show its `@user_id` beside it (§3.3): no one passes as
	 * someone else. A name that is the user's own `user_id` already says who
	 * they are; whoever else shows under it gets the `@user_id` instead.
	 */
	sharesName(from: Identity | undefined): boolean {
		const person = this.person(from);
		if (!person) return false;
		const name = this.name(from);
		if (name === person.user_id) return false;
		const ids = this.byName.get(name);
		if (!ids) return false;
		for (const id of ids) if (id !== person.user_id && id !== from!.user_id) return true;
		return false;
	}

	isMe(userId: string): boolean {
		return this.you !== undefined && userIn(this.users, { user_id: userId }).user_id === this.you.user_id;
	}

	/** Resolves `#room_id` (Appendix A.3), whatever users share the ID. */
	readonly resolveRoom: RoomMentionResolver = (id) => {
		const title = this.rooms[id];
		if (title === undefined) return undefined;
		return { kind: 'room', id, title, ...(this.untitled[id] ? { untitled: true as const } : {}) };
	};

	/**
	 * Draws an Apron link written as its own URL as a chip that says in words
	 * what it is, from what is known here (Appendix A.4): "Message in #general",
	 * a room's name, a thread's name "in #general", a known user as `@name`. A
	 * room not known here is its `room_id`. One to another server is nothing
	 * here, and opening it switches servers, so it is no mention: its host
	 * first, then "Message" or "Room", nothing looked up. Another server's
	 * user stays a URL, as does any link not read strictly as a place
	 * (`readPlaceLink`): one with a token, a key it doesn't know, or a
	 * malformed part never looks like one. Under the chip is the link in its
	 * https form with the server, so a copied one opens the same place (Appendix A.4).
	 */
	readonly resolveLink: LinkResolver = (href) => {
		const link = readPlaceLink(href);
		if (!link) return undefined;
		const server = link.server ?? this.server;
		if (server === undefined) return undefined;
		const shared = writeApronLink({ server, room: link.room, message: link.message, user: link.user });
		if (server !== this.server) {
			if (link.user !== undefined) return undefined;
			const host = backendHost(server) || server;
			const kind = link.message !== undefined ? 'message' : 'room';
			return { kind, elsewhere: true, href: shared, label: host, detail: kind === 'message' ? ' · Message' : ' · Room', title: `A ${kind} on ${host}, another server: opening it asks to switch` };
		}
		const room = this.resolveRoom(link.room)?.title ?? link.room;
		// In a tooltip, as a room mention's: an untitled thread's room_id after its "Untitled".
		const tip = (id: string) => {
			const known = this.resolveRoom(id);
			return known?.untitled ? `${known.title} (#${id})` : known?.title ?? id;
		};
		const parentId = this.parents[link.room];
		const parent = parentId === undefined ? undefined : this.resolveRoom(parentId)?.title ?? parentId;
		if (link.user !== undefined) {
			const user = this.resolve(link.user);
			return user?.kind === 'user' ? { kind: 'user', href: shared, label: `@${user.name}`, title: `${user.name} in #${tip(link.room)}` } : undefined;
		}
		if (link.message !== undefined) return { kind: 'message', href: shared, label: 'Message', detail: ` in #${room}`, title: `A message in #${tip(link.room)}` };
		if (parentId !== undefined) return { kind: 'thread', href: shared, label: room, detail: ` in #${parent}`, title: `Open ${tip(link.room)}, a thread in #${tip(parentId)}` };
		return { kind: 'room', href: shared, label: room, title: `Open #${tip(link.room)}` };
	};

	/** Resolves `@user_id` (Appendix A.3): a known user, marked `shared` when another shows under their name; unknown IDs stay text. */
	readonly resolve: MentionResolver = (id) => {
		const { users, recordedUsers, userAliases } = this.users;
		const recorded = recordedUsers[id];
		const from = recorded ?? { user_id: id };
		const known = users[id] || userAliases[id] !== undefined || recorded ? this.person(from) : undefined;
		if (!known) return undefined;
		const target: MentionTarget = { kind: 'user', id, name: known.name || known.user_id, me: this.isMe(id) };
		if (this.sharesName(from)) target.shared = true;
		return target;
	};
}

/** Whether two `pieces` of the directory are the same, so what was rendered from one is current for the other. */
export function samePieces(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((piece, index) => piece === b[index]);
}

/** The same keys holding the same values; the client keeps an identity object until that user changes. */
function sameEntries<T>(a: Record<string, T>, b: Record<string, T>): boolean {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

export const directory = new Directory();
