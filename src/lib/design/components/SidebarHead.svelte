<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-testid`, `data-*`) go on its row, the caller's winning and its class added. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** The server the rooms list is for: its name, or its address. */
		name: string;
		/** A Connect button: the connection's settings, or another server. */
		onconnect?: () => void;
		/** Phones: the room or thread the rooms list opened over, and a › back to it, mirroring the room header's ‹. */
		returnTo?: string;
		onreturn?: () => void;
		/** A `data-testid` for the ›. */
		returnTestid?: string;
	}
	let { name, onconnect, returnTo, onreturn, returnTestid, class: className, ...rest }: Props = $props();
</script>

<div {...rest} class={['ap-shell-sidehead', className]}>
	<span class="ap-shell-sidehead-name">{name}</span>
	{#if onconnect}<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Connection settings" onclick={onconnect}>Connect</button>{/if}
	{#if returnTo !== undefined && onreturn}
		<button class="ap-shell-sidehead-return" type="button" data-testid={returnTestid} aria-label="Back to {returnTo}" title="Back to {returnTo}" onclick={onreturn}>›</button>
	{/if}
</div>
