<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { chain } from './util';

	/** One choice of a MenuButton: its value, a label, and an optional muted hint after it. */
	interface MenuChoice {
		value: string;
		label: string;
		hint?: string;
		/** A `data-testid` for its item. */
		testid?: string;
	}

	/**
	 * Extra attributes go on its box (the button and the menu); an `onkeydown` there runs before its own keys
	 * (`preventDefault()` skips them). Its `onselect` is the choice's, not the DOM event.
	 */
	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onselect'> {
		/** The button's text; with `icon`, its name for screen readers and its tooltip. */
		label: string;
		/** Draws the button as an icon button instead, such as ⋯ for more actions. */
		icon?: Snippet;
		/** A `data-testid` for the button. */
		buttonTestid?: string;
		choices: MenuChoice[];
		/** Called with the chosen value; the menu closes. */
		onselect: (value: string) => void;
		disabled?: boolean;
		/**
		 * Working on the last choice, such as a request in flight: the button
		 * can't open (`aria-disabled`), but keeps focus, as a disabled one
		 * wouldn't.
		 */
		busy?: boolean;
		/** Open now; bindable. */
		open?: boolean;
		/** A picker: the current choice's value. Its items are radio items, this one checked, and it is focused as the menu opens. */
		selected?: string;
		/** Drawn before each choice's label, such as a status dot; it gets the choice's value. */
		lead?: Snippet<[string]>;
		/** Words for screen readers instead of `label`, such as "Status: Online". */
		ariaLabel?: string;
	}
	let {
		label, icon, buttonTestid, choices, onselect, disabled = false, busy = false, open = $bindable(false), selected, lead, ariaLabel,
		class: className, onkeydown, ...rest
	}: Props = $props();

	let root = $state<HTMLElement | undefined>();
	let trigger = $state<HTMLButtonElement | undefined>();

	function items(): HTMLButtonElement[] {
		return [...(root?.querySelectorAll<HTMLButtonElement>('.ap-menu-item') ?? [])];
	}

	async function toggle(): Promise<void> {
		if (busy && !open) return;
		if (open) close(false);
		else await show(Math.max(0, choices.findIndex((choice) => choice.value === selected)));
	}

	/** Opens the menu with this item (`-1`: the last) focused. */
	async function show(at: number): Promise<void> {
		open = true;
		await tick();
		const list = items();
		list[at < 0 ? list.length - 1 : at]?.focus();
	}

	function close(refocus: boolean): void {
		open = false;
		if (refocus) trigger?.focus();
	}

	function choose(value: string): void {
		close(true);
		onselect(value);
	}

	function keydown(event: KeyboardEvent): void {
		if (!open) {
			// On the closed button, the arrows open the menu at its first or last item.
			if (!busy && event.target === trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				void show(event.key === 'ArrowDown' ? 0 : -1);
			}
			return;
		}
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			list[(at + step + list.length) % list.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
		} else if (event.key === 'Tab') {
			// The items are out of the tab order (roving focus): back on the button, Tab moves on from it.
			close(true);
		}
	}

	function outside(event: PointerEvent): void {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}
</script>

<svelte:window onpointerdown={outside} />

<div role="presentation" {...rest} class={['ap-menubtn', className]} bind:this={root} onkeydown={chain(keydown, onkeydown)}>
	{#if icon}
		<button bind:this={trigger} type="button" class={['ap-iconbtn', open && 'ap-iconbtn-on']} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel ?? label} title={label} data-testid={buttonTestid} aria-disabled={busy ? 'true' : undefined} aria-busy={busy ? 'true' : undefined} {disabled} onclick={toggle}>{@render icon()}</button>
	{:else}
		<button bind:this={trigger} type="button" class="ap-btn ap-btn-quiet ap-btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} data-testid={buttonTestid} aria-disabled={busy ? 'true' : undefined} aria-busy={busy ? 'true' : undefined} {disabled} onclick={toggle}>{label}</button>
	{/if}
	{#if open}
		<ul class={['ap-menu', 'ap-menu-below', selected !== undefined && 'ap-menu-pick']} role="menu" aria-label={ariaLabel ?? label}>
			{#each choices as choice (choice.value)}
				{@const on = selected !== undefined && choice.value === selected}
				<li role="none">
					<button class={['ap-menu-item', on && 'ap-menu-item-on']} type="button" tabindex="-1" data-testid={choice.testid} role={selected !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={selected !== undefined ? on : undefined} onclick={() => choose(choice.value)}>
						<span class="ap-menu-label">{#if lead}<span class="ap-menu-lead">{@render lead(choice.value)}</span>{/if}{choice.label}</span>{#if choice.hint}<span class="ap-menu-hint">{choice.hint}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
