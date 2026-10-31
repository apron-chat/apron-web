<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** What is happening, such as "Checking for new messages…" or "Loading messages…". */
		label: string;
		/** Placeholder message rows above it, while the timeline has nothing to show yet. */
		rows?: number;
		/**
		 * Float instead of taking a line in the timeline, for a check under messages already shown: placed just
		 * above the composer's row, it floats a small gap above the composer and moves nothing as it comes and goes.
		 */
		float?: boolean;
		/**
		 * At the top instead, for older messages loading above those shown: placed just before the timeline, outside
		 * it, it floats over the top of what's shown, where the floating day goes, and takes no space either.
		 */
		top?: boolean;
		/** In place of the pill, such as a <RateLimitNotice> while the load waits for the server; it says its own status. */
		notice?: Snippet;
		/** Classes for its outermost element, added to its own. */
		class?: ClassValue;
	}
	let { label, rows = 0, float = false, top = false, notice, class: className }: Props = $props();

	/** Widths that vary like real messages, the same on every render so nothing shimmers into a new shape. */
	const WIDTHS = [['30%', '78%'], ['22%', '64%'], ['26%', '88%'], ['18%', '52%'], ['28%', '70%'], ['24%', '60%']];
</script>

{#snippet pill(pillClass?: ClassValue)}
	<!-- At the foot of the timeline, where new messages will appear; sticky, so it stays in view while reading back. -->
	{#if notice}<div class={['ap-tlstatus', pillClass]}>{@render notice()}</div>
	{:else}<div role="status" class={['ap-tlstatus', pillClass]}><span class="ap-tlstatus-pill"><span class="ap-tlstatus-spin" aria-hidden="true"></span>{label}</span></div>{/if}
{/snippet}

{#if rows > 0}
	<!-- Nothing shown yet: placeholder rows stand at the bottom, where the newest messages will. -->
	<div class={['ap-tlload', className]}>
		<div class="ap-skel-rows" aria-hidden="true">
			{#each { length: rows } as _, index (index)}
				{@const [name, text] = WIDTHS[index % WIDTHS.length]}
				<div class="ap-skel-row">
					<span class="ap-skel ap-skel-avatar"></span>
					<span class="ap-skel-lines"><span class="ap-skel ap-skel-name" style:width={name}></span><span class="ap-skel ap-skel-text" style:width={text}></span></span>
				</div>
			{/each}
		</div>
		{@render pill()}
	</div>
{:else if top}
	<div role="status" class={['ap-tlstatus-top', className]}><span class="ap-tlstatus-pill"><span class="ap-tlstatus-spin" aria-hidden="true"></span>{label}</span></div>
{:else if float}
	<!-- Zero-height anchor: the pill floats on it, in the gap above the composer, and takes no space. -->
	{#if notice}<div class={['ap-tlstatus-float', className]}>{@render notice()}</div>
	{:else}<div role="status" class={['ap-tlstatus-float', className]}><span class="ap-tlstatus-pill"><span class="ap-tlstatus-spin" aria-hidden="true"></span>{label}</span></div>{/if}
{:else}
	{@render pill(className)}
{/if}
