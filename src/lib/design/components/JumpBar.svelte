<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { count99 } from './util';

	interface Props {
		count?: number;
		onjump?: () => void;
		/** unread mentions below the fold */
		mentions?: number;
		onjumpmention?: () => void;
		/** In a pane, right above the composer: the bar centred at the timeline's width, the button floating over the timeline's bottom-right corner without taking space. */
		docked?: boolean;
		/** A `data-testid` for the jump button. */
		buttonTestid?: string;
		/** Classes for its outermost element (the dock when `docked`, else the bar or the button), added to its own. */
		class?: ClassValue;
	}
	let { count, onjump, mentions = 0, onjumpmention, docked, buttonTestid, class: className }: Props = $props();
	/** The round button, or the rust bar when there are `mentions`. */
	const fab = $derived(!mentions);
	const label = $derived((mentions === 1 ? 'You were mentioned' : `You were mentioned ${mentions} times`) + (count ? ` · ${count} new` : ''));
</script>

{#snippet jump(jumpClass?: ClassValue)}
	{#if fab}
		<button type="button" data-testid={buttonTestid} aria-label={count ? `${count === 1 ? '1 new message' : `${count} new messages`}, jump to latest` : 'Jump to latest'} title="Jump to latest" class={['ap-jumpfab', jumpClass]} onclick={onjump}>
			<span aria-hidden="true">↓</span>{#if count}<span class="ap-count ap-jumpfab-count">{count99(count)}</span>{/if}
		</button>
	{:else}
		<div role="status" class={['ap-jumpbar', 'ap-jumpbar-at', jumpClass]}>
			<span class="ap-count ap-count-at" aria-hidden="true">@</span>
			<span class="ap-jumpbar-text">{label}</span>
			<button type="button" class="ap-jumpbar-btn" data-testid={buttonTestid} onclick={onjumpmention ?? onjump}>Jump to mention</button>
		</div>
	{/if}
{/snippet}

{#if docked}
	<!-- The button's anchor has no height: it floats over the timeline rather than taking a line. -->
	<div class={[fab ? 'ap-jump-dock-fab' : 'ap-jump-dock', className]}>{@render jump()}</div>
{:else}
	{@render jump(className)}
{/if}
