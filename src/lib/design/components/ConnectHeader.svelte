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
		/**
		 * Goes back to choosing the server: shown as Change beside the server, which then stands in for the Server
		 * field. Without it, the field shows under the server.
		 */
		onchange?: () => void;
		/** Where a link leads on the server in the field, such as `#eng`, before it is contacted. */
		linked?: string;
		/** Something to know before signing in that stops nothing, such as another protocol version (§3.1): a bold title, then the text. */
		warning?: { title: string; text: string };
	}
	let { url = $bindable(''), welcome, busy = false, urlTestid, server, description, serverTestid, onchange, linked, warning }: Props = $props();
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
		{#if onchange}<button class="ap-link ap-connect-change" type="button" disabled={busy} onclick={onchange}>Change</button>{/if}
	</div>
	{#if description}<div class="ap-connect-server-desc ap-msg-text">{@render description()}</div>{/if}
{/if}
{#if warning}<p class="ap-connect-warn"><strong>{warning.title}</strong> {warning.text}</p>{/if}
{#if welcome}<div class="ap-welcome ap-msg-text">{@render welcome()}</div>{/if}
{#if linked && !server}<p class="ap-connect-intent">A link opened this page to <strong>{linked}</strong> on this server.</p>{/if}
{#if !(server && onchange)}
	<label class="ap-fieldlabel">Server
		<input class="ap-field ap-field-mono" data-testid={urlTestid} type="text" inputmode="url" bind:value={url} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" spellcheck="false" />
	</label>
{/if}
