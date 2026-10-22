<script lang="ts">
	import Button from '$lib/design/components/Button.svelte';

	/**
	 * Stands in for the composer while a guest only reads (`ext:settings`
	 * with `guest_posting: false`): says why, and offers the passkey
	 * sign-in that lifts it. Rooms can still be listed and read, without joining.
	 */
	interface Props {
		/** Why passkeys can't be used in this browser, when they can't. */
		passkeyUnavailable?: string;
		onsignin: () => void;
	}
	let { passkeyUnavailable, onsignin }: Props = $props();
</script>

<div class="ap-composer ap-composer-readonly" role="note" data-testid="read-only-bar">
	<p class="ap-composer-readonly-text">
		You’re reading as a guest. {passkeyUnavailable ? `Posting needs a passkey sign-in. ${passkeyUnavailable}` : 'Sign in to post, react, join rooms, and start threads.'}
	</p>
	{#if !passkeyUnavailable}
		<Button variant="primary" size="sm" data-testid="read-only-signin" onclick={onsignin} label="Sign in" />
	{/if}
</div>
