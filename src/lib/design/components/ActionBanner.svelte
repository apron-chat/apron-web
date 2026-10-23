<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Extra attributes go on the banner (inside its float, when it floats). */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What happened, in a few words: "Apron has been updated". */
		title: string;
		/** One more line, such as what the action costs. */
		detail?: string;
		/** Drawn in an accent circle before the title, such as a reload arrow. */
		icon?: Snippet;
		/** The buttons: a quiet Later, then the one thing to do. */
		action?: Snippet;
		/** Floats over the page, at the top centre (across the top on phones), as a new version's notice does. */
		float?: boolean;
	}
	let { title, detail, icon, action, float, class: className, ...rest }: Props = $props();
</script>

{#snippet banner()}
	<!-- On the accent, since it offers something to do; StatusBanner's dots are for the connection's state. -->
	<div role="status" {...rest} class={['ap-banner', className]}>
		{#if icon}<span class="ap-banner-icon" aria-hidden="true">{@render icon()}</span>{/if}
		<span class="ap-banner-text">
			<span class="ap-banner-title">{title}</span>
			{#if detail}<span class="ap-banner-detail">{detail}</span>{/if}
		</span>
		{#if action}<span class="ap-banner-actions">{@render action()}</span>{/if}
	</div>
{/snippet}

{#if float}<div class="ap-banner-float">{@render banner()}</div>{:else}{@render banner()}{/if}
