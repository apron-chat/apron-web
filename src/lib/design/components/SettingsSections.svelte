<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/**
		 * Each section: its nav label, which also heads it, and the heading's id. The heading is for screen readers
		 * only: the open tab, beside it, says it already.
		 */
		sections: Array<{ value: string; label: string; id: string }>;
		/** The open section's `value`: `bind:current`. */
		current: string;
		/** The open section's settings, such as SettingRows, under its heading. */
		children?: Snippet;
		/** Classes for the body (the nav and the open section's box), added to its own. */
		class?: ClassValue;
	}
	let { sections, current = $bindable(), children, class: className }: Props = $props();
	let nav = $state<HTMLElement | undefined>();
	// On a phone the nav is a strip that scrolls: the open section's tab is scrolled to, never left off its edge.
	$effect(() => {
		void current;
		nav?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	});
</script>

<!-- A settings dialog's body (Dialog's `flush`): a nav of sections beside the open one, which scrolls on its own and starts with its first setting. -->
<div class={['ap-preferences-body', className]}>
	<nav class="ap-preferences-nav" aria-label="Preference sections" bind:this={nav}>
		{#each sections as section (section.value)}
			<button type="button" aria-current={current === section.value ? 'page' : undefined} onclick={() => (current = section.value)}>{section.label}</button>
		{/each}
	</nav>
	{#each sections as section (section.value)}
		{#if section.value === current}
			<section class="ap-preferences-content" aria-labelledby={section.id}>
				<h3 id={section.id} class="ap-sr">{section.label}</h3>
				{@render children?.()}
			</section>
		{/if}
	{/each}
</div>
