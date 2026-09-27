<script lang="ts">
	import { sanitizeFontFamily } from '$lib/ui/appearance.svelte';

	type FontBrowserState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'denied' | 'error' | 'empty';

	interface Props {
		id: string;
		label: string;
		hint: string;
		placeholder: string;
		value: string;
		fonts: string[];
		fontState: FontBrowserState;
		fallback: string;
		onloadfonts: () => void;
	}

	let { id, label, hint, placeholder, value = $bindable(), fonts, fontState, fallback, onloadfonts }: Props = $props();
	let open = $state(false);
	let activeIndex = $state(-1);
	let input = $state<HTMLInputElement | undefined>();
	let container = $state<HTMLDivElement | undefined>();
	let matches = $derived.by(() => {
		const query = value.trim().toLocaleLowerCase();
		return fonts.filter((family) => !query || family.toLocaleLowerCase().includes(query)).slice(0, 100);
	});

	function previewFamily(): string {
		const family = sanitizeFontFamily(value);
		return family ? `"${family}", ${fallback}` : fallback;
	}

	function focus(): void {
		open = true;
		activeIndex = -1;
	}

	function focusout(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && container?.contains(event.relatedTarget)) return;
		open = false;
		activeIndex = -1;
	}

	function choose(family: string): void {
		value = family;
		open = false;
		activeIndex = -1;
		input?.focus();
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
			activeIndex = -1;
		} else if (event.key === 'ArrowDown' && fontState === 'ready' && matches.length > 0) {
			event.preventDefault();
			open = true;
			activeIndex = (activeIndex + 1) % matches.length;
		} else if (event.key === 'ArrowUp' && fontState === 'ready' && matches.length > 0) {
			event.preventDefault();
			open = true;
			activeIndex = activeIndex <= 0 ? matches.length - 1 : activeIndex - 1;
		} else if (event.key === 'Enter' && open && activeIndex >= 0 && matches[activeIndex]) {
			event.preventDefault();
			choose(matches[activeIndex]);
		}
	}
</script>

<label class="field-label" for={id}>{label}</label>
<div class="font-combobox" bind:this={container} onfocusout={focusout}>
	<input
		{id}
		class="ap-field"
		bind:this={input}
		bind:value
		style:font-family={previewFamily()}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls="{id}-options"
		aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
		aria-describedby="{id}-hint"
		maxlength="64"
		placeholder={placeholder}
		autocomplete="off"
		onfocus={focus}
		oninput={() => (activeIndex = -1)}
		onkeydown={keydown}
	/>
	{#if open}
		<div class="font-options" id="{id}-options" role={fontState === 'ready' && matches.length > 0 ? 'listbox' : 'status'} aria-label={`${label} suggestions`} aria-live={fontState === 'ready' && matches.length > 0 ? undefined : 'polite'}>
			{#if fontState === 'idle'}
				<p class="font-status">Load installed fonts to filter suggestions. The browser may ask for permission.</p>
				<button class="font-load" type="button" onmousedown={(event) => event.preventDefault()} onclick={onloadfonts}>Load installed fonts</button>
			{:else if fontState === 'loading'}
				<p class="font-status">Requesting font access…</p>
			{:else if fontState === 'unsupported'}
				<p class="font-status">Installed-font suggestions aren’t supported here.</p>
			{:else if fontState === 'denied'}
				<p class="font-status">Font access denied. Allow it in browser site settings, or type a name.</p>
			{:else if fontState === 'error'}
				<p class="font-status">Couldn’t load fonts. You can still type a name.</p>
				<button class="font-load" type="button" onmousedown={(event) => event.preventDefault()} onclick={onloadfonts}>Try again</button>
			{:else if fontState === 'empty'}
				<p class="font-status">No installed font names are available.</p>
			{:else if fontState === 'ready' && matches.length > 0}
				{#each matches as family, index (family)}
					<button
						id="{id}-option-{index}"
						class="font-option"
						class:active={index === activeIndex}
						type="button"
						role="option"
						aria-selected={index === activeIndex}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => choose(family)}
					>{family}</button>
				{/each}
			{:else if fontState === 'ready'}
				<p class="font-status">No matching installed fonts.</p>
			{:else}
				<p class="font-status">Type to filter installed fonts.</p>
			{/if}
		</div>
	{/if}
</div>
<p class="ap-profedit-hint font-hint" id="{id}-hint">{hint}</p>

<style>
	.field-label { display: block; margin: var(--space-4) 0 var(--space-1); color: var(--ink); font-size: 13px; font-weight: 600; }
	.font-hint { margin-top: var(--space-1); }
	.font-combobox { position: relative; }
	.font-combobox > input { width: min(100%, 420px); }
	.font-options { position: absolute; z-index: 10; top: calc(100% + 3px); left: 0; width: min(100%, 420px); max-height: 210px; overflow-y: auto; padding: var(--space-1); background: var(--bg-200); border: 1px solid var(--line-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-popover); }
	.font-load { margin: 0 var(--space-2) var(--space-2); padding: 5px var(--space-2); color: var(--ink); background: var(--bg-300); border: 0; border-radius: var(--radius-sm); cursor: pointer; }
	.font-option { display: block; width: 100%; padding: 5px var(--space-2); color: var(--ink); text-align: left; background: transparent; border: 0; border-radius: var(--radius-sm); cursor: pointer; }
	.font-option:hover, .font-option.active { background: var(--bg-300); }
	.font-status { margin: 0; padding: var(--space-2); color: var(--ink-muted); font-size: 12px; line-height: 17px; }
</style>
