<script lang="ts">
	import Bell from '@lucide/svelte/icons/bell';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Link from '@lucide/svelte/icons/link';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Search from '@lucide/svelte/icons/search';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import * as icons from './Icons.svelte';
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
		/** Unread messages in the other rooms and threads, and how many mention you: the ‹ becomes the point of a tag holding the count, ink, or orange with an @ for a mention, as in the rooms list. */
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
		/** Cap `rooms`: Edit room (or thread) in the ⋯ actions menu, for a room's or thread's title and description where its description reads (DescriptionSheet). */
		onedit?: () => void;
		/** Cap `rooms`: Leave room (or thread) in the ⋯ actions menu (`room_leave`, §4.2.2). */
		onleave?: () => void;
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
		/** Other rooms are still catching up, with this one shown as it is: a thin moving line along its foot. */
		updating?: boolean;
		/** Search local history, first in the ⋯ actions menu: it opens a <SearchPanel>. `searchHint` names its shortcut, as the item's hint. */
		onsearch?: () => void;
		searchHint?: string;
		/** Keyboard shortcuts, after Search in the ⋯ menu, with `?` as its hint: it opens their overlay (KeyboardShortcuts). */
		onshortcuts?: () => void;
		/**
		 * The room's or thread's pinned <ThreadDescription> was put away with its ×: a Description button brings it back,
		 * as does a click anywhere on the name and topic (but not on the thread's crumb back to its room). Called with the
		 * click, whose `detail` is 0 when the keyboard pressed Description.
		 */
		ondescription?: (event: MouseEvent) => void;
		/** The description put away has been edited since: Description is drawn in the description's blue, quietly enough to leave. */
		descriptionUpdated?: boolean;
		/** An edit of the description is kept as a draft, not saved yet: Description (or Edit, reading it) carries a dot. */
		descriptionDraft?: boolean;
		/**
		 * The description shows over the pane (DescriptionSheet), to read: Edit (`onedit`, cap `rooms`) and × (`onclose`) in
		 * place of the topic, Description, Join, the member list's toggle, the bell-off button and the ⋯ menu. A click on
		 * the name shuts it too, as one there opened it (`ondescription`, which the caller then passes as what shuts it).
		 */
		reading?: { onedit?: () => void; onclose: (event: MouseEvent) => void };
		/**
		 * The description shows over the pane being edited: the title is a field (`title`, typed through `ontitle`), on the
		 * left edge of the editor's column below it and half its width, a name not a paragraph; Unsaved draft beside it while
		 * the edit is a `draft`; Cancel and Save in place of the rest, the back arrow and the member list's toggle out of the
		 * way. Enter in the field saves, Escape cancels; nothing can be used while it is `saving`, and Save not while it is
		 * `disabled` (the session can't take requests). Why the last save failed (`error`) shows in place of Unsaved draft.
		 */
		editing?: { title: string; ontitle: (title: string) => void; draft: boolean; saving: boolean; disabled?: boolean; error?: string; onsave: () => void; oncancel: () => void };
		/** `data-testid`s for its parts: the ‹'s tag of what's new elsewhere, the topic, Join, Description, the bell-off Unmute button, the ⋯ menu and its Search, Edit, Leave, Copy link, Mute and Unmute. */
		tagTestid?: string;
		topicTestid?: string;
		joinTestid?: string;
		descriptionTestid?: string;
		actionsTestid?: string;
		editTestid?: string;
		leaveTestid?: string;
		copyLinkTestid?: string;
		searchTestid?: string;
		muteTestid?: string;
		unmuteTestid?: string;
		unmuteButtonTestid?: string;
		/** Classes for its `<header>`, added to its own. */
		class?: ClassValue;
	}
	let {
		room, name, topic, topicTitle, private: isPrivate, faces, typing = [], replies, note, onback, unreadElsewhere = 0, mentionsElsewhere = 0,
		thread, threadName, onroom, canJoin = false, onjoin, onmemberlist, memberListOpen = false, onedit, onleave, oncopylink, muteChoices, onmute, muted, onunmute, mutedWithRoom = false, busy = false, updating = false, onsearch, searchHint, onshortcuts,
		ondescription, descriptionUpdated = false, descriptionDraft = false, reading, editing, tagTestid, topicTestid, joinTestid, descriptionTestid, actionsTestid, editTestid, leaveTestid, copyLinkTestid, searchTestid, muteTestid, unmuteTestid,
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
		...(onsearch ? [{ value: 'search', label: 'Search local history', ...(searchHint ? { hint: searchHint } : {}), testid: searchTestid }] : []),
		...(onshortcuts ? [{ value: 'shortcuts', label: 'Keyboard shortcuts', hint: '?' }] : []),
		...(oncopylink ? [{ value: 'link', label: `Copy link to ${noun}`, testid: copyLinkTestid }] : []),
		...(muted !== undefined && onunmute ? [{ value: 'unmute', label: `Unmute ${unmuteNoun}`, hint: muted, testid: unmuteTestid }] : []),
		...(muted === undefined && muteMenu && onmute ? [{ value: 'mute', label: `Mute ${noun}`, testid: muteTestid, choices: muteMenu }] : []),
		...(onedit ? [{ value: 'edit', label: `Edit ${noun}`, testid: editTestid }] : []),
		...(onleave ? [{ value: 'leave', label: `Leave ${noun}`, testid: leaveTestid }] : [])
	]);
	const memberLabel = $derived(memberListOpen ? 'Hide member list' : 'Show member list');

	/** A click on the name or topic brings the description back, unless it was on a button in it or ended a selection of its text. */
	/**
	 * A click on the name or topic is `ondescription`'s: it shows the description, and, while it reads over the pane, the
	 * caller passes what shuts it. Not a click on a button or link in it (a thread's crumb back to its room), nor one
	 * that ends a selection of its text.
	 */
	function openDescription(event: MouseEvent): void {
		if (!ondescription || (event.target as Element).closest('button, a')) return;
		if (!(window.getSelection()?.isCollapsed ?? true)) return;
		ondescription(event);
	}

	/** In the title being edited, Enter saves and Escape cancels, as in a form. */
	function titleKey(event: KeyboardEvent): void {
		if (!editing || event.isComposing) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			if (!editing.disabled) editing.onsave();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			editing.oncancel();
		}
	}
	/** Over the pane, the description holds the header: its own buttons in place of the room's. */
	const sheet = $derived(Boolean(reading || editing));

	function act(value: string): void {
		if (value === 'search') onsearch?.();
		else if (value === 'shortcuts') onshortcuts?.();
		else if (value === 'link') oncopylink?.();
		else if (value === 'edit') onedit?.();
		else if (value === 'leave') onleave?.();
		else if (value === 'unmute') onunmute?.();
		else if (value.startsWith('mute:')) onmute?.(value.slice('mute:'.length));
	}
