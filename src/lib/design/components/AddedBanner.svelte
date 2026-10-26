<script lang="ts">
	import BellOff from '@lucide/svelte/icons/bell-off';
	import LogOut from '@lucide/svelte/icons/log-out';
	import X from '@lucide/svelte/icons/x';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';

	/**
	 * Under a private room's header (§4.2.4) when someone else added you to it: says so, with Mute and Leave, until its
	 * × puts it away.
	 */
	interface Props {
		/** The sentence, such as "You were added to this private room." */
		text?: string;
		/** Offers Mute: the room's notifications (§4.5 `mute` with its `room_id`). */
		onmute?: () => void;
		/** The room is muted: Mute reads "Muted", and Unmute undoes it where `onunmute` is given. */
		muted?: boolean;
		onunmute?: () => void;
		/** Offers Leave (`room_leave`, §4.2.2). */
		onleave?: () => void;
		/** A request in flight: its buttons can't be used. */
		busy?: boolean;
		/** What went wrong, such as a refused mute, in the danger color. */
		error?: string;
		ondismiss: () => void;
		/** Classes for its root, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its root. */
		testid?: string;
	}
	let { text = 'You were added to this private room.', onmute, muted = false, onunmute, onleave, busy = false, error, ondismiss, class: className, testid }: Props = $props();
</script>

<div class={['ap-addedbar', className]} role="status" data-testid={testid}>
	<p class="ap-addedbar-text">{text}</p>
	{#if muted}
		{#if onunmute}<Button variant="ghost" size="sm" disabled={busy} onclick={onunmute}><BellOff size={15} aria-hidden="true" />Unmute</Button>{:else}<span class="ap-addedbar-note">Muted</span>{/if}
	{:else if onmute}
		<Button variant="ghost" size="sm" disabled={busy} onclick={onmute}><BellOff size={15} aria-hidden="true" />Mute</Button>
	{/if}
	{#if onleave}<Button size="sm" disabled={busy} onclick={onleave}><LogOut size={15} aria-hidden="true" />Leave</Button>{/if}
	<button type="button" class="ap-iconbtn ap-addedbar-close" aria-label="Dismiss" title="Dismiss" onclick={ondismiss}><X size={16} aria-hidden="true" /></button>
	{#if error}<p class="ap-addedbar-note ap-addedbar-error ap-tone-danger" role="alert">{error}</p>{/if}
</div>
