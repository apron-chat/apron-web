<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A Copy icon button: `oncopy` copies (the caller writes to the clipboard), and once it resolves true the button
	 * shows a check and says `copiedLabel` for a moment (`COPIED_MS`), then goes back to Copy.
	 */
	interface Props {
		/** Copies; resolves whether it did. */
		oncopy: () => boolean | Promise<boolean>;
		/** Its name and tooltip, such as "Copy the address". */
		label: string;
		/** Its name and tooltip once it copied; "Copied" unless said. */
		copiedLabel?: string;
		/** The glyph's size in px. */
		size?: number;
		/** Classes for its `<button>`, added to its own: where it sits, a smaller size. */
		class?: ClassValue;
		/** A `data-testid` for its `<button>`. */
		testid?: string;
	}
	let { oncopy, label, copiedLabel = 'Copied', size = 14, class: className, testid }: Props = $props();

	/** How long it says it copied, in ms. */
	const COPIED_MS = 1500;

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Gone: a copy that resolves later sets nothing. */
	let gone = false;
	$effect(() => () => {
		gone = true;
		clearTimeout(timer);
	});

	async function copy(): Promise<void> {
		const done = await oncopy();
		if (gone) return;
		clearTimeout(timer);
		// One that failed doesn't keep saying an earlier one copied.
		copied = done;
		if (!done) return;
		timer = setTimeout(() => (copied = false), COPIED_MS);
	}
</script>

<button type="button" class={['ap-iconbtn', className]} aria-label={copied ? copiedLabel : label} title={copied ? copiedLabel : label} data-testid={testid} onclick={copy}>
	{#if copied}<Check {size} aria-hidden="true" />{:else}<Copy {size} aria-hidden="true" />{/if}
</button>
