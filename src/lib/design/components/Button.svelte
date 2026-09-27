<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cx } from './util';

	interface Props extends HTMLButtonAttributes {
		variant?: 'quiet' | 'primary' | 'ghost' | 'danger';
		size?: 'md' | 'sm';
		/** Plain label; `children` wins when both are given. */
		label?: string;
		children?: Snippet;
	}
	let { variant = 'quiet', size = 'md', label, class: className, type = 'button', children, ...rest }: Props = $props();
</script>

<button {type} {...rest} class={cx('ap-btn', 'ap-btn-' + variant, size === 'sm' && 'ap-btn-sm', className)}>{#if children}{@render children()}{:else}{label}{/if}</button>
