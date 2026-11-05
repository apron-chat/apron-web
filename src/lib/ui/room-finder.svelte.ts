/**
 * Search Local History's rooms and threads (`SearchDialog`'s other mode): those the page knows of, ranked by name
 * (`$lib/ui/room-search`), each as the rooms list draws it. `room:` narrows it to a room's threads, and then the
 * threads of that room you haven't joined are listed from the server (`room_list` with `parent_room_id`), as the
 * rooms list lists the open room's, reusing a listing as recent as the client keeps one.
 */
import { untrack } from 'svelte';
import type { RoomResult, SearchFoot } from '$lib/design/components/types';
import type { ChatClient, RoomListing, RoomSnapshot } from '$lib/protocol/client';
import { markdownText } from '$lib/protocol/markdown';
import type { Identity } from '$lib/protocol/types';
import { minuteNow } from './clock.svelte';
import { roomFaces } from './faces';
import { knownRooms, rankRooms, wantedOf, type FoundRooms, type KnownRoom } from './room-search';
import { snippet, type SearchQuery } from './search';
import { idAgo, idDateTime, idIso } from './time';

/** What finding rooms reads, as it changes. */
export interface RoomFinderHost {
	readonly client: Pick<ChatClient, 'storedRooms' | 'listRooms'>;
	/** The rooms shown: joined, or open without joining. */
	readonly rooms: readonly RoomSnapshot[];
	/** The rooms listed to join (`room_list` `not_joined`, §4.2.1), and each room's threads listed to join. */
	readonly listed: readonly RoomListing[];
	readonly threadsListed: Readonly<Record<string, readonly RoomListing[]>>;
	/** What's new in each room, by `room_id`, as the rooms list counts it. */
	readonly unread: Readonly<Record<string, number>>;
	readonly mentions: Readonly<Record<string, number>>;
	/** Who you are, for whom a private room is with. */
	readonly you: Identity | undefined;
	/** What is typed, read (`parseQuery`): its words, and its `room:` filter. */
	readonly query: SearchQuery;
	/** Rooms are what is searched now: otherwise it finds nothing, and lists nothing. */
	readonly active: boolean;
	/** The server lists rooms (capability `rooms`). */
	readonly canList: boolean;
}

/** Where the listing of a room's threads is: under way, done, or refused and why. */
type Listing = { state: 'listing' } | { state: 'listed' } | { state: 'failed'; error: string };

export class RoomFinder {
	/** Every room and thread the page knows of (`knownRooms`), by `room_id` too. */
	readonly known: KnownRoom[];
	readonly byId: Map<string, KnownRoom>;
	/** What the query finds (`rankRooms`). */
	readonly found: FoundRooms | undefined;
	/** Those, as the results draw them. */
	readonly results: RoomResult[];
	/** After the results, while `room:` names a room: whether its threads you haven't joined are listed. */
	readonly foot: SearchFoot | undefined;
	/** Each scoped room's listing of its threads, by `room_id`. */
	private listings = $state<Record<string, Listing>>({});

	/** Made as the dialog's component starts: it lists the threads of each room `room:` comes to name. */
	constructor(host: RoomFinderHost) {
		this.known = $derived(host.active ? knownRooms(host.rooms, [...host.listed, ...Object.values(host.threadsListed).flat()], host.client.storedRooms()) : []);
		this.byId = $derived(new Map(this.known.map((room) => [room.id, room])));
		this.found = $derived(host.active ? rankRooms(this.known, { text: host.query.text, rooms: host.query.rooms }) : undefined);
		this.results = $derived.by(() => {
			if (!this.found) return [];
			const scoped = this.found.scope.length === 1;
			const wanted = wantedOf(host.query.text);
			const shown = new Map(host.rooms.map((room) => [room.id, room]));
			const now = minuteNow();
			return this.found.rooms.map((room): RoomResult => {
				const parent = room.parentRoomId === undefined || scoped ? undefined : this.byId.get(room.parentRoomId)?.title ?? room.parentRoomId;
				const description = room.description ? markdownLine(room.description) : '';
				const member = shown.get(room.id);
				const faces = room.private && room.parentRoomId === undefined && member ? roomFaces(member, host.you) : undefined;
				return {
					kind: 'room', id: room.id, group: room.joined ? 'Joined' : 'Not joined', joined: room.joined, parts: snippet(room.title, wanted, 200),
					...(room.parentRoomId !== undefined ? { thread: true } : {}),
					...(parent !== undefined ? { parent } : {}),
					...(description ? { description } : {}),
					...(room.private ? { private: true } : {}),
					...(faces?.length ? { faces } : {}),
					...(host.unread[room.id] ? { unread: host.unread[room.id] } : {}),
					...(host.mentions[room.id] ? { mentions: host.mentions[room.id] } : {}),
					...(member?.mutedUntil !== undefined ? { muted: true } : {}),
					...(room.activeId !== undefined && !room.joined ? { ago: { text: idAgo(room.activeId, now), datetime: idIso(room.activeId), title: `Last active ${idDateTime(room.activeId)}` } } : {})
				};
			});
		});
		this.foot = $derived.by(() => {
			const scope = this.found?.scope ?? [];
			if (scope.length !== 1 || !host.canList) return undefined;
			const [room] = scope;
			const listing = this.listings[room.id];
			if (!listing || listing.state === 'listing') return { note: `Listing ${room.title}’s other threads…` };
			if (listing.state === 'failed') return { note: `${room.title}’s other threads didn’t list: ${listing.error}` };
			const others = (host.threadsListed[room.id] ?? []).filter((thread) => !thread.joined).length;
			return { note: others ? `Threads you haven’t joined: the ${others === 1 ? 'one' : others} the server lists, its most recently active.` : 'No threads you haven’t joined, as the server lists them.' };
		});
		// Each room `room:` names has its threads you haven't joined listed, as the rooms list lists the open room's.
		$effect(() => {
			if (!host.active || !host.canList) return;
			const scope = this.found?.scope ?? [];
			untrack(() => {
				for (const room of scope) this.list(host, room.id);
			});
		});
	}

	/** Lists `roomId`'s threads you haven't joined, once while it stays scoped; a listing the client reuses answers at once. */
	private list(host: RoomFinderHost, roomId: string): void {
		if (this.listings[roomId]) return;
		this.listings[roomId] = { state: 'listing' };
		host.client.listRooms(roomId).then(
			() => (this.listings[roomId] = { state: 'listed' }),
			(cause: unknown) => (this.listings[roomId] = { state: 'failed', error: cause instanceof Error ? cause.message : 'Unable to list them' })
		);
	}
}

/** A description as one line of text. */
function markdownLine(text: string): string {
	return markdownText(text).replace(/\s+/g, ' ').trim();
}
