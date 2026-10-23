<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/** A button, and any attribute a `<button>` takes (`onclick`, `disabled`, `aria-*`, `data-testid`, …). */
	interface Props extends HTMLButtonAttributes {
		variant?: 'quiet' | 'primary' | 'ghost' | 'danger';
		size?: 'md' | 'sm';
		/** Plain label; `children` wins when both are given. */
		label?: string;
	}
	let { variant = 'quiet', size = 'md', label, class: className, type = 'button', children, ...rest }: Props = $props();
</script>

<!-- spread: a generic <button>; any button attribute is the caller's -->
<button {type} {...rest} class={['ap-btn', 'ap-btn-' + variant, size === 'sm' && 'ap-btn-sm', className]}>{#if children}{@render children()}{:else}{label}{/if}</button>
