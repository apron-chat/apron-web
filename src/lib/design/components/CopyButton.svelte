<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import X from '@lucide/svelte/icons/x';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A Copy icon button: `oncopy` copies (the caller writes to the clipboard), and once it resolves true the button
	 * shows a check and says `copiedLabel` for a moment (`COPIED_MS`), then goes back to Copy. One that resolves false
	 * (the clipboard refused, as it can) shows an ✕ and says Couldn't copy for that moment instead. Either is also said
	 * aloud, by a status beside the button: a button's own name changing while it has focus isn't announced reliably.
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
	const FAILED = "Couldn't copy";

	/** What the last copy came to, while it's said. */
	let said = $state<'copied' | 'failed'>();
	let name = $derived(said === 'copied' ? copiedLabel : said === 'failed' ? FAILED : label);
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
		said = done ? 'copied' : 'failed';
		timer = setTimeout(() => (said = undefined), COPIED_MS);
	}
</script>

<!-- Before the button, out of the layout (`ap-sr`), so the button stays its row's last child. -->
<span class="ap-sr" role="status">{said ? name : ''}</span>
<button type="button" class={['ap-iconbtn', className]} aria-label={name} title={name} data-testid={testid} onclick={copy}>
	{#if said === 'copied'}<Check {size} aria-hidden="true" />{:else if said === 'failed'}<X {size} aria-hidden="true" />{:else}<Copy {size} aria-hidden="true" />{/if}
</button>
