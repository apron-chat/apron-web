<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { initials } from './util';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** The card: a SignInForm, with a ConnectHeader as its `header`. */
		children?: Snippet;
		/** Backends signed in to before, offered under the card. */
		recent?: Array<{ url: string; label?: string }>;
		onpickrecent?: (r: { url: string; label?: string }) => void;
		/** Something is under way: the recent backends wait. */
		busy?: boolean;
		/** Fills the viewport, as the app's whole page. */
		page?: boolean;
	}
	let { children, recent, onpickrecent, busy = false, page = false, class: className, ...rest }: Props = $props();
</script>

<!-- The connect screen's page: the card centered, and the recent backends under it. ConnectScreen is one, run by its props. -->
<div {...rest} class={['ap-connect', page && 'ap-connect-page', className]}>
	{@render children?.()}
	{#if recent && recent.length > 0}
		<div class="ap-connect-recent" role="group" aria-label="Recent backends">
			<span class="ap-fieldlabel">Recent</span>
			{#each recent as r (r.url)}
				<button class="ap-connect-recent-item" type="button" disabled={busy} onclick={() => onpickrecent?.(r)}>
					<span class="ap-rail-tile ap-connect-tile" aria-hidden="true">{initials(r.label || r.url)}</span>
					<span class="ap-room-text">
						<span class="ap-room-name">{r.label || r.url}</span>
						<span class="ap-room-topic">{r.url}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
