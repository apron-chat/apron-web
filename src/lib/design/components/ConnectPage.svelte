<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { RecentBackend } from './types';
	import { initials } from './util';

	interface Props {
		/** The card: a SignInForm, with a ConnectHeader as its `header`. */
		children?: Snippet;
		/**
		 * Backends signed in to before, offered under the card: each by its `label` (its title, else its host), its
		 * `avatar` or initials, and always its address, `url`, since a title and an avatar can be copied (§5.3).
		 */
		recent?: RecentBackend[];
		onpickrecent?: (r: RecentBackend) => void;
		/** Something is under way: the recent backends wait. */
		busy?: boolean;
		/** Fills the viewport, as the app's whole page. */
		page?: boolean;
		/** Classes for the page, added to its own. */
		class?: ClassValue;
	}
	let { children, recent, onpickrecent, busy = false, page = false, class: className }: Props = $props();
</script>

<!-- The connect screen's page: the card centered, and the recent backends under it. ConnectScreen is one, run by its props. -->
<div class={['ap-connect', page && 'ap-connect-page', className]}>
	{@render children?.()}
	{#if recent && recent.length > 0}
		<div class="ap-connect-recent" role="group" aria-label="Recent backends">
			<span class="ap-fieldlabel">Recent</span>
			{#each recent as r (r.url)}
				<button class="ap-connect-recent-item" type="button" disabled={busy} onclick={() => onpickrecent?.(r)}>
					{#if r.avatar}<img class="ap-rail-tile ap-connect-tile" src={r.avatar} alt="" />{:else}<span class="ap-rail-tile ap-connect-tile" aria-hidden="true">{initials(r.label || r.url)}</span>{/if}
					<span class="ap-room-text">
						<span class="ap-room-name">{r.label || r.url}</span>
						<span class="ap-room-topic ap-connect-address">{r.url}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
