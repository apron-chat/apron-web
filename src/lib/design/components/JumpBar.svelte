<script lang="ts">
	import { count99 } from './util';

	interface Props {
		/** Default: the round `fab`, or the rust `bar` when there are `mentions`. */
		variant?: 'bar' | 'fab';
		count?: number;
		onjump?: () => void;
		/** unread mentions below the fold */
		mentions?: number;
		onjumpmention?: () => void;
		/** In a pane, right above the composer: the bar centred at the timeline's width, the button floating over the timeline's bottom-right corner without taking space. */
		docked?: boolean;
		/** `data-testid` on the jump button. */
		testid?: string;
	}
	let { variant, count, onjump, mentions = 0, onjumpmention, docked, testid }: Props = $props();
	const fab = $derived(variant ? variant === 'fab' : !mentions);
	const label = $derived(
		mentions
			? (mentions === 1 ? 'You were mentioned' : `You were mentioned ${mentions} times`) + (count ? ` · ${count} new` : '')
			: count ? (count === 1 ? '1 new message' : `${count} new messages`) : 'You’re viewing older messages'
	);
</script>

{#snippet jump()}
	{#if fab}
		<button type="button" class="ap-jumpfab" data-testid={testid} onclick={onjump} aria-label={count ? `${count === 1 ? '1 new message' : `${count} new messages`}, jump to latest` : 'Jump to latest'} title="Jump to latest">
			<span aria-hidden="true">↓</span>{#if count}<span class="ap-count ap-jumpfab-count">{count99(count)}</span>{/if}
		</button>
	{:else}
		<div class={['ap-jumpbar', mentions && 'ap-jumpbar-at']} role="status">
			{#if mentions}<span class="ap-count ap-count-at" aria-hidden="true">@</span>{/if}
			<span class="ap-jumpbar-text">{label}</span>
			<button type="button" class="ap-jumpbar-btn" data-testid={testid} onclick={mentions && onjumpmention ? onjumpmention : onjump}>{mentions ? 'Jump to mention' : count ? 'Jump to new' : 'Jump to latest'}</button>
		</div>
	{/if}
{/snippet}

{#if docked}
	<!-- The button's anchor has no height: it floats over the timeline rather than taking a line. -->
	<div class={fab ? 'ap-jump-dock-fab' : 'ap-jump-dock'}>{@render jump()}</div>
{:else}
	{@render jump()}
{/if}
