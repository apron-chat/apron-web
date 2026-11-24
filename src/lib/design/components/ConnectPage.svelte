<script lang="ts">
	import Star from '@lucide/svelte/icons/star';
	import X from '@lucide/svelte/icons/x';
	import { tick, type Snippet } from 'svelte';
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
		/** Star or unstar one: a star beside each, filled when it is starred. Without it, no star. */
		onstarrecent?: (r: RecentBackend, starred: boolean) => void;
		/** Take one off the list: an × beside each. Without it, no ×. */
		onforgetrecent?: (r: RecentBackend) => void;
		/** Something is under way: the recent backends wait. */
		busy?: boolean;
		/** Fills the viewport, as the app's whole page. */
		page?: boolean;
		/** Classes for the page, added to its own. */
		class?: ClassValue;
	}
	const FEW = 4;
	let all = $state(false);
	/** Show N more goes once pressed: focus moves to the first row it showed, not back to the top of the page. */
	async function showAll(event: MouseEvent): Promise<void> {
		const group = (event.currentTarget as HTMLElement).closest('[role="group"]');
		all = true;
		await tick();
		group?.querySelectorAll<HTMLElement>('.ap-connect-recent-item')[FEW]?.focus();
	}
	let { children, recent, onpickrecent, onstarrecent, onforgetrecent, busy = false, page = false, class: className }: Props = $props();
</script>

<!-- The connect screen's page: the card centered, and the recent backends under it. ConnectScreen is one, run by its props. -->
<div class={['ap-connect', page && 'ap-connect-page', className]}>
	{@render children?.()}
	{#if recent && recent.length > 0}
		<div class="ap-connect-recent" role="group" aria-label="Recent servers">
			<span class="ap-fieldlabel">Recent</span>
			{#each all ? recent : recent.slice(0, FEW) as r (r.url)}
				{@const name = r.label || r.url}
				<div class="ap-connect-recent-row">
					<button class="ap-connect-recent-item" type="button" disabled={busy} onclick={() => onpickrecent?.(r)}>
						{#if r.avatar}<img class="ap-rail-tile ap-connect-tile" src={r.avatar} alt="" />{:else}<span class="ap-rail-tile ap-connect-tile" aria-hidden="true">{initials(name)}</span>{/if}
						<span class="ap-room-text">
							<span class="ap-room-name">{name}</span>
							<span class="ap-room-topic ap-connect-address">{r.url}</span>
						</span>
					</button>
					{#if onstarrecent}
						<button type="button" class={['ap-iconbtn', 'ap-connect-recent-star', r.starred && 'ap-connect-recent-starred']} aria-pressed={Boolean(r.starred)} aria-label="Star {name}" title={r.starred ? 'Unstar: let it drop off the list in time' : 'Star: keep it at the top of the list'} disabled={busy} onclick={() => onstarrecent(r, !r.starred)}><Star size={16} aria-hidden="true" /></button>
					{/if}
					{#if onforgetrecent}
						<button type="button" class="ap-iconbtn" aria-label="Forget {name}" title="Forget: take it off the list" disabled={busy} onclick={() => onforgetrecent(r)}><X size={16} aria-hidden="true" /></button>
					{/if}
				</div>
			{/each}
			{#if !all && recent.length > FEW}<button class="ap-link ap-connect-recent-more" type="button" onclick={showAll}>Show {recent.length - FEW} more</button>{/if}
		</div>
	{/if}
</div>
