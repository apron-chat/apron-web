<script lang="ts">
	import type { ReactionChip } from '$lib/ui/reactions';

	interface Props {
		/** One chip per emoji on the message; empty for tombstones and messages nobody reacted to. */
		chips: ReactionChip[];
		/** The server takes reactions and the session can send them now. */
		enabled: boolean;
		/** Adds the emoji to your set, or removes it when it is already there. */
		ontoggle: (emoji: string) => void;
	}
	let { chips, enabled, ontoggle }: Props = $props();
</script>

{#if chips.length > 0}
	<div class="reactions" role="group" aria-label="Reactions" data-testid="reactions">
		{#each chips as chip (chip.emoji)}
			<button
				class="chip"
				class:mine={chip.mine}
				type="button"
				data-testid="reaction-chip"
				data-emoji={chip.emoji}
				aria-pressed={chip.mine}
				aria-label={chip.label}
				title={chip.title}
				disabled={!enabled}
				onclick={() => ontoggle(chip.emoji)}
			><span class="emoji" aria-hidden="true">{chip.emoji}</span><span class="count" aria-hidden="true">{chip.count}</span></button>
		{/each}
	</div>
{/if}

<style>
	.reactions { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-1); max-width: 100%; }
	.chip {
		font: inherit; display: inline-flex; align-items: center; gap: var(--space-1);
		height: 26px; padding: 0 var(--space-2); box-sizing: border-box;
		border: 1px solid var(--line); border-radius: var(--radius-full);
		background: var(--bg-200); color: var(--ink-muted);
		font-size: 13px; line-height: 16px; font-variant-numeric: tabular-nums; cursor: pointer;
		transition: background-color .12s ease, border-color .12s ease, color .12s ease;
	}
	.chip:hover:not(:disabled) { background: var(--bg-300); color: var(--ink); }
	.chip.mine { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
	.chip:disabled { cursor: default; }
	.emoji { font-family: var(--font-emoji); font-size: 15px; line-height: 16px; }
	.count { font-weight: 600; }
	.chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	@media (prefers-reduced-motion: reduce) {
		.chip { transition: none; }
	}
</style>
