<script lang="ts">
	import type { RoomSnapshot } from '$lib/protocol/client';
	import { markdownText } from '$lib/protocol/markdown';
	import DesignRoomHeader from '$lib/design/components/RoomHeader.svelte';
	import { presenceLabel } from '$lib/design/components/util';
	import { directory } from '$lib/ui/directory.svelte';
	import { roomFaces } from '$lib/ui/faces';
	import { pausedUntilLabel, roomMuteChoices, type PausedUntil } from '$lib/ui/pause';
	import { privateRoomLine } from '$lib/ui/private-rooms';

	interface Props {
		/** The top-level room. */
		room: RoomSnapshot;
		/** The room whose history the header reports on: the open thread, else the room. */
		pane: RoomSnapshot;
		/** Show the room's description under its title: off while it's pinned under the header as a description. */
		showTopic?: boolean;
		/** The open thread's title; undefined in the room view. */
		threadTitle?: string;
		/** Names typing in this room, other than the viewer. */
		typing: string[];
		/** Replies in the open thread, once its history has loaded. */
		replyCount?: number;
		/** Older replies are not loaded yet, so `replyCount` is a lower bound. */
		moreReplies?: boolean;
		/** The pane's history waits, as the server asked (`retry_after`): "Waiting" in place of a failure. The timeline's notice counts it down. */
		waiting?: boolean;
		/** Offer Edit for the room, or the open thread (capability `rooms`): its title and description. */
		canEdit: boolean;
		/** Join and the actions menu can't be used now, such as while a request is in flight. */
		editDisabled: boolean;
		/** Offer Leave for the pane's room or thread (capability `rooms`). */
		canLeave: boolean;
		/** Offer Join for a thread open without joining it (capability `rooms`). */
		canJoin?: boolean;
		/** Whether the room member list is visible. */
		memberListOpen: boolean;
		/**
		 * Offer the member list's toggle here, where the list overlays the
		 * conversation; a member list with a column of its own has its toggle
		 * in the window's corner instead.
		 */
		memberListToggle?: boolean;
		/** Unread messages in the other rooms and threads, and how many mention you, as the rooms list counts them. */
		unreadElsewhere?: number;
		mentionsElsewhere?: number;
		onback: () => void;
		onroom: () => void;
		onedit: () => void;
		onleave: () => void;
		/** Copies a link to the open room or thread that any Apron app opens (Appendix A.4); resolves with whether it did. */
		oncopylink?: () => Promise<boolean>;
		onjoin?: () => void;
		/**
		 * Offer Mute for the pane's room or thread (capability `status`, §4.5 `mute` with its `room_id`), for a
		 * while or until unmuted; while it's muted (`pane.mutedUntil`), Unmute (`onmute(false)`) instead.
		 */
		onmute?: (until: PausedUntil | false) => void;
		onmemberlist: () => void;
		/** The room's or thread's description was put away with its ×: a Description button brings it back. */
		ondescription?: () => void;
	}
	let {
		room, pane, showTopic = true, threadTitle, typing, replyCount, moreReplies = false, waiting = false, canEdit, editDisabled, canLeave, canJoin = false,
		memberListOpen, memberListToggle = true, unreadElsewhere = 0, mentionsElsewhere = 0, onback, onroom, onedit, onleave, oncopylink, onjoin, onmute, onmemberlist, ondescription
	}: Props = $props();

	/** Mutes the pane for the chosen while, from when it's chosen. */
	function mute(value: string): void {
		const choice = roomMuteChoices().find((entry) => entry.value === value);
		if (choice) onmute?.(choice.until);
	}

	/** A copied link says so under the title for a moment, as the message's Copy link does on its button. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	async function copyLink(): Promise<void> {
		if (!(await oncopylink?.())) return;
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 2000);
	}
	$effect(() => () => clearTimeout(copiedTimer));

	/** The room's description (§3.4) as one line of text under its title, once its pinned description is put away; a thread has only its description. */
	let topic = $derived(showTopic && threadTitle === undefined && room.description ? markdownText(room.description).split('\n')[0] : '');
	let thread = $derived(threadTitle !== undefined);
	/**
	 * An untitled private room, named for its members (not in a thread): who it's with before its name, and who can
	 * see it under it, with the one other person's status, in place of a description it has none of.
	 */
	let people = $derived(room.namedForMembers && !thread ? (room.members ?? []).filter((member) => !directory.isMe(member.user_id)) : undefined);
	let faces = $derived(people ? roomFaces(room, directory.you) : undefined);
	let muted = $derived(pane.mutedUntil === undefined ? undefined : pane.mutedUntil === true ? 'until you unmute' : pausedUntilLabel(pane.mutedUntil));
	let line = $derived(people ? privateRoomLine(people.map((member) => directory.name(member)), people.length === 1 ? presenceLabel(directory.status(people[0])) : undefined) : '');
</script>

<!-- The design system's RoomHeader draws it; the app says which of its buttons apply. Recovering or loading shows at the foot of the timeline (TimelineLoading), where the new messages will appear. -->
<DesignRoomHeader
	room={room.id}
	name={room.title}
	topic={topic || line}
	topicTitle={topic ? room.description : undefined}
	private={pane.private}
	{faces}
	{typing}
	replies={replyCount !== undefined ? { count: replyCount, more: moreReplies } : undefined}
	note={copied ? 'Link copied' : waiting ? 'Waiting' : pane.recoveryError ? 'History unavailable' : undefined}
	{onback}
	{unreadElsewhere}
	{mentionsElsewhere}
	thread={thread ? pane.id : undefined}
	threadName={thread && pane.untitled ? undefined : threadTitle}
	{onroom}
	{canJoin}
	{onjoin}
	onmemberlist={memberListToggle ? onmemberlist : undefined}
	{memberListOpen}
	onedit={canEdit ? onedit : undefined}
	onleave={canLeave ? onleave : undefined}
	oncopylink={oncopylink ? copyLink : undefined}
	muteChoices={onmute ? roomMuteChoices : undefined}
	onmute={onmute ? mute : undefined}
	{muted}
	onunmute={onmute ? () => onmute(false) : undefined}
	busy={editDisabled}
	{ondescription}
	tagTestid="back-unread"
	topicTestid="room-description"
	joinTestid="join-room"
	descriptionTestid="show-description"
	actionsTestid="room-actions"
	editTestid="edit-room"
	leaveTestid="leave-room"
	copyLinkTestid="copy-room-link"
	muteTestid="mute-room"
	unmuteTestid="unmute-room"
/>
