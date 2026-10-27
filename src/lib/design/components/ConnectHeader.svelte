<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ConnectServer } from './types';
	import { initials } from './util';

	interface Props {
		/** The Server field: `bind:url`. */
		url?: string;
		/** `server.welcome` (§3.2): its Markdown, rendered and sanitized by you, shown above the Server field. Each `server` frame replaces it. */
		welcome?: Snippet;
		/** Something is under way: the Server field waits. */
		busy?: boolean;
		/** `data-testid` on the Server field. */
		urlTestid?: string;
		/** The server in the field, once it has answered: its name and avatar (§3.1), with its address. */
		server?: ConnectServer;
		/** Its `description` (§3.1): its Markdown, rendered and sanitized by you, under its name. */
		description?: Snippet;
		/** `data-testid` on the server's row. */
		serverTestid?: string;
	}
	let { url = $bindable(''), welcome, busy = false, urlTestid, server, description, serverTestid }: Props = $props();
</script>

<!--
	The top of the connect screen's card (SignInForm's `header`): the title, the server's welcome and the Server field.
	It has no root of its own: its parts are the card's first rows.
-->
<h1 class="ap-connect-title">Apron</h1>
<p class="ap-connect-tag">Connect to a backend</p>
{#if server}
	<div class="ap-connect-server" data-testid={serverTestid}>
		{#if server.avatar}<img class="ap-rail-tile ap-connect-tile" src={server.avatar} alt="" />{:else}<span class="ap-rail-tile ap-connect-tile" aria-hidden="true">{initials(server.name)}</span>{/if}
		<span class="ap-room-text">
			<span class="ap-connect-server-name">{server.name}</span>
			<span class="ap-connect-address">{server.address}</span>
		</span>
	</div>
	{#if description}<div class="ap-connect-server-desc ap-msg-text">{@render description()}</div>{/if}
{/if}
{#if welcome}<div class="ap-welcome ap-msg-text">{@render welcome()}</div>{/if}
<label class="ap-fieldlabel">Server
	<input class="ap-field ap-field-mono" data-testid={urlTestid} type="text" inputmode="url" bind:value={url} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" spellcheck="false" />
</label>
