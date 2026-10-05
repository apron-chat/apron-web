<script lang="ts">
	import { tick, type Snippet } from 'svelte';

	/** One choice of a MenuButton: its value, a label, and an optional muted hint after it. */
	interface MenuChoice {
		value: string;
		label: string;
		hint?: string;
	}

	interface Props {
		/** The button's text. */
		label: string;
		choices: MenuChoice[];
		/** Called with the chosen value; the menu closes. */
		onselect: (value: string) => void;
		variant?: 'quiet' | 'primary' | 'ghost';
		size?: 'md' | 'sm';
		/** Where the menu opens: under the button (the default) or above it. */
		placement?: 'below' | 'above';
		disabled?: boolean;
		/** Open now; bindable. */
		open?: boolean;
		/** A picker: the current choice's value. Its items are radio items, this one checked, and it is focused as the menu opens. */
		selected?: string;
		/** Drawn before each choice's label, such as a status dot; it gets the choice's value. */
		lead?: Snippet<[string]>;
		/** Words for screen readers instead of `label`, such as "Status: Online". */
		ariaLabel?: string;
	}
	let { label, choices, onselect, variant = 'quiet', size = 'sm', placement = 'below', disabled = false, open = $bindable(false), selected, lead, ariaLabel }: Props = $props();

	let root = $state<HTMLElement | undefined>();
	let trigger = $state<HTMLButtonElement | undefined>();

	function items(): HTMLButtonElement[] {
		return [...(root?.querySelectorAll<HTMLButtonElement>('.ap-menu-item') ?? [])];
	}

	async function toggle(): Promise<void> {
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
			if (event.target === trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
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
			close(false);
		}
	}

	function outside(event: PointerEvent): void {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}
</script>

<svelte:window onpointerdown={outside} />

<div class="ap-menubtn" bind:this={root} onkeydown={keydown} role="presentation">
	<button bind:this={trigger} type="button" class={['ap-btn', 'ap-btn-' + variant, size === 'sm' && 'ap-btn-sm']} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} {disabled} onclick={toggle}>{label}</button>
	{#if open}
		<ul class={['ap-menu', placement === 'below' && 'ap-menu-below', selected !== undefined && 'ap-menu-pick']} role="menu" aria-label={ariaLabel ?? label}>
			{#each choices as choice (choice.value)}
				{@const on = selected !== undefined && choice.value === selected}
				<li role="none">
					<button class={['ap-menu-item', on && 'ap-menu-item-on']} type="button" role={selected !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={selected !== undefined ? on : undefined} onclick={() => choose(choice.value)}>
						<span class="ap-menu-label">{#if lead}<span class="ap-menu-lead">{@render lead(choice.value)}</span>{/if}{choice.label}</span>{#if choice.hint}<span class="ap-menu-hint">{choice.hint}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
