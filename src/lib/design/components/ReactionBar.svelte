<script lang="ts">
	import type { ReactionChip } from './types';
	import { longPress } from './hold';
	import { smilePlus } from './ActionIcons.svelte';

	interface Props {
		reactions: ReactionChip[];
		/** No capability `reactions`, or the session can't send now: chips render but don't toggle, and stay focusable so `onreactors` still works. */
		disabled?: boolean;
		/** Toggle your own emoji; send your complete set with `reactions`. */
		ontoggle?: (emoji: string) => void;
		/** The + after the chips, which opens your picker beside `anchor`; false leaves it out. */
		add?: boolean;
		onopen?: (anchor: HTMLElement) => void;
		/** Your own picker is open from the +: its `aria-expanded`, and it stays shown meanwhile. */
		adding?: boolean;
		/** An attachment for the +, such as one that closes your picker when the button goes. */
		addAnchor?: (button: HTMLElement) => void | (() => void);
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
	let { reactions, disabled, ontoggle, add = true, onopen, adding, addAnchor, onreactors, chipTestid, 'data-testid': testid }: Props = $props();
	const chips = $derived((reactions || []).filter((r) => r.count > 0));

	/** A long press showed who reacted: the click that ends it doesn't toggle. */
	let held = false;
	/** The long press this bar started (`longPress`), which goes with it. */
	let pressed: object | undefined;

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
		pressed = longPress.start(event, () => {
			held = true;
			onreactors?.(emoji, anchor);
		});
	}

	function pointermove(event: PointerEvent): void {
		longPress.move(event);
	}

	function cancelPress(): void {
		longPress.cancel(pressed);
		pressed = undefined;
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

	const noAttach = () => {};
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
		{#if add && !disabled}<button type="button" class="ap-rchip ap-rchip-add" aria-label="Add a reaction" title="Add a reaction" aria-haspopup={adding === undefined ? undefined : 'dialog'} aria-expanded={adding === undefined ? undefined : adding} {@attach addAnchor ?? noAttach} onclick={(event) => onopen?.(event.currentTarget)}>{@render smilePlus()}</button>{/if}
	</div>
{/if}
