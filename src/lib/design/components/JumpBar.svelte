<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { chain, count99 } from './util';

	/** Other attributes (`data-*`, `class`, …) go on its outermost element: the dock when `docked`, else the bar or the button. */
	interface Props extends HTMLAttributes<HTMLElement> {
		count?: number;
		onjump?: () => void;
		/** unread mentions below the fold */
		mentions?: number;
		onjumpmention?: () => void;
		/** In a pane, right above the composer: the bar centred at the timeline's width, the button floating over the timeline's bottom-right corner without taking space. */
		docked?: boolean;
		/** A `data-testid` for the jump button. */
		buttonTestid?: string;
	}
	let { count, onjump, mentions = 0, onjumpmention, docked, buttonTestid, class: className, ...rest }: Props = $props();
	/** The round button, or the rust bar when there are `mentions`. */
	const fab = $derived(!mentions);
	const label = $derived((mentions === 1 ? 'You were mentioned' : `You were mentioned ${mentions} times`) + (count ? ` · ${count} new` : ''));
</script>

{#snippet jump(attributes: HTMLAttributes<HTMLElement>)}
	{#if fab}
		<button type="button" data-testid={buttonTestid} aria-label={count ? `${count === 1 ? '1 new message' : `${count} new messages`}, jump to latest` : 'Jump to latest'} title="Jump to latest" {...attributes} class={['ap-jumpfab', attributes.class]} onclick={chain(onjump, attributes.onclick)}>
			<span aria-hidden="true">↓</span>{#if count}<span class="ap-count ap-jumpfab-count">{count99(count)}</span>{/if}
		</button>
	{:else}
		<div role="status" {...attributes} class={['ap-jumpbar', 'ap-jumpbar-at', attributes.class]}>
			<span class="ap-count ap-count-at" aria-hidden="true">@</span>
			<span class="ap-jumpbar-text">{label}</span>
			<button type="button" class="ap-jumpbar-btn" data-testid={buttonTestid} onclick={onjumpmention ?? onjump}>Jump to mention</button>
		</div>
	{/if}
{/snippet}

{#if docked}
	<!-- The button's anchor has no height: it floats over the timeline rather than taking a line. -->
	<div {...rest} class={[fab ? 'ap-jump-dock-fab' : 'ap-jump-dock', className]}>{@render jump({})}</div>
{:else}
	{@render jump({ ...rest, class: className })}
{/if}
