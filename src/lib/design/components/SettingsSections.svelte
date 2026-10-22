<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Names the nav (its `aria-label`). */
		label?: string;
		/** Each section: its nav label, which also heads it, the line under the heading, and the heading's id. */
		sections: Array<{ value: string; label: string; hint?: string; id: string }>;
		/** The open section's `value`: `bind:current`. */
		current: string;
		/** The open section's settings, such as SettingRows, under its heading. */
		children?: Snippet;
	}
	let { label = 'Preference sections', sections, current = $bindable(), children }: Props = $props();
</script>

<!-- A settings dialog's body (Dialog's `flush`): a nav of sections beside the open one, which scrolls on its own. -->
<div class="ap-preferences-body">
	<nav class="ap-preferences-nav" aria-label={label}>
		{#each sections as section (section.value)}
			<button type="button" aria-current={current === section.value ? 'page' : undefined} onclick={() => (current = section.value)}>{section.label}</button>
		{/each}
	</nav>
	{#each sections as section (section.value)}
		{#if section.value === current}
			<section class="ap-preferences-content" aria-labelledby={section.id}>
				<h3 id={section.id}>{section.label}</h3>
				{#if section.hint}<p class="ap-profedit-hint">{section.hint}</p>{/if}
				{@render children?.()}
			</section>
		{/if}
	{/each}
</div>
