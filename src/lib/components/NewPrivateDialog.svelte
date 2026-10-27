<script lang="ts">
	import PrivateRoomForm from '$lib/design/components/PrivateRoomForm.svelte';
	import type { PickPerson, PickRoom } from '$lib/design/components/types';
	import { serverSettings, type ChatClient, type RoomSnapshot } from '$lib/protocol/client';
	import type { Identity } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { faceOf, roomFaces } from '$lib/ui/faces';
	import { matching, pickable } from '$lib/ui/people';
	import { couldNotAdd } from '$lib/ui/members';
	import { directRoomWith, privateRooms, quietestFirst, startPrivateRoom } from '$lib/ui/private-rooms';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { idSince } from '$lib/ui/time';

	/**
	 * The + beside Private: starts a private room (§4.2.4) with the people picked from those the session knows, in
	 * the design system's PrivateRoomForm. One person you already talk to opens that conversation instead. At the
	 * server's limit (`ext.settings.private_rooms`) it offers your private rooms to leave, the quietest first.
	 */
	interface Props {
		client: ChatClient;
		session: SessionView;
		/** False while starting one isn't allowed (signed in, capability `rooms`, not read-only): the form stays open but won't start. */
		enabled: boolean;
		/** The server named the room being started, before it opens: it's one you started, not one someone added you to. */
		onnamed?: (roomId: string) => void;
		/** Open this private room: one you already had, or the one just started, with what couldn't be done in it (who wasn't added). */
		onopen: (roomId: string, problem?: string) => void;
		/** It closed: done, or put away. */
		onclose: () => void;
	}
	let { client, session, enabled, onnamed, onopen, onclose }: Props = $props();

	/** The most of your private rooms offered to leave at the limit; "and N more" for the rest. */
	const FULL_SHOWN = 5;
	/** The most people listed at once: typing narrows it. */
	const PEOPLE_SHOWN = 50;

	// The caller mounts it each time, so the form starts empty.
	let open = $state(true);
	let query = $state('');
	let name = $state('');
	let chosenIds = $state<string[]>([]);
	let saving = $state(false);
	let error = $state<string | undefined>();
	let leaving = $state<string[]>([]);

	let you = $derived(session.you?.user_id);
	/** Everyone the session knows but you and the system identities, by name. */
	let known = $derived(pickable(Object.values(session.snapshot.users)));
	/** Those whose name or `@user_id` holds what's typed. */
	let people = $derived(matching(known, query, PEOPLE_SHOWN).map(pickPerson));
	let chosen = $derived(chosenIds.map((id) => pickPerson(directory.person({ user_id: id }) ?? { user_id: id })));
	let mine = $derived(privateRooms(session.rooms));
	let limit = $derived(serverSettings(session.server).private_rooms);
	let quota = $derived(limit !== undefined ? { used: mine.length, max: limit } : undefined);
	let atLimit = $derived(limit !== undefined && mine.length >= limit);
	let full = $derived(atLimit ? quietestFirst(mine).slice(0, FULL_SHOWN).map(pickRoom) : undefined);

	function pickPerson(user: Identity): PickPerson {
		return { ...faceOf(user), ...(directRoomWith(session.rooms, you, user.user_id) ? { existing: true } : {}) };
	}

	function pickRoom(room: RoomSnapshot): PickRoom {
		const since = room.latestLogId ? idSince(room.latestLogId) : '';
		return {
			id: room.id, name: room.title,
			faces: roomFaces(room, session.you),
			...(since ? { detail: since === 'now' ? 'Active now' : /^\d+[mhd]$/.test(since) ? `Last active ${since} ago` : `Last active ${since}` } : {}),
			...(leaving.includes(room.id) ? { leaving: true } : {})
		};
	}

	function pick(userId: string): void {
		error = undefined;
		chosenIds = chosenIds.includes(userId) ? chosenIds.filter((id) => id !== userId) : [...chosenIds, userId];
	}

	function openExisting(userId: string): void {
		const room = directRoomWith(session.rooms, you, userId);
		if (!room) return pick(userId);
		onopen(room.id);
		open = false;
	}

	async function leave(roomId: string): Promise<void> {
		if (leaving.includes(roomId)) return;
		leaving = [...leaving, roomId];
		error = undefined;
		try {
			await client.leaveRoom(roomId).promise;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to leave';
		} finally {
			leaving = leaving.filter((id) => id !== roomId);
		}
	}

	/** Starts the room with everyone picked, or opens the conversation you already have with the one picked. */
	async function start(): Promise<void> {
		if (saving || !enabled || atLimit || !chosenIds.length) return;
		const ids = [...chosenIds];
		const existing = ids.length === 1 ? directRoomWith(session.rooms, you, ids[0]) : undefined;
		if (existing) {
			onopen(existing.id);
			open = false;
			return;
		}
		saving = true;
		error = undefined;
		try {
			const title = ids.length > 1 ? name.trim() : '';
			const started = await startPrivateRoom(client, ids, { ...(title ? { title } : {}), named: onnamed });
			saving = false;
			onopen(started.roomId, started.failed.length ? couldNotAdd(started.failed, (id) => directory.name({ user_id: id })) : undefined);
			open = false;
		} catch (cause) {
			saving = false;
			error = cause instanceof Error ? cause.message : 'Unable to start a private room';
		}
	}
</script>

<PrivateRoomForm
	bind:open bind:query bind:name {people} {chosen} {quota} {full} fullMore={atLimit ? Math.max(0, mine.length - FULL_SHOWN) : 0}
	status={saving ? 'saving' : 'idle'} {error} disabled={!enabled} listTestid="private-people"
	onpick={pick} onremove={pick} onopen={openExisting} onleaveroom={leave} onsubmit={start} {onclose}
/>
