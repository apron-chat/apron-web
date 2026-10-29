<script lang="ts">
	import type { ReactionChip } from './types';

	const PALETTE = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '✅'];
	const LONG_PRESS_MS = 500;
	/** A touch that drifts further than this is a scroll, not a long press. */
	const SLOP_PX = 10;

	interface Props {
		reactions: ReactionChip[];
		/** The palette is open under the message. */
		open?: boolean;
		/** No capability `reactions`, or the session can't send now: chips render but don't toggle, and stay focusable so `onreactors` still works. */
		disabled?: boolean;
		/** Toggle your own emoji; send your complete set with `reactions`. */
		ontoggle?: (emoji: string) => void;
		/** The + after the chips, which opens the palette; false leaves it out, such as where reacting starts elsewhere. */
		add?: boolean;
		onopen?: () => void;
		onclose?: () => void;
		/**
		 * A right-click (or the context menu key) or a long touch press on a chip: show who reacted, beside `chip`.
		 * The click that ends a long press doesn't toggle.
		 */
		onreactors?: (emoji: string, chip: HTMLElement) => void;
		/** A `data-testid` for each chip, which also carries its emoji as `data-emoji`. */
		chipTestid?: string;
		/** On the group of chips. */
		'data-testid'?: string;
	}
	let { reactions, open, disabled, ontoggle, add = true, onopen, onclose, onreactors, chipTestid, 'data-testid': testid }: Props = $props();
	const chips = $derived((reactions || []).filter((r) => r.count > 0));
	const mine = $derived(new Set(chips.filter((c) => c.mine).map((c) => c.emoji)));

	let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;
	/** A long press showed who reacted: the click that ends it doesn't toggle. */
	let held = false;

	function contextmenu(event: MouseEvent, emoji: string): void {
		if (!onreactors) return;
		event.preventDefault();
		onreactors(emoji, event.currentTarget as HTMLElement);
	}

	/* Touch has no right-click or hover: a long press shows who reacted. */
	function pointerdown(event: PointerEvent, emoji: string): void {
		cancelPress();
		held = false;
		if (!onreactors || event.pointerType !== 'touch') return;
		const anchor = event.currentTarget as HTMLElement;
		press = {
			timer: setTimeout(() => {
				press = undefined;
				held = true;
				onreactors?.(emoji, anchor);
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
		if (disabled) {
			held = false;
			return;
		}
		// A keyboard press (no pointer, `detail` 0) always toggles.
		if (held && event.detail !== 0) {
			held = false;
			return;
		}
		ontoggle?.(emoji);
	}

	$effect(() => cancelPress);
</script>

{#if chips.length > 0}
	<div class="ap-reactions" role="group" aria-label="Reactions" data-testid={testid}>
		{#each chips as c (c.emoji)}
			<button
				type="button"
				class={['ap-rchip', c.mine && 'ap-rchip-mine']}
				data-testid={chipTestid}
				data-emoji={c.emoji}
				aria-pressed={!!c.mine}
				title={c.title ?? (c.who ? `${c.who} reacted with ${c.emoji}` : c.emoji)}
				aria-label={c.label ?? `${c.emoji} ${c.count}${c.mine ? ', including yours. Remove yours' : '. Add yours'}`}
				aria-disabled={!!disabled}
				onclick={(event) => click(event, c.emoji)}
				oncontextmenu={(event) => contextmenu(event, c.emoji)}
				onpointerdown={(event) => pointerdown(event, c.emoji)}
				onpointermove={pointermove}
				onpointerup={cancelPress}
				onpointercancel={cancelPress}
				onpointerleave={cancelPress}
			><span class="ap-rchip-emoji" aria-hidden="true">{#if c.image}<img class="ap-cemoji" src={c.image.src} alt="" style:aspect-ratio={c.image.width && c.image.height ? `${c.image.width} / ${c.image.height}` : '1 / 1'} />{:else if c.placeholder}<span class="ap-rchip-placeholder"></span>{:else}{c.emoji}{/if}</span><span class="ap-rchip-count" aria-hidden="true">{c.count}</span></button>
		{/each}
		{#if add && !disabled}<button type="button" class="ap-rchip ap-rchip-add" aria-label="Add a reaction" title="Add a reaction" onclick={onopen}>+</button>{/if}
	</div>
{/if}
{#if open}
	<div class="ap-rpalette" role="toolbar" tabindex="-1" aria-label="Pick a reaction" onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onclose?.(); } }}>
		{#each PALETTE as e (e)}
			<button type="button" class={['ap-rpick', mine.has(e) && 'ap-rpick-mine']} aria-pressed={mine.has(e)} aria-label="React with {e}" title={e} {disabled} onclick={() => { onclose?.(); ontoggle?.(e); }}>{e}</button>
		{/each}
		<button type="button" class="ap-rpick ap-rpick-close" aria-label="Close reactions" title="Close" onclick={onclose}>×</button>
	</div>
{/if}
