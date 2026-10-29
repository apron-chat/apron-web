<script lang="ts">
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { ContextMenuChoice } from './types';

	/**
	 * A menu at a point, such as where a row was right-clicked or held (the `hold` attachment), fixed to the viewport
	 * and kept inside it. Opened from the keyboard (`keyboard`) it has its first choice focused, and otherwise the menu
	 * itself, with no ring: ↑ ↓ Home End move, Enter chooses, Escape or a press anywhere else closes it, and focus goes
	 * back to `returnFocus`. A choice's `icon` leads it; a `danger` choice is drawn in the danger color.
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
		choices: ContextMenuChoice[];
		/** Called with the chosen value; the menu closes first. */
		onselect: (value: string) => void;
		/** Where focus goes back to as it closes, such as the row it was opened on. */
		returnFocus?: HTMLElement;
		/** Its `id`, for what opened it to name in `aria-controls`. */
		id?: string;
		/** A `data-testid` for the menu. */
		testid?: string;
		class?: ClassValue;
	}
	let { open = $bindable(false), x, y, keyboard = false, label, choices, onselect, returnFocus, id, testid, class: className }: Props = $props();

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

	/** Its keys are its own: none goes on to the page (Escape there would also put a message selection away). */
	function keydown(event: KeyboardEvent): void {
		const list = items();
		const now = list.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape' || event.key === 'Tab') close(true);
		else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			// From the menu itself (opened by a pointer), ↓ goes to the first choice and ↑ to the last.
			const next = now < 0 ? (event.key === 'ArrowDown' ? 0 : list.length - 1) : (now + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
			list[next]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
		else return;
		event.preventDefault();
		event.stopPropagation();
	}

	function outside(event: PointerEvent): void {
		if (open && menu && !menu.contains(event.target as Node)) close(false);
	}

	/** Put away, focus back where it was if it was in the menu: on a resize, or a scroll that moves what it was opened on. */
	function dismiss(): void {
		if (open) close(Boolean(menu?.contains(document.activeElement)));
	}

	$effect(() => {
		if (!open) return;
		// Captured, for a scroll anywhere (the member list scrolls itself, not the window).
		const scrolled = (event: Event) => {
			if (!menu?.contains(event.target as Node)) dismiss();
		};
		addEventListener('scroll', scrolled, true);
		return () => removeEventListener('scroll', scrolled, true);
	});
</script>

<svelte:window onpointerdown={outside} onresize={dismiss} />

{#if open}
	<ul
		bind:this={menu} {id} class={['ap-menu', 'ap-menu-at', className]} role="menu" tabindex="-1" aria-label={label} data-testid={testid} onkeydown={keydown}
		style:left={at ? `${at.left}px` : undefined} style:top={at ? `${at.top}px` : undefined} style:visibility={at ? undefined : 'hidden'}
	>
		{#each choices as choice (choice.value)}
			<li role="none">
				<button class={['ap-menu-item', choice.danger && 'ap-menu-item-danger']} type="button" tabindex="-1" role="menuitem" data-testid={choice.testid} onclick={() => choose(choice.value)}>
					<span class="ap-menu-label">{#if choice.icon}<span class="ap-menu-lead"><choice.icon size={16} aria-hidden="true" /></span>{/if}{choice.label}</span>{#if choice.hint}<span class="ap-menu-hint">{choice.hint}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
