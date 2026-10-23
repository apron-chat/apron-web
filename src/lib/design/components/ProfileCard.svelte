<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import Popover from './Popover.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import type { PopoverPlacement, Presence } from './types';
	import { presence, presenceLabel } from './util';

	/**
	 * Who a mention, a sender or a member is, in a Popover: their avatar, name,
	 * `@user_id` (always, here: this is where people check who someone really
	 * is, §3.3), status, roles, and whether they're in the open room, with what
	 * you can do about them. Other attributes (`data-*`, event handlers) go on
	 * the Popover.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement>, PopoverPlacement {
		userId: string;
		/** Display name; falls back to `userId`. */
		name?: string;
		/** Avatar image URL. */
		src?: string;
		/** Replaces the avatar, such as with your own that tints initials by `user_id`. */
		avatar?: Snippet;
		/** The viewer's own card: "(you)" follows the name. */
		you?: boolean;
		/** Their `status` (§4.5), on the avatar and in words; a value this client doesn't know shows as written. Absent shows none. */
		status?: Presence | (string & {});
		/** The status's words instead of its own, on the avatar's dot and under the name, such as your own invisible ("Invisible · others see you as offline"). */
		statusLabel?: string;
		/** Server-assigned roles (§3.3), as badges under the status. */
		roles?: string[];
		/** Another user shows the same name: a note says to check the `@user_id`. */
		sharesName?: boolean;
		/** Their membership of the open room, in words ("Member of design"). */
		membership?: string;
		/** Offers Mention, such as while the composer takes text. */
		onmention?: () => void;
		/** Offers Copy @user_id. */
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
	}
	let {
		userId, name, src, avatar, you = false, status, statusLabel, roles, sharesName = false, membership, onmention, oncopyid, onaddtoroom, adding = false, note,
		element = $bindable(), offsetHeight = $bindable(0), class: className, ...rest
	}: Props = $props();
	const shownName = $derived(name || userId);
	const shown = $derived(presence(status));
</script>

<Popover aria-label={`Profile of ${shownName}`} {...rest} class={['ap-profcard', className]} bind:element bind:offsetHeight>
	<div class="ap-profcard-who">
		{#if avatar}{@render avatar()}{:else}<Avatar name={shownName} user_id={userId} {src} size="lg" {status} {statusLabel} />{/if}
		<div class="ap-profcard-names">
			<div class="ap-profcard-nameline">
				<span class="ap-profcard-name">{shownName}</span>
				{#if you}<span class="ap-profcard-you">(you)</span>{/if}
			</div>
			<div class="ap-profcard-handle" data-testid="profile-handle">@{userId}</div>
			{#if shown === 'unknown'}
				<div class="ap-profcard-status" data-testid="profile-status">Unknown status: <code class="ap-profcard-literal">{status}</code></div>
			{:else if shown}
				<div class="ap-profcard-status" data-testid="profile-status">{statusLabel ?? presenceLabel(status)}</div>
			{/if}
			<RoleBadges {roles} testid="roles" overflow="drop" />
		</div>
	</div>
	{#if sharesName}
		<p class="ap-profcard-warn" role="note">Another user also shows as <strong>{shownName}</strong>. Check the @user_id.</p>
	{/if}
	{#if membership}<p class="ap-profcard-note" data-testid="profile-membership">{membership}</p>{/if}
	<div class="ap-profcard-actions">
		{#if onmention}<Button size="sm" onclick={onmention}>Mention</Button>{/if}
		{#if oncopyid}<Button variant="ghost" size="sm" onclick={oncopyid}>Copy @user_id</Button>{/if}
		{#if onaddtoroom}<Button variant="ghost" size="sm" disabled={adding} onclick={onaddtoroom}>{adding ? 'Adding…' : 'Add to room'}</Button>{/if}
	</div>
	{#if note}<p class={['ap-profcard-note', note.error && 'ap-tone-danger']} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
</Popover>
