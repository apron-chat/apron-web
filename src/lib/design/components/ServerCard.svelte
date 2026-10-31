<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Popover from './Popover.svelte';
	import type { MediaSrc, PopoverPlacement } from './types';
	import { initials } from './util';

	/**
	 * The server you're connected to, in a Popover opened from the rooms list's head: its avatar, title and address
	 * (always shown, since a title and an avatar can be copied, §5.3), its description, what else is known of it, and
	 * what you can do: connect to another server, or disconnect from this one.
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
		/** What else is known of it, a line each: how the connection stands, who you are there. */
		details?: ReadonlyArray<{ label: string; value: string }>;
		/** New server…: the way to connect to another. */
		onnewserver?: () => void;
		/** Disconnect: closes the connection to this one. */
		ondisconnect?: () => void;
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
	let { mode = 'popover', top, left, width, height, name, address, avatar, description, details = [], onnewserver, ondisconnect, class: className, testid, onkeydown, onfocusout, element = $bindable(), offsetHeight = $bindable(0) }: Props = $props();

	/** The address's host (and a port that isn't the default), under the name unless the name is it already. */
	const host = $derived.by(() => {
		try {
			return new URL(address).host;
		} catch {
			return address;
		}
	});
</script>

<Popover label={`Server: ${name}`} {mode} {top} {left} {width} {height} class={['ap-servcard', className]} {testid} {onkeydown} {onfocusout} bind:element bind:offsetHeight>
	<div class="ap-servcard-who">
		{#if avatar}<img class="ap-servcard-avatar" src={avatar} alt="" />{:else}<span class="ap-servcard-avatar ap-servcard-initials" aria-hidden="true">{initials(name)}</span>{/if}
		<div class="ap-servcard-names">
			<span class="ap-servcard-name">{name}</span>
			{#if host !== name}<span class="ap-servcard-host">{host}</span>{/if}
		</div>
	</div>
	{#if description}<div class="ap-servcard-description" dir="auto">{@render description()}</div>{/if}
	<dl class="ap-servcard-details">
		<div><dt>Address</dt><dd class="ap-servcard-address">{address}</dd></div>
		{#each details as detail (detail.label)}<div><dt>{detail.label}</dt><dd>{detail.value}</dd></div>{/each}
	</dl>
	{#if onnewserver || ondisconnect}
		<div class="ap-servcard-actions">
			{#if onnewserver}<Button size="sm" label="New server…" onclick={onnewserver} />{/if}
			{#if ondisconnect}<Button size="sm" variant="ghost" label="Disconnect" onclick={ondisconnect} />{/if}
		</div>
	{/if}
</Popover>
