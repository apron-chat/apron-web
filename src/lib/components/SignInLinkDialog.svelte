<script lang="ts">
	import type { SignInLink } from '$lib/ui/sign-in-link';
	import { signInLinkPrompt } from '$lib/ui/sign-in-link';
	import Button from '$lib/design/components/Button.svelte';
	import Dialog from '$lib/design/components/Dialog.svelte';

	interface Props {
		/** The sign-in link the page was opened with (§4.11.2), of no proposal this browser made. */
		link: SignInLink;
		/**
		 * The server the page is using, who is signed in there (a registered
		 * session), whether a session is kept there even before it resumes,
		 * and the account signed in there, guests included, that the link may
		 * add to instead (`addAs`).
		 */
		current: { url: string; label?: string; signedInAs?: string; addAs?: string; keptSession?: boolean; targetKeptSession?: boolean };
		onconfirm: () => void;
		/** Adds the link to the `addAs` account rather than signing in with it. */
		onadd: () => void;
		oncancel: () => void;
	}
	let { link, current, onconfirm, onadd, oncancel }: Props = $props();

	let prompt = $derived(signInLinkPrompt(link, current));
</script>

<!--
	A link without the `state` of a proposal this browser made is a credential that someone else may have
	crafted or forwarded, so it is never used without asking (§4.11.2): the question names the server, and
	says what continuing replaces. The link can't say which account it signs in to, nor whether it was sent to
	sign in or to add a way of signing in to an account: on a server this page is signed in to, it offers both,
	adding first, since an addition approves only for the account that proposed it (§4.11.3).
-->
<!-- Escape and the close button cancel, as Cancel does. -->
<Dialog open title={prompt.title} closeLabel="Cancel" testid="sign-in-link-dialog" onclose={oncancel} onsubmit={(event) => { event.preventDefault(); if (prompt.adds) onadd(); else onconfirm(); }}>
	{#each prompt.lines as line (line)}<p>{line}</p>{/each}
	{#snippet footer()}
		<Button size="sm" variant="ghost" label="Cancel" onclick={oncancel} />
		{#if prompt.adds}
			<Button size="sm" variant="ghost" label="Sign in" onclick={onconfirm} data-testid="sign-in-link-confirm" />
			<Button type="submit" size="sm" variant="primary" label="Add it" data-testid="sign-in-link-add" />
		{:else}
			<Button type="submit" size="sm" variant="primary" label="Sign in" data-testid="sign-in-link-confirm" />
		{/if}
	{/snippet}
</Dialog>
