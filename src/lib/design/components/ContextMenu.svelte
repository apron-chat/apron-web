<script lang="ts">
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { MenuChoice } from './types';

	/**
	 * A menu at a point, such as where a row was right-clicked or held (the `hold` attachment), fixed to the viewport
	 * and kept inside it. Opened from the keyboard (`keyboard`) it has its first choice focused, and otherwise the menu
	 * itself, with no ring: ↑ ↓ Home End move, Enter chooses, Escape or a press anywhere else closes it, and focus goes
	 * back to `returnFocus`. A `danger` choice is drawn in the danger color.
	 */
	interface Props {
		/** Shown while true; bindable, and set false however it closes. */
		open?: boolean;
		/** Where it opens, in viewport px: its start corner (top left, or top right under `dir="rtl"`). */
		x: number;
		y: number;
		/** Opened from the keyboard (the context menu key): its first choice takes focus, ring and all. */
		keyboard?: boolean;
		/** Names the menu for screen readers, such as "Ada". */
		label: string;
		choices: (MenuChoice & { danger?: boolean })[];
		/** Called with the chosen value; the menu closes first. */
		onselect: (value: string) => void;
		/** Where focus goes back to as it closes, such as the row it was opened on. */
		returnFocus?: HTMLElement;
		/** A `data-testid` for the menu. */
		testid?: string;
		class?: ClassValue;
	}
	let { open = $bindable(false), x, y, keyboard = false, label, choices, onselect, returnFocus, testid, class: className }: Props = $props();

	let menu = $state<HTMLUListElement | undefined>();
	/** Its place once measured: moved back inside the viewport where it would overflow it. */
	let at = $state<{ left: number; top: number } | undefined>();
	const MARGIN = 8;

	$effect(() => {
		if (!open || !menu) return;
		void x;
		void y;
		const { width, height } = menu.getBoundingClientRect();
		const rtl = getComputedStyle(menu).direction === 'rtl';
		const start = rtl ? x - width : x;
		at = {
			left: Math.max(MARGIN, Math.min(start, innerWidth - width - MARGIN)),
			top: Math.max(MARGIN, Math.min(y, innerHeight - height - MARGIN))
		};
		void tick().then(() => (keyboard ? items()[0] : menu)?.focus());
	});

	function items(): HTMLButtonElement[] {
		return [...(menu?.querySelectorAll<HTMLButtonElement>('.ap-menu-item') ?? [])];
	}

	function close(refocus: boolean): void {
		open = false;
		at = undefined;
		if (refocus) returnFocus?.focus();
	}

	function choose(value: string): void {
		close(true);
		onselect(value);
	}

	function keydown(event: KeyboardEvent): void {
		const list = items();
		const now = list.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			list[(now + step + list.length) % list.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			close(true);
		}
	}

	function outside(event: PointerEvent): void {
		if (open && menu && !menu.contains(event.target as Node)) close(false);
	}
</script>

<svelte:window onpointerdown={outside} onresize={() => open && close(false)} />

{#if open}
	<ul
		bind:this={menu} class={['ap-menu', 'ap-menu-at', className]} role="menu" tabindex="-1" aria-label={label} data-testid={testid} onkeydown={keydown}
		style:left={at ? `${at.left}px` : undefined} style:top={at ? `${at.top}px` : undefined} style:visibility={at ? undefined : 'hidden'}
	>
		{#each choices as choice (choice.value)}
			<li role="none">
				<button class={['ap-menu-item', choice.danger && 'ap-menu-item-danger']} type="button" tabindex="-1" role="menuitem" data-testid={choice.testid} onclick={() => choose(choice.value)}>
					<span class="ap-menu-label">{choice.label}</span>{#if choice.hint}<span class="ap-menu-hint">{choice.hint}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
