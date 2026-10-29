<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Bell from '@lucide/svelte/icons/bell';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Pencil from '@lucide/svelte/icons/pencil';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import Users from '@lucide/svelte/icons/users';
	import type { ClassValue } from 'svelte/elements';
	import Faces from './Faces.svelte';
	import MenuButton from './MenuButton.svelte';
	import type { Face, MenuChoice } from './types';
	import { count99, roomName, roomNameTip } from './util';

	interface Props {
		room: string;
		/** the room record's `title`, falling back to `room_id` (§3.4) */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** The topic's tooltip, such as the whole description it's the first line of. */
		topicTitle?: string;
		/** `private: true` (§4.2.4) on the open room or thread: a lock beside its name, on a plum wash */
		private?: boolean;
		/** Who a private room is with, before its name (not in a thread): one person's face with their status, or two of a group's (Faces). */
		faces?: Face[];
		/** names from live `activity` typing; replaces the subtitle while present, on phones only (wide layouts show a <TypingIndicator> above the composer) */
		typing?: string[];
		/** An open thread's replies, once its history has loaded, in place of the topic; `more`: older ones aren't loaded, so the count is a lower bound ("12+ replies"). */
		replies?: { count: number; more?: boolean };
		/** A short status after the title, such as "History unavailable". */
		note?: string;
		/** Phones: a ‹ back to the rooms list. */
		onback?: () => void;
		/** Unread messages in the other rooms and threads, and how many mention you: the ‹ becomes the point of a tag holding the count, grey, or orange with an @ for a mention, as in the rooms list. */
		unreadElsewhere?: number;
		mentionsElsewhere?: number;
		/** A thread is open in the main pane: shows `Parent › Thread`; the parent's title goes back via onroom. */
		thread?: string;
		/** The thread's `title`; without one it's called "Untitled", with its `room_id` on hover. */
		threadName?: string;
		onroom?: () => void;
		/** Cap `rooms`, for a room or thread open without joining it: a Join button, which calls `onjoin` (`room_join`, §4.2.2). */
		canJoin?: boolean;
		onjoin?: () => void;
		/** The member list's toggle, where the list overlays the conversation; pressed while it's open. */
		onmemberlist?: () => void;
		memberListOpen?: boolean;
		/** Cap `rooms`: Edit room (or thread) in the ⋯ actions menu, which opens a <RoomForm> dialog, for a room's or thread's title and description. */
		onedit?: () => void;
		/** Cap `rooms`: Leave room (or thread) in the ⋯ actions menu (`room_leave`, §4.2.2). */
		onleave?: () => void;
		/** Move up, Move down in the ⋯ actions menu: the room's place in the rooms list, one step, where it can go that way. */
		onmoveup?: () => void;
		onmovedown?: () => void;
		/** Copy link to room (or thread) in the ⋯ actions menu: a link that any Apron app opens (Appendix A.4). */
		oncopylink?: () => void;
		/**
		 * Cap `status`: Mute room (or thread) in the ⋯ actions menu (§4.5 `mute` with its `room_id`), a submenu of
		 * how long, such as "For 1 hour"; `onmute` gets the chosen value. Worked out as the menu opens, so each
		 * choice's hint can say when it would end.
		 */
		muteChoices?: () => MenuChoice[];
		onmute?: (value: string) => void;
		/**
		 * The room or thread is muted: when that ends, such as "until 14:30". A bell-off button left of the ⋯ menu
		 * says so and unmutes it, and the menu offers Unmute in place of Mute.
		 */
		muted?: string;
		/** Unmute room (or thread), from the bell-off button and the ⋯ actions menu, while `muted`. */
		onunmute?: () => void;
		/** In a thread, `muted` only by its room's mute, which covers its threads: Unmute names the room, and unmutes it. */
		mutedWithRoom?: boolean;
		/** A request in flight: Join and the actions menu can't be used. */
		busy?: boolean;
		/** The room's or thread's pinned <ThreadDescription> was put away with its ×: a Description button brings it back. */
		ondescription?: () => void;
		/** `data-testid`s for its parts: the ‹'s tag of what's new elsewhere, the topic, Join, Description, the bell-off Unmute button, the ⋯ menu and its Edit, Leave, Copy link, Mute and Unmute. */
		tagTestid?: string;
		topicTestid?: string;
		joinTestid?: string;
		descriptionTestid?: string;
		actionsTestid?: string;
		editTestid?: string;
		leaveTestid?: string;
		copyLinkTestid?: string;
		muteTestid?: string;
		unmuteTestid?: string;
		unmuteButtonTestid?: string;
		/** Classes for its `<header>`, added to its own. */
		class?: ClassValue;
	}
	let {
		room, name, topic, topicTitle, private: isPrivate, faces, typing = [], replies, note, onback, unreadElsewhere = 0, mentionsElsewhere = 0,
		thread, threadName, onroom, canJoin = false, onjoin, onmemberlist, memberListOpen = false, onedit, onleave, onmoveup, onmovedown, oncopylink, muteChoices, onmute, muted, onunmute, mutedWithRoom = false, busy = false,
		ondescription, tagTestid, topicTestid, joinTestid, descriptionTestid, actionsTestid, editTestid, leaveTestid, copyLinkTestid, muteTestid, unmuteTestid,
		unmuteButtonTestid, class: className
	}: Props = $props();
	const noun = $derived(thread ? 'thread' : 'room');
	/** What Unmute unmutes: this room or thread, or the room whose mute silences this thread. */
	const unmuteNoun = $derived(thread && mutedWithRoom ? 'room' : noun);
	/** What's new elsewhere: a mention may be an edit adding you to a read message, so it counts at least once. */
	const elsewhere = $derived(Math.max(unreadElsewhere, mentionsElsewhere));
	const backLabel = $derived(elsewhere
		? `Back to rooms, ${elsewhere} unread ${elsewhere === 1 ? 'message' : 'messages'}${mentionsElsewhere ? `, ${mentionsElsewhere === 1 ? 'a mention' : `${mentionsElsewhere} mentions`} of you` : ''}`
		: 'Back to rooms');
	/** The ⋯ menu is open: Mute's choices are worked out again as it opens, so their hints say when each would end. */
	let actionsOpen = $state(false);
	const muteMenu = $derived.by(() => {
		void actionsOpen;
		return muteChoices?.().map((choice) => ({ ...choice, value: `mute:${choice.value}` }));
	});
	/** The occasional actions, in the ⋯ menu: Join stays a button, since it's what a pane read without joining is for. */
	const actions = $derived<MenuChoice[]>([
		...(oncopylink ? [{ value: 'link', label: `Copy link to ${noun}`, testid: copyLinkTestid }] : []),
		...(muted !== undefined && onunmute ? [{ value: 'unmute', label: `Unmute ${unmuteNoun}`, hint: muted, testid: unmuteTestid }] : []),
		...(muted === undefined && muteMenu && onmute ? [{ value: 'mute', label: `Mute ${noun}`, testid: muteTestid, choices: muteMenu }] : []),
		...(onedit ? [{ value: 'edit', label: `Edit ${noun}`, testid: editTestid }] : []),
		...(onmoveup ? [{ value: 'up', label: 'Move up in sidebar' }] : []),
		...(onmovedown ? [{ value: 'down', label: 'Move down in sidebar' }] : []),
		...(onleave ? [{ value: 'leave', label: `Leave ${noun}`, testid: leaveTestid }] : [])
	]);
	const memberLabel = $derived(memberListOpen ? 'Hide member list' : 'Show member list');

	function act(value: string): void {
		if (value === 'link') oncopylink?.();
		else if (value === 'edit') onedit?.();
		else if (value === 'leave') onleave?.();
		else if (value === 'up') onmoveup?.();
		else if (value === 'down') onmovedown?.();
		else if (value === 'unmute') onunmute?.();
		else if (value.startsWith('mute:')) onmute?.(value.slice('mute:'.length));
	}
