<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { chain, count99 } from './util';

	/** Other attributes (`data-*`, `class`, …) go on its outermost element: the dock when `docked`, else the bar or the button. */
	interface Props extends HTMLAttributes<HTMLElement> {
		/** Default: the round `fab`, or the rust `bar` when there are `mentions`. */
		variant?: 'bar' | 'fab';
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
	let { variant, count, onjump, mentions = 0, onjumpmention, docked, buttonTestid, class: className, ...rest }: Props = $props();
	const fab = $derived(variant ? variant === 'fab' : !mentions);
	const label = $derived(
		mentions
			? (mentions === 1 ? 'You were mentioned' : `You were mentioned ${mentions} times`) + (count ? ` · ${count} new` : '')
			: count ? (count === 1 ? '1 new message' : `${count} new messages`) : 'You’re viewing older messages'
	);
</script>

{#snippet jump(attributes: HTMLAttributes<HTMLElement>)}
	{#if fab}
		<button type="button" data-testid={buttonTestid} aria-label={count ? `${count === 1 ? '1 new message' : `${count} new messages`}, jump to latest` : 'Jump to latest'} title="Jump to latest" {...attributes} class={['ap-jumpfab', attributes.class]} onclick={chain(onjump, attributes.onclick)}>
			<span aria-hidden="true">↓</span>{#if count}<span class="ap-count ap-jumpfab-count">{count99(count)}</span>{/if}
		</button>
	{:else}
		<div role="status" {...attributes} class={['ap-jumpbar', mentions && 'ap-jumpbar-at', attributes.class]}>
			{#if mentions}<span class="ap-count ap-count-at" aria-hidden="true">@</span>{/if}
			<span class="ap-jumpbar-text">{label}</span>
			<button type="button" class="ap-jumpbar-btn" data-testid={buttonTestid} onclick={mentions && onjumpmention ? onjumpmention : onjump}>{mentions ? 'Jump to mention' : count ? 'Jump to new' : 'Jump to latest'}</button>
		</div>
	{/if}
{/snippet}

{#if docked}
	<!-- The button's anchor has no height: it floats over the timeline rather than taking a line. -->
	<div {...rest} class={[fab ? 'ap-jump-dock-fab' : 'ap-jump-dock', className]}>{@render jump({})}</div>
{:else}
	{@render jump({ ...rest, class: className })}
{/if}
