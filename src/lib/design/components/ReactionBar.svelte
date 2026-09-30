<script lang="ts">
	import type { ReactionChip } from './types';

	const PALETTE = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '✅'];

	interface Props {
		reactions: ReactionChip[];
		/** The palette is open under the message. */
		open?: boolean;
		palette?: string[];
		/** No capability `reactions`, or the session can't send now: chips render but don't toggle. */
		disabled?: boolean;
		/** Toggle your own emoji; send your complete set with `reactions`. */
		ontoggle?: (emoji: string) => void;
		onopen?: () => void;
		onclose?: () => void;
	}
	let { reactions, open, palette = PALETTE, disabled, ontoggle, onopen, onclose }: Props = $props();
	const chips = $derived((reactions || []).filter((r) => r.count > 0));
	const picks = $derived([...new Set(palette)]);
	const mine = $derived(new Set(chips.filter((c) => c.mine).map((c) => c.emoji)));
</script>

{#if chips.length > 0}
	<div class="ap-reactions" role="group" aria-label="Reactions">
		{#each chips as c (c.emoji)}
			<button
				type="button"
				class={['ap-rchip', c.mine && 'ap-rchip-mine']}
				aria-pressed={!!c.mine}
				title={c.who ? `${c.who} reacted with ${c.emoji}` : c.emoji}
				aria-label={`${c.emoji} ${c.count}${c.mine ? ', including yours. Remove yours' : '. Add yours'}`}
				{disabled}
				onclick={() => ontoggle?.(c.emoji)}
			><span class="ap-rchip-emoji" aria-hidden="true">{c.emoji}</span><span class="ap-rchip-count" aria-hidden="true">{c.count}</span></button>
		{/each}
		{#if !disabled}<button type="button" class="ap-rchip ap-rchip-add" aria-label="Add a reaction" title="Add a reaction" onclick={onopen}>+</button>{/if}
	</div>
{/if}
{#if open}
	<div class="ap-rpalette" role="toolbar" tabindex="-1" aria-label="Pick a reaction" onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onclose?.(); } }}>
		{#each picks as e (e)}
			<button type="button" class={['ap-rpick', mine.has(e) && 'ap-rpick-mine']} aria-pressed={mine.has(e)} aria-label="React with {e}" title={e} {disabled} onclick={() => { onclose?.(); ontoggle?.(e); }}>{e}</button>
		{/each}
		<button type="button" class="ap-rpick ap-rpick-close" aria-label="Close reactions" title="Close" onclick={onclose}>×</button>
	</div>
{/if}