</script>

<header class={['ap-roomhead', isPrivate && 'ap-roomhead-private', className]}>
	{#if onback}
		<button type="button" class={['ap-iconbtn', 'ap-iconbtn-lg', 'ap-roomhead-back', elsewhere > 0 && 'ap-roomhead-back-tagged']} aria-label={backLabel} onclick={onback}>
			{#if elsewhere > 0}<span class={['ap-roomhead-tag', mentionsElsewhere ? 'ap-roomhead-tag-at' : 'ap-roomhead-tag-quiet']} data-testid={tagTestid} aria-hidden="true">{#if mentionsElsewhere}@&#8239;{/if}{count99(elsewhere)}</span>{:else}<ChevronLeft size={20} aria-hidden="true" />{/if}
		</button>
	{/if}
	{#if faces?.length && !thread}<Faces people={faces} size="sm" class="ap-roomhead-faces" />{/if}
	<div class="ap-roomhead-text">
		{#if thread}
			<!-- The spaces around the separator are the title's, in its weight, and the separator's own collapse into them. -->
			<h1 class="ap-roomhead-name">
				<button type="button" class="ap-roomhead-crumb" aria-label="Back to room" onclick={onroom}>{roomName(name, room)}</button>
				<span class="ap-roomhead-sep" aria-hidden="true"> › </span>
				<bdi title={roomNameTip(threadName, thread, { thread: true })}>{roomName(threadName, thread, { thread: true })}</bdi>{#if isPrivate}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}
			</h1>
		{:else}
			<h1 class="ap-roomhead-name">{roomName(name, room)}{#if isPrivate}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</h1>
		{/if}
		{#if typing.length}
			<p class="ap-roomhead-sub ap-roomhead-typing">{#if typing.length === 1}<bdi>{typing[0]}</bdi> is typing…{:else}{typing.length} people are typing…{/if}</p>
		{:else if replies}
			<p class="ap-roomhead-sub">{replies.count}{replies.more ? '+' : ''} {replies.count === 1 && !replies.more ? 'reply' : 'replies'}</p>
		{:else if topic}
			<p class="ap-roomhead-sub" data-testid={topicTestid} title={topicTitle}>{topic}</p>
		{/if}
	</div>
	{#if note}<span class="ap-roomhead-sub" role="status">{note}</span>{/if}
	{#if canJoin}
		<button type="button" class="ap-btn ap-btn-sm" data-testid={joinTestid} aria-label="Join {noun}" title={thread ? 'Get its replies live, and list it under the room' : 'Get its messages live, and list it with your rooms'} disabled={busy} onclick={onjoin}>Join</button>
	{/if}
	{#if onmemberlist}
		<button type="button" class={['ap-iconbtn', 'ap-roomhead-members', memberListOpen && 'ap-iconbtn-on']} aria-label={memberLabel} aria-expanded={memberListOpen} title={memberLabel} onclick={onmemberlist}>
			<Users size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	{#if ondescription}
		<button type="button" class="ap-btn ap-btn-sm ap-btn-ghost ap-roomhead-description" data-testid={descriptionTestid} aria-label="Show the {noun} description" title="Show the {noun} description" onclick={ondescription}>
			<TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /><span class="ap-roomhead-description-word">Description</span>
		</button>
	{/if}
	{#if muted !== undefined && onunmute}
		<button type="button" class="ap-iconbtn ap-roomhead-unmute" data-testid={unmuteButtonTestid} aria-label="Unmute {unmuteNoun}" title="Muted{unmuteNoun !== noun ? ' with its room' : ''} {muted}. Unmute {unmuteNoun}" onclick={onunmute}>
			<BellOff size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	{#if actions.length > 0}
		<MenuButton label={thread ? 'Thread actions' : 'Room actions'} buttonTestid={actionsTestid} choices={actions} disabled={busy} onselect={act} bind:open={actionsOpen}>
			{#snippet icon()}<Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />{/snippet}
			{#snippet lead(value)}{#if value === 'edit'}<Pencil size={15} aria-hidden="true" />{:else if value === 'mute'}<BellOff size={15} aria-hidden="true" />{:else if value === 'unmute'}<Bell size={15} aria-hidden="true" />{:else if value === 'up'}<ArrowUp size={15} aria-hidden="true" />{:else if value === 'down'}<ArrowDown size={15} aria-hidden="true" />{:else}<LogOut size={15} aria-hidden="true" />{/if}{/snippet}
		</MenuButton>
	{/if}
</header>
