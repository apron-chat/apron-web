<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The Server field: `bind:url`. */
		url?: string;
		/** `server.welcome` (§3.2): its Markdown, rendered and sanitized by you, shown above the Server field. Each `server` frame replaces it. */
		welcome?: Snippet;
		/** Something is under way: the Server field waits. */
		busy?: boolean;
		/** `data-testid` on the Server field. */
		urlTestid?: string;
	}
	let { url = $bindable(''), welcome, busy = false, urlTestid }: Props = $props();
</script>

<!--
	The top of the connect screen's card (SignInForm's `header`): the title, the server's welcome and the Server field.
	It has no root of its own: its parts are the card's first rows.
-->
<h1 class="ap-connect-title">Apron</h1>
<p class="ap-connect-tag">Connect to a backend</p>
{#if welcome}<div class="ap-welcome ap-msg-text">{@render welcome()}</div>{/if}
<label class="ap-fieldlabel">Server
	<input class="ap-field ap-field-mono" data-testid={urlTestid} type="text" inputmode="url" bind:value={url} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" spellcheck="false" />
</label>
