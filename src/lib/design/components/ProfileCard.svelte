<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import Popover from './Popover.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import type { PopoverPlacement, Presence } from './types';
	import { presence, presenceLabel } from './util';

	/**
	 * Who a mention, a sender or a member is, in a Popover: their avatar, name,
	 * `@user_id` (always, here: this is where people check who someone really
	 * is, §3.3), status (and when they were last seen, while offline), roles, bio, and whether they're in the open room, with
	 * what you can do about them.
	 */
	interface Props extends PopoverPlacement {
		/** Closes it: on a phone, a press on the dimmed page behind the sheet. */
		onclose?: () => void;
		userId: string;
		/** Display name; falls back to `userId`. */
		name?: string;
		/** Replaces the avatar, such as with your own that tints initials by `user_id`. */
		avatar?: Snippet;
		/** The viewer's own card: "(you)" follows the name. */
		you?: boolean;
		/** Their `status` (§4.5), on the avatar and in words; a value this client doesn't know shows as written. Absent shows none. */
		status?: Presence | (string & {});
		/** The status's words instead of its own, on the avatar's dot and under the name, such as your own invisible ("Invisible · others see you as offline"). */
		statusLabel?: string;
		/**
		 * When they were last seen (§4.5.2), under the status while it is `offline` (and only then: a `seen` kept from
		 * before they came back online says nothing now): its words ("Last seen 5m ago"), the `datetime`, and the exact
		 * time as its tooltip.
		 */
		seen?: { text: string; datetime?: string; title?: string };
		/** Server-assigned roles (§3.3), as badges under the status. */
		roles?: string[];
		/** Their bio (`ext:bio`), plain text under the name: its line breaks show. */
		bio?: string;
		/** The bio as markup you rendered and sanitized, such as with its links linked, in place of `bio`'s text; shown only with `bio`. */
		bioBody?: Snippet;
		/** Another user shows the same name: a note says to check the `@user_id`. */
		sharesName?: boolean;
		/** Their membership of the open room, in words ("Member of design"). */
		membership?: string;
		/** Offers Message, the card's primary action: a private conversation with them (§4.2.4). */
		onmessage?: () => void;
		/** Opening it is in flight: Message says "Opening…", disabled. */
		messaging?: boolean;
		/** Offers Mention, such as while the composer takes text. */
		onmention?: () => void;
		/** Offers Copy @user_id, as an icon button beside the `@user_id`. */
		oncopyid?: () => void;
		/** Offers Add to room (§4.2.2). */
		onaddtoroom?: () => void;
		/** Adding is in flight: Add to room says so, disabled. */
		adding?: boolean;
		/** The outcome of the last action, under the actions ("Copied @ada"); `error` in the danger color, as an alert. */
		note?: { text: string; error?: boolean };
		/** The Popover's `<div>`, bindable. */
		element?: HTMLDivElement;
		/** The Popover's rendered height in px, bindable. */
		offsetHeight?: number;
		/** Classes for the Popover, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the Popover. */
		testid?: string;
		/** Keys in the card, such as Escape to close it. */
		onkeydown?: (event: KeyboardEvent) => void;
		/** Focus leaving something in the card, such as to close it when focus leaves it altogether. */
		onfocusout?: (event: FocusEvent) => void;
		/** A `data-testid` for the status in words. */
		statusTestid?: string;
		/** A `data-testid` for when they were last seen. */
		seenTestid?: string;
		/** A `data-testid` for the row of roles. */
		rolesTestid?: string;
		/** A `data-testid` for the bio. */
		bioTestid?: string;
	}
	let {
		userId, name, avatar, you = false, status, statusLabel, seen, roles, bio, bioBody, sharesName = false, membership, onmessage, messaging = false, onmention, oncopyid, onaddtoroom, adding = false, note,
		element = $bindable(), offsetHeight = $bindable(0), statusTestid, seenTestid, rolesTestid, bioTestid, mode, top, left, width, height, class: className, testid, onkeydown, onfocusout, onclose
	}: Props = $props();
	const shownName = $derived(name || userId);
	const shown = $derived(presence(status));
</script>

<Popover label={`Profile of ${shownName}`} {mode} {top} {left} {width} {height} class={['ap-profcard', className]} {testid} {onkeydown} {onfocusout} {onclose} bind:element bind:offsetHeight>
	<div class="ap-profcard-who">
		{#if avatar}{@render avatar()}{:else}<Avatar name={shownName} user_id={userId} size="lg" {status} {statusLabel} />{/if}
		<div class="ap-profcard-names">
			<div class="ap-profcard-nameline">
				<span class="ap-profcard-name">{shownName}</span>
				{#if you}<span class="ap-profcard-you">(you)</span>{/if}
			</div>
			<div class="ap-profcard-handleline">
				<span class="ap-profcard-handle">@{userId}</span>
				{#if oncopyid}<button type="button" class="ap-iconbtn ap-profcard-copy" aria-label="Copy @user_id" title="Copy @user_id" onclick={oncopyid}><Copy size={14} aria-hidden="true" /></button>{/if}
			</div>
			{#if shown === 'unknown'}
				<div class="ap-profcard-status" data-testid={statusTestid}>Unknown status: <code class="ap-profcard-literal">{status}</code></div>
			{:else if shown}
				<div class="ap-profcard-status" data-testid={statusTestid}>{statusLabel ?? presenceLabel(status)}</div>
			{/if}
			{#if shown === 'offline' && !you && seen?.text}<time class="ap-profcard-seen" data-testid={seenTestid} datetime={seen.datetime} title={seen.title}>{seen.text}</time>{/if}
			<RoleBadges {roles} data-testid={rolesTestid} overflow="drop" />
		</div>
	</div>
	{#if sharesName}
		<p class="ap-profcard-warn" role="note">Another user also shows as <strong>{shownName}</strong>. Check the @user_id.</p>
	{/if}
	{#if bio}<p class="ap-profcard-bio" dir="auto" data-testid={bioTestid}>{#if bioBody}{@render bioBody()}{:else}{bio}{/if}</p>{/if}
	{#if membership}<p class="ap-profcard-note">{membership}</p>{/if}
	{#if onmessage || onmention || onaddtoroom}
		<div class="ap-profcard-actions">
			{#if onmessage}<Button variant="primary" size="sm" disabled={messaging} onclick={onmessage}><MessageCircle size={15} aria-hidden="true" />{messaging ? 'Opening…' : 'Message'}</Button>{/if}
			{#if onmention}<Button size="sm" onclick={onmention}>Mention</Button>{/if}
			{#if onaddtoroom}<Button variant="ghost" size="sm" disabled={adding} onclick={onaddtoroom}>{adding ? 'Adding…' : 'Add to room'}</Button>{/if}
		</div>
	{/if}
	{#if note}<p class={['ap-profcard-note', note.error && 'ap-tone-danger']} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
</Popover>
