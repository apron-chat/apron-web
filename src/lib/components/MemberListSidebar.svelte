<script lang="ts">
	import { tick } from 'svelte';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { Identity } from '$lib/protocol/types';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { memberSections, userIdToAdd } from '$lib/ui/members';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { loadShutMemberSections, saveShutMemberSections } from '$lib/ui/storage';
	import { presenceLabel } from '$lib/design/components/util';
	import AddMemberForm from '$lib/design/components/AddMemberForm.svelte';
	import MemberList from '$lib/design/components/MemberList.svelte';
	import type { MemberListPerson, MemberListSection } from '$lib/design/components/types';
	import { byStatus, lastSeen, ownStatusLabel, withLastSeen } from '$lib/ui/user-status';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';
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
	let members = $derived(byStatus([...(roomMembers ?? [])].sort((a, b) =>
		directory.name(a).localeCompare(directory.name(b), undefined, { sensitivity: 'base' }) || a.user_id.localeCompare(b.user_id)
	), statusOf));
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
	/** People this client knows of who aren't members yet, suggested by `user_id` when adding someone. */
	let candidates = $derived.by(() => {
		const current = new Set((room?.members ?? []).map((member) => member.user_id));
		return Object.values(session.snapshot.users).filter((user) => !current.has(user.user_id) && !user.user_id.startsWith('~'));
	});
	let adding = $state('');
	/** The add form is open: it opens from the header's plus, since most visits are to see who is here. */
	let addOpen = $state(false);
	let busy = $state(false);
	let note = $state<{ text: string; error: boolean } | undefined>();
	let list = $state<MemberList | undefined>();
	let form = $state<AddMemberForm | undefined>();
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

	$effect(() => {
		void room?.id;
		note = undefined;
		adding = '';
		addOpen = false;
	});

	async function toggleAdd(): Promise<void> {
		addOpen = !addOpen;
		if (!addOpen) return;
		note = undefined;
		await tick();
		form?.focus();
	}

	function closeAdd(): void {
		addOpen = false;
		adding = '';
		list?.focusAddToggle();
	}

	async function add(): Promise<void> {
		const userId = userIdToAdd(adding);
		if (!userId) {
			note = { text: 'Enter the person’s @user_id: names aren’t unique.', error: true };
			return;
		}
		if (!client || !room || busy) return;
		busy = true;
		note = undefined;
		try {
			await client.joinRoom(room.id, userId).promise;
			note = { text: `Added ${directory.name({ user_id: userId })}.`, error: false };
			closeAdd();
		} catch (cause) {
			note = { text: cause instanceof Error ? cause.message : 'Unable to add them', error: true };
		} finally {
			busy = false;
		}
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
	bind:this={list}
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
	onaddtoggle={changing ? toggleAdd : undefined}
	{addOpen}
	{busy}
	{note}
	remark={session.snapshot.memberChangesUnsupported && canChange ? 'This server doesn’t let members add or remove others.' : undefined}
>
	{#snippet addForm(id)}
		<AddMemberForm bind:this={form} {id} bind:value={adding} candidates={candidates.map((user) => ({ user_id: user.user_id, name: directory.name(user) }))} {busy} onadd={add} ondismiss={closeAdd} />
	{/snippet}
	{#snippet avatar(member)}<Avatar name={member.name ?? member.user_id} hue={hueOf(member.user_id)} src={member.avatar} size="sm" status={member.status} statusLabel={member.statusLabel} />{/snippet}
	{#snippet roles(member)}<RoleBadges user={byId.get(member.user_id)} />{/snippet}
</MemberList>
