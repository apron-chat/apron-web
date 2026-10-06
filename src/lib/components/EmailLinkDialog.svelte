<script lang="ts">
	import type { EmailLink } from '$lib/ui/email-link';
	import { emailLinkPrompt } from '$lib/ui/email-link';

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

	let dialog = $state<HTMLDialogElement | undefined>();
	let prompt = $derived(emailLinkPrompt(link, current));

	$effect(() => {
		if (dialog && !dialog.open) dialog.showModal();
	});
</script>

<!--
	An emailed link is a credential that someone else may have crafted or forwarded, so it is never used
	without asking: the question names the server, and says what continuing replaces. The link carries no
	address (§4.11), so it can't say which account it signs in to.
-->
<dialog class="email-link" bind:this={dialog} aria-labelledby="email-link-title" data-testid="email-link-dialog" oncancel={(event) => { event.preventDefault(); oncancel(); }}>
	<form method="dialog" onsubmit={(event) => { event.preventDefault(); onconfirm(); }}>
		<h2 id="email-link-title">{prompt.title}</h2>
		{#each prompt.lines as line (line)}<p>{line}</p>{/each}
		<div class="actions">
			<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={oncancel}>Cancel</button>
			<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" data-testid="email-link-confirm">Sign in</button>
		</div>
	</form>
</dialog>

<style>
	/* The same surface and backdrop as CreateRoomDialog. */
	.email-link { width: min(440px, calc(100vw - 32px)); max-width: none; margin: auto; padding: 0; color: var(--ink); background: var(--bg-100); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); }
	.email-link::backdrop { background: rgba(5, 5, 12, .68); backdrop-filter: blur(2px); }
	form { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-6); }
	h2 { margin: 0; font-size: 18px; line-height: 24px; overflow-wrap: anywhere; }
	p { margin: 0; font-size: 14px; line-height: 20px; color: var(--ink-muted); }
	.actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
</style>