</script>

<header class={['ap-roomhead', isPrivate && 'ap-roomhead-private', className]}>
	{#if onback && !editing}
		<button type="button" class={['ap-iconbtn', 'ap-iconbtn-lg', 'ap-roomhead-back', elsewhere > 0 && 'ap-roomhead-back-tagged']} aria-label={backLabel} onclick={onback}>
			{#if elsewhere > 0}<span class={['ap-roomhead-tag', 'ap-pill', mentionsElsewhere ? 'ap-roomhead-tag-at' : 'ap-roomhead-tag-quiet']} data-testid={tagTestid} aria-hidden="true">{#if mentionsElsewhere}@&#8239;{/if}{count99(elsewhere)}</span>{:else}<ChevronLeft size={20} aria-hidden="true" />{/if}
		</button>
	{/if}
	{#if faces?.length && !thread && !editing}<Faces people={faces} size="sm" class="ap-roomhead-faces" />{/if}
	{#if editing}
		<div class="ap-roomhead-edit">
			{#if thread}
				<button type="button" class="ap-roomhead-crumb" aria-label="Back to room" disabled={editing.saving} onclick={onroom}>{roomName(name, room)}</button>
				<span class="ap-roomhead-sep" aria-hidden="true"> › </span>
			{/if}
			<input class="ap-field ap-roomhead-title" aria-label={thread ? 'Thread title' : 'Room title'} value={editing.title} oninput={(event) => editing.ontitle(event.currentTarget.value)} onkeydown={titleKey}
				disabled={editing.saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto" />
			{#if editing.error}<span class="ap-roomhead-error" role="alert">{editing.error}</span>
			{:else if editing.draft}<span class="ap-roomhead-draft" title="Kept on this device until you save or discard it"><span class="ap-roomhead-draft-word">Unsaved draft</span></span>{/if}
		</div>
	{:else}
	<!-- Clicking the name or topic opens the description, and shuts it again: a shortcut for the mouse; Description and × are the buttons for the keyboard and screen readers. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class={['ap-roomhead-text', ondescription && 'ap-roomhead-text-opens']} title={ondescription ? `${sheet ? 'Close' : 'Show'} the ${noun} description` : undefined} onclick={ondescription ? openDescription : undefined}>
		{#if thread}
			<!-- The spaces around the separator are the title's, in its weight, and the separator's own collapse into them. -->
			<h1 class="ap-roomhead-name">
				<button type="button" class="ap-roomhead-crumb" aria-label="Back to room" onclick={onroom}>{roomName(name, room)}</button>
				<span class="ap-roomhead-sep" aria-hidden="true"> › </span>
				<bdi title={roomNameTip(threadName, thread, { thread: true })}>{roomName(threadName, thread, { thread: true })}</bdi>{#if isPrivate}<Lock class="ap-lock ap-inline-icon" role="img" aria-label="Private" />{/if}
			</h1>
		{:else}
			<h1 class="ap-roomhead-name">{roomName(name, room)}{#if isPrivate}<Lock class="ap-lock ap-inline-icon" role="img" aria-label="Private" />{/if}</h1>
		{/if}
		<!-- Over the pane the description shows itself: no topic, count or typing here. -->
		{#if !sheet}
		{#if typing.length}
			<p class="ap-roomhead-sub ap-roomhead-typing">{#if typing.length === 1}<bdi>{typing[0]}</bdi> is typing…{:else}{typing.length} people are typing…{/if}</p>
		{:else if replies}
			<p class="ap-roomhead-sub">{replies.count}{replies.more ? '+' : ''} {replies.count === 1 && !replies.more ? 'reply' : 'replies'}</p>
		{:else if topic}
			<p class="ap-roomhead-sub" data-testid={topicTestid} title={topicTitle}>{topic}</p>
		{/if}
		{/if}
	</div>
	{/if}
	{#if note && !sheet}<span class="ap-roomhead-sub" role="status">{note}</span>{/if}
	{#if editing}
		<span class="ap-roomhead-actions">
			<button type="button" class="ap-btn ap-btn-sm ap-btn-ghost" disabled={editing.saving} onclick={editing.oncancel}>Cancel</button>
			<button type="button" class="ap-btn ap-btn-sm ap-btn-primary" disabled={editing.saving || editing.disabled} onclick={editing.onsave}>{editing.saving ? 'Saving…' : 'Save'}</button>
		</span>
	{:else if reading}
		{#if reading.onedit}
			<button type="button" class="ap-btn ap-btn-sm ap-btn-ghost ap-roomhead-description" aria-label="Edit {noun}{descriptionDraft ? ', unsaved draft' : ''}" title={descriptionDraft ? 'Edit (your unsaved draft)' : `Edit the ${noun}'s title and description`} onclick={reading.onedit}>
				{@render icons.pencil()}<span class="ap-roomhead-description-word">Edit</span>{#if descriptionDraft}<span class="ap-roomhead-dot" aria-hidden="true"></span>{/if}
			</button>
		{/if}
	{/if}
	{#if ondescription && !sheet}
		<button type="button" class={['ap-btn', 'ap-btn-sm', 'ap-btn-ghost', 'ap-roomhead-description', 'ap-roomhead-show', descriptionUpdated && 'ap-roomhead-description-updated']} data-testid={descriptionTestid} aria-label="Show the {noun} description{descriptionUpdated ? ', updated since you hid it' : ''}{descriptionDraft ? ', unsaved draft' : ''}" title="Show the {noun} description{descriptionUpdated ? ' (updated since you hid it)' : ''}" onclick={ondescription}>
			<TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /><span class="ap-roomhead-description-word">Description</span>{#if descriptionDraft}<span class="ap-roomhead-dot" aria-hidden="true"></span>{/if}
		</button>
	{/if}
	<!-- The member list's toggle after Description, at the end of the header's own buttons; not over the description, whose header holds only its own. -->
	{#if onmemberlist && !sheet}
		<button type="button" class={['ap-iconbtn', 'ap-roomhead-members', memberListOpen && 'ap-iconbtn-on']} aria-label={memberLabel} aria-expanded={memberListOpen} title={memberLabel} onclick={onmemberlist}>
			<Users size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	{#if reading}
		<button type="button" class="ap-iconbtn ap-roomhead-close" aria-label="Close description" title="Close (Esc)" onclick={reading.onclose}>
			<X size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	{#if muted !== undefined && onunmute && !sheet}
		<button type="button" class="ap-iconbtn ap-roomhead-unmute" data-testid={unmuteButtonTestid} aria-label="Unmute {unmuteNoun}" title="Muted{unmuteNoun !== noun ? ' with its room' : ''} {muted}. Unmute {unmuteNoun}" onclick={onunmute}>
			<BellOff size={18} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	<!-- Read without joining: Join, the primary action here, beside the ⋯ at the end. -->
	{#if canJoin && !sheet}
		<button type="button" class="ap-btn ap-btn-sm ap-btn-primary ap-roomhead-join" data-testid={joinTestid} aria-label="Join {noun}" title={thread ? 'Get its replies live, and list it under the room' : 'Get its messages live, and list it with your rooms'} disabled={busy} onclick={onjoin}>Join</button>
	{/if}
	{#if actions.length > 0 && !sheet}
		<MenuButton label={thread ? 'Thread actions' : 'Room actions'} buttonTestid={actionsTestid} choices={actions} disabled={busy} onselect={act} bind:open={actionsOpen}>
			{#snippet icon()}<Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />{/snippet}
			{#snippet lead(value)}{#if value === 'search'}<Search size={15} aria-hidden="true" />{:else if value === 'edit'}{@render icons.pencil()}{:else if value === 'mute'}<BellOff size={15} aria-hidden="true" />{:else if value === 'unmute'}<Bell size={15} aria-hidden="true" />{:else if value === 'link'}<Link size={15} aria-hidden="true" />{:else if value === 'shortcuts'}<Keyboard size={15} aria-hidden="true" />{:else}<LogOut size={15} aria-hidden="true" />{/if}{/snippet}
		</MenuButton>
	{/if}
	{#if updating}<span class="ap-roomhead-updating" data-testid="room-updating" aria-hidden="true"></span>{/if}
</header>
