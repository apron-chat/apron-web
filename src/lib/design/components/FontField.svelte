<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { chain } from './util';

	/**
	 * A label, the field and its hint, with no root of their own: extra attributes go on the field (the input). Its
	 * `onfocus`, `oninput` and `onkeydown` run before its own (`preventDefault()` skips that).
	 */
	interface Props extends HTMLInputAttributes {
		id: string;
		label: string;
		/** Under the field: what the font applies to. */
		hint: string;
		placeholder: string;
		/** The font family typed or picked: `bind:value`. */
		value: string;
		/** Installed font families to suggest (the Local Font Access API), filtered by what is typed. */
		fonts: string[];
		/**
		 * Where loading the installed fonts stands: `idle` offers Load installed fonts (the browser may ask),
		 * `ready` lists `fonts`; the rest say why there is no list.
		 */
		fontState: 'idle' | 'loading' | 'ready' | 'unsupported' | 'denied' | 'error' | 'empty';
		/** The CSS `font-family` the field shows its value in, such as the family typed with its fallback. */
		font?: string;
		/** Load installed fonts (or Try again): from the tap, so the browser sees the user asked. */
		onloadfonts: () => void;
	}

	let { id, label, hint, placeholder, value = $bindable(), fonts, fontState, font, onloadfonts, class: className, onfocus, oninput, onkeydown, ...rest }: Props = $props();
	let open = $state(false);
	let activeIndex = $state(-1);
	let input = $state<HTMLInputElement | undefined>();
	let container = $state<HTMLDivElement | undefined>();
	let matches = $derived.by(() => {
		const query = value.trim().toLocaleLowerCase();
		return fonts.filter((family) => !query || family.toLocaleLowerCase().includes(query)).slice(0, 100);
	});

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

<!-- A font family field: type a name, or pick from the installed fonts it suggests as you type. -->
<label class="ap-font-label" for={id}>{label}</label>
<div class="ap-font-combobox" bind:this={container} onfocusout={focusout}>
	<!-- The combobox wiring is the field's own: it follows the extra attributes. -->
	<input
		maxlength="64"
		autocomplete="off"
		{...rest}
		{id}
		class={['ap-field', className]}
		bind:this={input}
		bind:value
		style:font-family={font}
		placeholder={placeholder}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={open ? `${id}-options` : undefined}
		aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
		aria-describedby="{id}-hint"
		onfocus={chain(focus, onfocus)}
		oninput={chain(() => (activeIndex = -1), oninput)}
		onkeydown={chain(keydown, onkeydown)}
	/>
	{#if open}
		<div class="ap-font-options" id="{id}-options" role={fontState === 'ready' && matches.length > 0 ? 'listbox' : 'status'} aria-label={`${label} suggestions`} aria-live={fontState === 'ready' && matches.length > 0 ? undefined : 'polite'}>
			{#if fontState === 'idle'}
				<p class="ap-font-status">Load installed fonts to filter suggestions. The browser may ask for permission.</p>
				<button class="ap-font-load" type="button" onmousedown={(event) => event.preventDefault()} onclick={onloadfonts}>Load installed fonts</button>
			{:else if fontState === 'loading'}
				<p class="ap-font-status">Requesting font access…</p>
			{:else if fontState === 'unsupported'}
				<p class="ap-font-status">Installed-font suggestions aren’t supported here.</p>
			{:else if fontState === 'denied'}
				<p class="ap-font-status">Font access denied. Allow it in browser site settings, or type a name.</p>
			{:else if fontState === 'error'}
				<p class="ap-font-status">Couldn’t load fonts. You can still type a name.</p>
				<button class="ap-font-load" type="button" onmousedown={(event) => event.preventDefault()} onclick={onloadfonts}>Try again</button>
			{:else if fontState === 'empty'}
				<p class="ap-font-status">No installed font names are available.</p>
			{:else if fontState === 'ready' && matches.length > 0}
				{#each matches as family, index (family)}
					<button
						id="{id}-option-{index}"
						class="ap-font-option"
						class:ap-font-option-active={index === activeIndex}
						type="button"
						role="option"
						aria-selected={index === activeIndex}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => choose(family)}
					>{family}</button>
				{/each}
			{:else if fontState === 'ready'}
				<p class="ap-font-status">No matching installed fonts.</p>
			{:else}
				<p class="ap-font-status">Type to filter installed fonts.</p>
			{/if}
		</div>
	{/if}
</div>
<p class="ap-profedit-hint ap-font-hint" id="{id}-hint">{hint}</p>
