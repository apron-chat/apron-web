<script lang="ts">
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId, type Identity } from '$lib/protocol/types';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { memberSections } from '$lib/ui/members';
	import { messageThem, START_FAILED } from '$lib/ui/private-rooms';
	import { failure, Task } from '$lib/ui/task.svelte';
	import { byName } from '$lib/ui/people';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { loadShutMemberSections, saveShutMemberSections } from '$lib/ui/storage';
	import { presenceLabel } from '$lib/design/components/util';
	import MemberList from '$lib/design/components/MemberList.svelte';
	import type { MemberListPerson, MemberListSection } from '$lib/design/components/types';
	import { byStatus, lastSeen, ownStatusLabel, withLastSeen } from '$lib/ui/user-status';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';
	import { addMembersDialog } from './lazy';
	import RoleBadges from './RoleBadges.svelte';

	interface Props {
		client: ChatClient | undefined;
		session: SessionView;
		/** The open pane's room: the thread when one is open, which has its own members. */
		room: RoomSnapshot | undefined;
		open: boolean;
		/**
		 * Offer adding and removing other members (`room_join` and `room_leave`
		 * with `user_id`, §4.2.2): capability `rooms`, signed in with writes allowed, and
		 * the room joined. Who may is server policy; a server that doesn't support
		 * it at all answers `unsupported`, and the offer goes.
		 */
		canChange: boolean;
		/** Offer adding others too: with `add_members` (`ext:permissions`) or without that extension, or in a private room you are a member of. */
		canAdd: boolean;
		/** Offer Direct message, as a profile card's Message: a private room can be started, and opened with `onopenroom`. */
		canMessage?: boolean;
		/** A private room was started here, for the page to open as yours rather than as one someone added you to. */
		onnamed?: (roomId: string) => void;
		onopenroom?: (roomId: string) => void;
		/**
		 * List the members (default): until then a shut list holds none of its rows (its `empty` note in their place), while
		 * the first screen draws. Nobody can see, find or reach them while it's shut.
		 */
		drawRows?: boolean;
	}
	let { drawRows = true, client, session, room, open, canChange, canAdd, canMessage = false, onnamed, onopenroom }: Props = $props();

	/**
	 * Each member's `status` (§4.5) as kept: yours is the one you chose, as the profile bar shows it. Resuming after a
	 * lost connection, the ones from before stay until its listing arrives, then all change over at once: fresh ones
	 * come one by one meanwhile, and the list would reorder with each.
	 */
	function statusOf(person: Identity): string | undefined {
		return directory.statusBeforeResume(person) ?? directory.status(person);
	}
	/**
	 * The room's members, and whether the server has statuses: each the same value across snapshots until it
	 * changes (the client keeps the members' array), unlike `room` and the capabilities, which are new with every
	 * snapshot. Sorting and listing from these, a message or a typing notice doesn't sort a large room again.
	 */
	let roomMembers = $derived(room?.members);
	let hasStatus = $derived(session.capabilities.status);
	/** By status (online, idle, dnd, unknown, offline, then none), and by name within each. */
	let members = $derived(byStatus([...(roomMembers ?? [])].sort(byName), statusOf));
	/** Online, then offline, each in the order above; with no `status` capability (§4.5), one list. */
	let sections = $derived(memberSections(members, statusOf, hasStatus));
	/** Sections folded away, as the rooms list folds Other Threads: a long Offline needn't push the rest out of view. */
	let shut = $state(new Set(loadShutMemberSections()));

	function toggleSection(key: string): void {
		const next = new Set(shut);
		if (!next.delete(key)) next.add(key);
		shut = next;
		saveShutMemberSections([...next]);
	}
	/** A large room's listing may hold only its most recently active members, with the total (§4.2.1). */
	let total = $derived(room?.members === undefined ? undefined : Math.max(room.memberCount ?? 0, room.members.length));
	let changing = $derived(canChange && !session.snapshot.memberChangesUnsupported && Boolean(client) && Boolean(room?.joined));
	/** The add form is open: it opens from the header's plus, since most visits are to see who is here. */
	let addOpen = $state(false);
	/** Messaging or removing someone, and what came of it: this room's, until the panel shows another. */
	const task = new Task();
	/** Each member as the list shows them, with their status in words: yours as you chose it, an offline one's with when they were last seen. */
	let shown = $derived(sections.map((section): MemberListSection => ({ key: section.key, label: section.label, people: section.people.map(person) })));
	/** What the list shows: none before the room's listing has come, nor before it draws its rows (`drawRows`). */
	let listing = $derived(roomMembers === undefined || !drawRows ? undefined : shown);
	/** The members by `user_id`, for their role badges. */
	let byId = $derived(new Map(members.map((member) => [member.user_id, member])));

	function person(member: Identity): MemberListPerson {
		const me = directory.isMe(member.user_id);
		const status = statusOf(member);
		// `seen` (§4.5.2) only while they show offline, never yours: in the row's tooltip, after "Offline". Redone each minute.
		// Only as the row shows them: one still shown as before a resume (`statusOf`) isn't offline yet here.
		const seen = status === 'offline' ? directory.seen(member) : undefined;
		const last = seen === undefined ? undefined : lastSeen(seen, minuteNow());
		return {
			user_id: member.user_id,
			name: directory.name(member),
			avatar: directory.avatar(member),
			status,
			statusLabel: (me ? ownStatusLabel(status) : undefined) ?? withLastSeen(presenceLabel(status), last),
			handle: directory.sharesName(member),
			you: me,
			...(isSystemId(member.user_id) ? { system: true } : {})
		};
	}

	/** The room's id, which changes only with the room: its record changes (a member added) leave the add form open. */
	let roomId = $derived(room?.id);

	$effect(() => {
		void roomId;
		task.reset();
		addOpen = false;
	});

	function openAdd(): void {
		task.note = undefined;
		addOpen = true;
	}

	/**
	 * Direct message: the private conversation you have with them, else one started (`messageUser`), opened. A failure,
	 * or one started that couldn't add them (kept under Private), says so in the panel.
	 */
	async function message(userId: string): Promise<void> {
		if (!client || !onopenroom) return;
		const chat = client;
		const open = onopenroom;
		// Started at the reader's asking: it opens, wherever they are now.
		await task.run('busy', () => messageThem(chat, session.rooms, session.you?.user_id, userId, { named: onnamed, name: (failed) => directory.name({ user_id: failed }), open }), {
			done: (kept) => (kept ? { text: kept, error: true } : undefined),
			failed: failure(START_FAILED)
		});
	}

	async function remove(userId: string): Promise<void> {
		if (!client || !room || task.busy) return;
		const chat = client;
		const target = room;
		const name = directory.name({ user_id: userId });
		if (!confirm(`Remove ${name} from ${target.title}?`)) return;
		await task.run('busy', () => chat.leaveRoom(target.id, userId).promise, { failed: failure(`Unable to remove ${name}`) });
	}
