<script lang="ts">
	import { tick } from 'svelte';

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
	}
	let { label, choices, onselect, variant = 'quiet', size = 'sm', placement = 'below', disabled = false, open = $bindable(false) }: Props = $props();

	let root = $state<HTMLElement | undefined>();
	let trigger = $state<HTMLButtonElement | undefined>();

	function items(): HTMLButtonElement[] {
		return [...(root?.querySelectorAll<HTMLButtonElement>('.ap-menu-item') ?? [])];
	}

	async function toggle(): Promise<void> {
		open = !open;
		if (open) {
			await tick();
			items()[0]?.focus();
		}
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
		if (!open) return;
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
	<button bind:this={trigger} type="button" class={['ap-btn', 'ap-btn-' + variant, size === 'sm' && 'ap-btn-sm']} aria-haspopup="menu" aria-expanded={open} {disabled} onclick={toggle}>{label}</button>
	{#if open}
		<ul class={['ap-menu', placement === 'below' && 'ap-menu-below']} role="menu" aria-label={label}>
			{#each choices as choice (choice.value)}
				<li role="none">
					<button class="ap-menu-item" type="button" role="menuitem" onclick={() => choose(choice.value)}>
						<span>{choice.label}</span>{#if choice.hint}<span class="ap-menu-hint">{choice.hint}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
