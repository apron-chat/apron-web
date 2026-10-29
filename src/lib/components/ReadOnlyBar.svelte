<script lang="ts">
	import Button from '$lib/design/components/Button.svelte';

	/**
	 * Stands in for the composer while you only read (`ext:permissions` with
	 * `write: false`): says why, and offers a guest the passkey sign-in that
	 * may lift it. Rooms can still be listed and read, without joining.
	 */
	interface Props {
		/** You read as a guest, on a server that offers another way to sign in: signing in may let you post. */
		guest: boolean;
		/** Why passkeys can't be used in this browser, when they can't. */
		passkeyUnavailable?: string;
		/** Reading an archive (`ext:archive`): what it is, said in place of the guest's line, with no sign-in to offer. */
		archive?: string;
		onsignin: () => void;
	}
	let { guest, passkeyUnavailable, archive, onsignin }: Props = $props();
</script>

<div class="ap-composer ap-composer-readonly" role="note">
	<p class="ap-composer-readonly-text">
		{#if archive}
			{archive}
		{:else if guest}
			You’re reading as a guest. {passkeyUnavailable ? `Posting needs a passkey sign-in. ${passkeyUnavailable}` : 'Sign in to post, react, join rooms, and start threads.'}
		{:else}
			You can read here, but this server doesn’t let you post, react, or join rooms.
		{/if}
	</p>
	{#if guest && !passkeyUnavailable && !archive}
		<Button variant="primary" size="sm" onclick={onsignin} label="Sign in" />
	{/if}
</div>
