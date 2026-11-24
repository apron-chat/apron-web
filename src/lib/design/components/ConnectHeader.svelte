<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { ConnectServer } from './types';
	import { initials } from './util';

	interface Props {
		/** The Server field: `bind:url`. */
		url?: string;
		/** `server.welcome` (§3.2): its Markdown, rendered and sanitized by you, shown above the Server field. Each `server` frame replaces it. */
		welcome?: Snippet;
		/** Starts the welcome folded to its first two lines, with More where it runs longer: for someone who has signed in here before. */
		welcomeFolded?: boolean;
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
	let { url = $bindable(''), welcome, welcomeFolded = false, busy = false, urlTestid, server, description, serverTestid, onchange, linked, warning }: Props = $props();
	/** The server whose welcome was unfolded: another server's starts folded again. */
	let unfoldedFor = $state<string | undefined>();
	const folded = $derived(welcomeFolded && unfoldedFor !== (server?.address ?? ''));
	/** The folded welcome runs past its two lines: it fades out, with More. */
	let overflows = $state(false);
	/**
	 * Measures the welcome against its fold as either lays out (a ResizeObserver: no layout forced of its own). The fold is
	 * watched too: folding changes its height while the welcome keeps its own, as when another server's starts folded.
	 */
	function measure(content: HTMLElement) {
		const fold = content.parentElement!;
		const observer = new ResizeObserver(() => (overflows = content.offsetHeight > fold.clientHeight + 1));
		observer.observe(content);
		observer.observe(fold);
		return () => observer.disconnect();
	}
	const unfold = () => (unfoldedFor = server?.address ?? '');
	let body = $state<HTMLElement>();
	/** More goes once pressed: focus moves to the welcome it unfolded, not back to the top of the page. */
	async function more(): Promise<void> {
		unfold();
		await tick();
		body?.focus();
	}
</script>

<!--
	The top of the connect screen's card (SignInForm's `header`): the title, the server's welcome and the Server field.
	It has no root of its own: its parts are the card's first rows.
-->
<h1 class="ap-connect-title">Apron</h1>
{#if !server}<p class="ap-connect-tag">Connect to a server</p>{/if}
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
{#if welcome}
	<!-- Focus on a link under the fold unfolds it, so the keyboard never lands on something hidden. -->
	<div class={['ap-welcome', folded && 'ap-welcome-folded', folded && overflows && 'ap-welcome-clipped']} onfocusin={(event) => folded && event.target !== event.currentTarget.querySelector('.ap-welcome-more') && unfold()}>
		<div class="ap-welcome-body" tabindex="-1" bind:this={body}><div class="ap-msg-text" {@attach measure}>{@render welcome()}</div></div>
		{#if folded && overflows}<button class="ap-link ap-welcome-more" type="button" onclick={more}>More</button>{/if}
	</div>
{/if}
{#if linked && !server}<p class="ap-connect-intent">A link opened this page to <strong>{linked}</strong> on this server.</p>{/if}
{#if !(server && onchange)}
	<label class="ap-fieldlabel">Server
		<input class="ap-field ap-field-mono" data-testid={urlTestid} type="text" inputmode="url" bind:value={url} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" autocapitalize="none" autocorrect="off" spellcheck="false" />
	</label>
{/if}
