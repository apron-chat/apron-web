<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Popover from './Popover.svelte';
	import type { MediaSrc, PopoverPlacement } from './types';
	import { initials } from './util';

	/**
	 * The server you're connected to, in a Popover opened from the rooms list's head: its avatar and title, how the
	 * connection stands beside its host (always shown, since a title and an avatar can be copied, §5.3), its
	 * description, who you are there, its address to copy, and what you can do: connect to another server, or
	 * disconnect from this one.
	 */
	interface Props extends PopoverPlacement {
		/** Its `title` (§3.1), or its host. */
		name: string;
		/** Its address (§1). */
		address: string;
		/** Its `avatar` (§3.1); its initials without one. */
		avatar?: MediaSrc;
		/** Its `description` (§3.1), such as rendered and sanitized Markdown. */
		description?: Snippet;
		/** How the connection stands, in words, and its tone: a dot before them. */
		connection?: { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' };
		/** Who you are there: your name, and whether as a guest. */
		you?: { name: string; guest?: boolean };
		/** Edit profile, after who you are: your profile, such as Preferences at Profile. */
		onprofile?: () => void;
		/** The protocol it speaks, such as "Apron 9": small, at the foot. */
		protocol?: string;
		/** A copy button beside the address; `copied` while it says it copied. */
		oncopyaddress?: () => void;
		copied?: boolean;
		/** Connect to another server…: the connect screen. */
		onnewserver?: () => void;
		/** Disconnect: closes the connection to this one. */
		ondisconnect?: () => void;
		/** Closes it: on a phone, a press on the dimmed page behind the sheet. */
		onclose?: () => void;
		/** Classes for its `<div>`, added to its own. */
		class?: ClassValue;
		testid?: string;
		onkeydown?: (event: KeyboardEvent) => void;
		onfocusout?: (event: FocusEvent) => void;
		/** Its `<div>`, bindable. */
		element?: HTMLDivElement;
		/** Its rendered height in px, bindable. */
		offsetHeight?: number;
	}
	let {
		mode = 'popover', top, left, width, height, name, address, avatar, description, connection, you, onprofile, protocol, oncopyaddress, copied = false,
		onnewserver, ondisconnect, onclose, class: className, testid, onkeydown, onfocusout, element = $bindable(), offsetHeight = $bindable(0)
	}: Props = $props();

	/** The address's host (and a port that isn't the default), beside how the connection stands. */
	const host = $derived.by(() => {
		try {
			return new URL(address).host;
		} catch {
			return address;
		}
	});
</script>

<Popover label={`Server: ${name}`} {mode} {top} {left} {width} {height} class={['ap-servcard', className]} {testid} {onkeydown} {onfocusout} {onclose} bind:element bind:offsetHeight>
	<div class="ap-servcard-who">
		{#if avatar}<img class="ap-servcard-avatar" src={avatar} alt="" />{:else}<span class="ap-servcard-avatar ap-servcard-initials" aria-hidden="true">{initials(name)}</span>{/if}
		<div class="ap-servcard-names">
			<span class="ap-servcard-name" title={name}>{name}</span>
			<span class="ap-servcard-state">
				{#if connection}<span class={['ap-servcard-dot', `ap-servcard-dot-${connection.tone}`]} aria-hidden="true"></span><span class="ap-servcard-connection">{connection.label}</span><span class="ap-servcard-sep" aria-hidden="true">·</span>{/if}<span class="ap-servcard-host">{host}</span>
			</span>
		</div>
	</div>
	{#if description}<div class="ap-servcard-description" dir="auto">{@render description()}</div>{/if}
	{#if you}
		<p class="ap-servcard-you">Signed in as <strong>{you.name}</strong>{#if you.guest}{' (guest)'}{/if}{#if onprofile}<span class="ap-servcard-sep" aria-hidden="true">·</span><button type="button" class="ap-link" onclick={onprofile}>Edit profile</button>{/if}</p>
	{/if}
	<div class="ap-servcard-address-row">
		<span class="ap-servcard-label">Address</span>
		<code class="ap-servcard-address" title={protocol ? `${address} · ${protocol}` : address}>{address}</code>
		{#if oncopyaddress}<button type="button" class="ap-iconbtn ap-servcard-copy" aria-label={copied ? 'Copied the address' : 'Copy the address'} title={copied ? 'Copied' : 'Copy the address'} onclick={oncopyaddress}>{#if copied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}</button>{/if}
	</div>
	{#if protocol}<p class="ap-servcard-meta">{protocol}</p>{/if}
	{#if onnewserver || ondisconnect}
		<div class="ap-servcard-actions">
			{#if onnewserver}<Button size="sm" label="Connect to another server…" onclick={onnewserver} />{/if}
			{#if ondisconnect}<Button size="sm" variant="ghost" class="ap-servcard-disconnect" label="Disconnect" onclick={ondisconnect} />{/if}
		</div>
	{/if}
</Popover>
