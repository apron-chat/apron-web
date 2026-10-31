<script lang="ts">
	import type { MediaSrc } from './types';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { ClassValue } from 'svelte/elements';
	import { initials } from './util';

	interface Props {
		/** The server the rooms list is for: its `title` (§3.1), or its host. */
		name: string;
		/** Its address (§1): its host shows under the name, and the whole address is the tooltip. */
		address?: string;
		/** Its `avatar` (§3.1), loaded as a user's is (§4.8.6); its initials without one. */
		avatar?: MediaSrc;
		/** The server's name and address are a button that opens its details (a ServerCard), and whether they're open. */
		onopen?: () => void;
		expanded?: boolean;
		/** That button, to place the details beside and return focus to; bindable. */
		button?: HTMLButtonElement;
		/** Phones: the room or thread the rooms list opened over, and a › back to it, mirroring the room header's ‹. */
		returnTo?: string;
		onreturn?: () => void;
		/** Classes for its row, added to its own. */
		class?: ClassValue;
	}
	let { name, address, avatar, onopen, expanded = false, button = $bindable(), returnTo, onreturn, class: className }: Props = $props();

	/** The address's host (and a port that isn't the default), always shown, since a title and an avatar can be copied (§5.3). */
	let host = $derived.by(() => {
		if (!address) return '';
		try {
			return new URL(address).host;
		} catch {
			return address;
		}
	});
	/** Without a title the name is the host already: one line, not the same thing twice. */
	let subline = $derived(host && host !== name ? host : '');
</script>

<!-- Who you're connected to: with `onopen`, a button that opens what else is known of it, and the way to another server. -->
{#snippet server()}
	{#if avatar}<img class="ap-shell-sidehead-avatar" src={avatar} alt="" />{:else}<span class="ap-shell-sidehead-avatar ap-shell-sidehead-initials" aria-hidden="true">{initials(name)}</span>{/if}
	<span class="ap-shell-sidehead-text">
		<span class="ap-shell-sidehead-nameline"><span class="ap-shell-sidehead-name">{name}</span>{#if onopen}<ChevronDown class="ap-shell-sidehead-chevron" size={14} strokeWidth={2} aria-hidden="true" />{/if}</span>
		{#if subline}<span class="ap-shell-sidehead-host">{subline}</span>{/if}
	</span>
{/snippet}
<div class={['ap-shell-sidehead', className]}>
	{#if onopen}
		<button type="button" class={['ap-shell-sidehead-server', 'ap-shell-sidehead-open', expanded && 'ap-shell-sidehead-expanded']} title={address} aria-haspopup="dialog" aria-expanded={expanded} bind:this={button} onclick={onopen}><span class="ap-sr">{'Server: '}</span>{@render server()}</button>
	{:else}
		<div class="ap-shell-sidehead-server" title={address}>{@render server()}</div>
	{/if}
	{#if returnTo !== undefined && onreturn}
		<button class="ap-iconbtn ap-iconbtn-lg ap-shell-sidehead-return" type="button" aria-label="Back to {returnTo}" title="Back to {returnTo}" onclick={onreturn}><ChevronRight size={20} aria-hidden="true" /></button>
	{/if}
</div>
