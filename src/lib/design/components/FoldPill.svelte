<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';

	/**
	 * The "…" of a list folded to what has news (a room's threads, a FoldHeading's list): it says the list is cut short,
	 * and shows it all.
	 */
	interface Props {
		/** Its accessible name, such as "Show all threads in general". */
		label: string;
		title?: string;
		testid?: string;
		onclick?: (event: MouseEvent) => void;
	}
	let { label, title = 'Show all', testid, onclick }: Props = $props();
</script>

<button type="button" class="ap-foldpill" data-testid={testid} aria-label={label} {title} {onclick}><Ellipsis size={14} aria-hidden="true" /></button>
