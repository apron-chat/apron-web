<script lang="ts">
	import type { ReactionChip } from '$lib/ui/reactions';
	import { reactorsList } from '$lib/ui/reactors.svelte';

	const LONG_PRESS_MS = 500;
	/** A touch that drifts further than this is a scroll, not a long press. */
	const SLOP_PX = 10;

	interface Props {
		/** One chip per emoji on the message; empty for tombstones and messages nobody reacted to. */
		chips: ReactionChip[];
		/** The server takes reactions and the session can send them now. */
		enabled: boolean;
		/** Adds the emoji to your set, or removes it when it is already there. */
		ontoggle: (emoji: string) => void;
	}
	let { chips, enabled, ontoggle }: Props = $props();

	let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;
	/** A long press opened the list: the click that ends it doesn't toggle. */
	let held = false;

	/** Who reacted, read from the current chips, so the open list follows changes. */
	function showReactors(anchor: HTMLElement, emoji: string): void {
		reactorsList.open({ anchor, emoji, reactors: () => chips.find((chip) => chip.emoji === emoji)?.reactors ?? [] });
	}

	/** Right-click, or the keyboard's context menu key, lists who reacted. */
	function contextmenu(event: MouseEvent, emoji: string): void {
		event.preventDefault();
		showReactors(event.currentTarget as HTMLElement, emoji);
	}

	/** Touch has no right-click or hover: a long press lists who reacted. */
	function pointerdown(event: PointerEvent, emoji: string): void {
		cancelPress();
		held = false;
		if (event.pointerType !== 'touch') return;
		const anchor = event.currentTarget as HTMLElement;
		press = {
			timer: setTimeout(() => {
				press = undefined;
				held = true;
				showReactors(anchor, emoji);
			}, LONG_PRESS_MS),
			x: event.clientX,
			y: event.clientY
		};
	}

	function pointermove(event: PointerEvent): void {
		if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) cancelPress();
	}

	function cancelPress(): void {
		if (!press) return;
		clearTimeout(press.timer);
		press = undefined;
	}

	function click(event: MouseEvent, emoji: string): void {
		// A keyboard press (no pointer, `detail` 0) always toggles.
		if (held && event.detail !== 0) {
			held = false;
			return;
		}
		ontoggle(emoji);
	}

	$effect(() => cancelPress);
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
				aria-disabled={!enabled}
				onclick={(event) => { if (enabled) click(event, chip.emoji); else held = false; }}
				oncontextmenu={(event) => contextmenu(event, chip.emoji)}
				onpointerdown={(event) => pointerdown(event, chip.emoji)}
				onpointermove={pointermove}
				onpointerup={cancelPress}
				onpointercancel={cancelPress}
				onpointerleave={cancelPress}
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
		font-size: var(--text-ui); line-height: 16px; font-variant-numeric: tabular-nums; cursor: pointer;
		transition: background-color .12s ease, border-color .12s ease, color .12s ease;
		/* A long press lists who reacted: no text selection or callout on top of it. */
		-webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
	}
	.chip:hover:not([aria-disabled='true']) { background: var(--bg-300); color: var(--ink); }
	.chip.mine { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
	.chip[aria-disabled='true'] { cursor: default; }
	.emoji { font-family: var(--font-emoji); font-size: var(--text-body); line-height: 16px; }
	.count { font-weight: 600; }
	.chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	@media (prefers-reduced-motion: reduce) {
		.chip { transition: none; }
	}
</style>
