<script lang="ts">
	import { sanitizeFontFamily, type FontBrowserState } from '$lib/ui/appearance.svelte';
	import FontField from '$lib/design/components/FontField.svelte';

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
	/** The field shows what is typed in that font, once it is a family name, before the fallback. */
	let font = $derived.by(() => {
		const family = sanitizeFontFamily(value);
		return family ? `"${family}", ${fallback}` : fallback;
	});
</script>

<!-- The design system's FontField draws and runs the field; this previews the family typed in it. -->
<FontField {id} {label} {hint} {placeholder} bind:value {fonts} {fontState} {font} {onloadfonts} />