</script>

<MemberList
	countTestid="member-count"
	bodyTestid="room-member-list"
	truncatedTestid="member-list-truncated"
	{open}
	room={room?.title}
	count={total}
	sections={listing}
	placeholder={!room && session.starting}
	empty={!room ? 'Select a room to see its members.' : session.canManageRooms ? 'Loading members…' : 'Members are unavailable on this server.'}
	shut={[...shut]}
	ontogglesection={toggleSection}
	onprofile={(_, anchor) => openProfileFrom(anchor)}
	onmessage={canMessage && client && onopenroom ? message : undefined}
	onremove={changing ? remove : undefined}
	onadd={changing && canAdd ? openAdd : undefined}
	busy={task.busy}
	note={task.note}
	remark={session.snapshot.memberChangesUnsupported && canChange ? 'This server doesn’t let members add or remove others.' : undefined}
>
	{#snippet avatar(member)}<Avatar name={member.name ?? member.user_id} hue={hueOf(member.user_id)} src={member.avatar} size="sm" status={member.status} statusLabel={member.statusLabel} />{/snippet}
	{#snippet roles(member)}<RoleBadges user={byId.get(member.user_id)} />{/snippet}
</MemberList>
<!-- Gone as soon as adding is: the room left, or the server refusing member changes. -->
{#if addOpen && changing && client && room && addMembersDialog.component}
	{@const AddMembersDialog = addMembersDialog.component}
	<AddMembersDialog {client} {session} {room} onclose={() => (addOpen = false)} />
{/if}
