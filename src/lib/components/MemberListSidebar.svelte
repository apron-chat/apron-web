<script lang="ts">
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { Identity } from '$lib/protocol/types';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { memberSections } from '$lib/ui/members';
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
	import AddMembersDialog from './AddMembersDialog.svelte';
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
	}
	let { client, session, room, open, canChange }: Props = $props();

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
	/** Sections folded away, as the rooms list folds Other threads: a long Offline needn't push the rest out of view. */
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
	let busy = $state(false);
	let note = $state<{ text: string; error: boolean } | undefined>();
	/** Each member as the list shows them, with their status in words: yours as you chose it, an offline one's with when they were last seen. */
	let shown = $derived(sections.map((section): MemberListSection => ({ key: section.key, label: section.label, people: section.people.map(person) })));
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
			you: me
		};
	}

	/** The room's id, which changes only with the room: its record changes (a member added) leave the add form open. */
	let roomId = $derived(room?.id);

	$effect(() => {
		void roomId;
		note = undefined;
		addOpen = false;
	});

	function openAdd(): void {
		note = undefined;
		addOpen = true;
	}

	async function remove(userId: string): Promise<void> {
		if (!client || !room || busy) return;
		const name = directory.name({ user_id: userId });
		if (!confirm(`Remove ${name} from ${room.title}?`)) return;
		busy = true;
		note = undefined;
		try {
			await client.leaveRoom(room.id, userId).promise;
		} catch (cause) {
			note = { text: cause instanceof Error ? cause.message : `Unable to remove ${name}`, error: true };
		} finally {
			busy = false;
		}
	}
</script>

<MemberList
	countTestid="member-count"
	bodyTestid="room-member-list"
	truncatedTestid="member-list-truncated"
	{open}
	room={room?.title}
	count={total}
	sections={room?.members === undefined ? undefined : shown}
	placeholder={!room && session.starting}
	empty={!room ? 'Select a room to see its members.' : session.canManageRooms ? 'Loading members…' : 'Members are unavailable on this server.'}
	shut={[...shut]}
	ontogglesection={toggleSection}
	onprofile={(_, anchor) => openProfileFrom(anchor)}
	onremove={changing ? remove : undefined}
	onadd={changing ? openAdd : undefined}
	{busy}
	{note}
	remark={session.snapshot.memberChangesUnsupported && canChange ? 'This server doesn’t let members add or remove others.' : undefined}
>
	{#snippet avatar(member)}<Avatar name={member.name ?? member.user_id} hue={hueOf(member.user_id)} src={member.avatar} size="sm" status={member.status} statusLabel={member.statusLabel} />{/snippet}
	{#snippet roles(member)}<RoleBadges user={byId.get(member.user_id)} />{/snippet}
</MemberList>
<!-- Gone as soon as adding is: the room left, or the server refusing member changes. -->
{#if addOpen && changing && client && room}
	<!-- An add that settles after the room changed says nothing under the next room's members. -->
	<AddMembersDialog {client} {session} {room} onadded={(roomId, text) => { if (roomId === room?.id) note = { text, error: false }; }} onclose={() => (addOpen = false)} />
{/if}
