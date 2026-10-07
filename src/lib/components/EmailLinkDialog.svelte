<script lang="ts">
	import type { EmailLink } from '$lib/ui/email-link';
	import { emailLinkPrompt } from '$lib/ui/email-link';
	import Dialog from '$lib/design/components/Dialog.svelte';

	interface Props {
		/** The emailed link the page was opened with (§4.11). */
		link: EmailLink;
		/**
		 * The server the page is using, who is signed in there (a registered
		 * session), and whether a session is kept there even before it resumes.
		 */
		current: { url: string; label?: string; signedInAs?: string; keptSession?: boolean; targetKeptSession?: boolean };
		onconfirm: () => void;
		oncancel: () => void;
	}
	let { link, current, onconfirm, oncancel }: Props = $props();

	let prompt = $derived(emailLinkPrompt(link, current));
</script>

<!--
	An emailed link is a credential that someone else may have crafted or forwarded, so it is never used
	without asking: the question names the server, and says what continuing replaces. The link carries no
	address (§4.11), so it can't say which account it signs in to.
-->
<!-- Escape and the close button cancel, as Cancel does. -->
<Dialog open title={prompt.title} closeLabel="Cancel" testid="email-link-dialog" onclose={oncancel} onsubmit={(event) => { event.preventDefault(); onconfirm(); }}>
	{#each prompt.lines as line (line)}<p>{line}</p>{/each}
	{#snippet footer()}
		<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={oncancel}>Cancel</button>
		<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" data-testid="email-link-confirm">Sign in</button>
	{/snippet}
</Dialog>
