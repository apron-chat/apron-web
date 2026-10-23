<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		checked: boolean;
		/** What it turns on, for screen readers: the visible title beside it. */
		label: string;
		/** It can't change now: it stays focusable (`aria-disabled`), and `describedby` should say why. */
		locked?: boolean;
		/** The id of the note that explains it. */
		describedby?: string;
		/** Called with the value asked for; the owner decides whether `checked` follows. */
		onchange: (checked: boolean) => void;
		/** Classes for the switch's button, added to its own. */
		class?: ClassValue;
	}
	let { checked, label, locked = false, describedby, onchange, class: className }: Props = $props();

	function toggle(): void {
		if (!locked) onchange(!checked);
	}
</script>

<button type="button" aria-label={label} aria-describedby={describedby} class={['ap-switch', className]} role="switch" aria-checked={checked} aria-disabled={locked || undefined} onclick={toggle}><span></span></button>
