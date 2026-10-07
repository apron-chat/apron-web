<script lang="ts">
	interface Props {
		/** What is happening, such as "Checking for new messages…" or "Loading messages…". */
		label: string;
		/** Placeholder message rows above it, while the timeline has nothing to show yet. */
		rows?: number;
		/**
		 * Float instead of taking a line in the timeline, for a check under messages already shown: placed just
		 * above the composer's row, it rests over the composer's top and moves nothing as it comes and goes.
		 */
		float?: boolean;
	}
	let { label, rows = 0, float = false }: Props = $props();

	/** Widths that vary like real messages, the same on every render so nothing shimmers into a new shape. */
	const WIDTHS = [['30%', '78%'], ['22%', '64%'], ['26%', '88%'], ['18%', '52%'], ['28%', '70%'], ['24%', '60%']];
</script>

{#snippet pill()}
	<!-- At the foot of the timeline, where new messages will appear; sticky, so it stays in view while reading back. -->
	<div class="ap-tlstatus" role="status"><span class="ap-tlstatus-pill"><span class="ap-tlstatus-spin" aria-hidden="true"></span>{label}</span></div>
{/snippet}

{#if rows > 0}
	<!-- Nothing shown yet: placeholder rows stand at the bottom, where the newest messages will. -->
	<div class="ap-tlload">
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
{:else if float}
	<!-- Zero-height anchor: the pill floats on it, in the gap above the composer, and takes no space. -->
	<div class="ap-tlstatus-float" role="status"><span class="ap-tlstatus-pill"><span class="ap-tlstatus-spin" aria-hidden="true"></span>{label}</span></div>
{:else}
	{@render pill()}
{/if}
