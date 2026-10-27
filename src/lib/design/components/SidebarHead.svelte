<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The server the rooms list is for: its `title` (§3.1), or its host. */
		name: string;
		/** Its address (§1), the name's tooltip. */
		address?: string;
		/** Its `avatar` (§3.1), loaded as a user's is (§4.8.6). */
		avatar?: string;
		/** A Connect button: the connection's settings, or another server. */
		onconnect?: () => void;
		/** Phones: the room or thread the rooms list opened over, and a › back to it, mirroring the room header's ‹. */
		returnTo?: string;
		onreturn?: () => void;
		/** Classes for its row, added to its own. */
		class?: ClassValue;
	}
	let { name, address, avatar, onconnect, returnTo, onreturn, class: className }: Props = $props();
</script>

<div class={['ap-shell-sidehead', className]}>
	{#if avatar}<img class="ap-shell-sidehead-avatar" src={avatar} alt="" />{/if}
	<span class="ap-shell-sidehead-name" title={address}>{name}</span>
	{#if onconnect}<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Connection settings" onclick={onconnect}>Connect</button>{/if}
	{#if returnTo !== undefined && onreturn}
		<button class="ap-shell-sidehead-return" type="button" aria-label="Back to {returnTo}" title="Back to {returnTo}" onclick={onreturn}>›</button>
	{/if}
</div>
