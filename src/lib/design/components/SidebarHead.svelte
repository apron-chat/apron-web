<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { initials } from './util';

	interface Props {
		/** The server the rooms list is for: its `title` (§3.1), or its host. */
		name: string;
		/** Its address (§1): its host shows under the name, and the whole address is the tooltip. */
		address?: string;
		/** Its `avatar` (§3.1), loaded as a user's is (§4.8.6); its initials without one. */
		avatar?: string;
		/** Phones: the room or thread the rooms list opened over, and a › back to it, mirroring the room header's ‹. */
		returnTo?: string;
		onreturn?: () => void;
		/** Classes for its row, added to its own. */
		class?: ClassValue;
	}
	let { name, address, avatar, returnTo, onreturn, class: className }: Props = $props();

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

<!-- Who you're connected to, not a control: the profile's Connect to a server… is the way to another. -->
<div class={['ap-shell-sidehead', className]}>
	<div class="ap-shell-sidehead-server" title={address}>
		{#if avatar}<img class="ap-shell-sidehead-avatar" src={avatar} alt="" />{:else}<span class="ap-shell-sidehead-avatar ap-shell-sidehead-initials" aria-hidden="true">{initials(name)}</span>{/if}
		<span class="ap-shell-sidehead-text">
			<span class="ap-shell-sidehead-name">{name}</span>
			{#if subline}<span class="ap-shell-sidehead-host">{subline}</span>{/if}
		</span>
	</div>
	{#if returnTo !== undefined && onreturn}
		<button class="ap-shell-sidehead-return" type="button" aria-label="Back to {returnTo}" title="Back to {returnTo}" onclick={onreturn}>›</button>
	{/if}
</div>
