<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { chain } from './util';

	/** Extra attributes go on the switch's button; an `onclick` runs before its own toggle (`preventDefault()` skips that). */
	interface Props extends Omit<HTMLButtonAttributes, 'onchange'> {
		checked: boolean;
		/** What it turns on, for screen readers: the visible title beside it. */
		label: string;
		/** It can't change now: it stays focusable (`aria-disabled`), and `describedby` should say why. */
		locked?: boolean;
		/** The id of the note that explains it. */
		describedby?: string;
		/** Called with the value asked for; the owner decides whether `checked` follows. */
		onchange: (checked: boolean) => void;
	}
	let { checked, label, locked = false, describedby, onchange, class: className, onclick, ...rest }: Props = $props();

	function toggle(): void {
		if (!locked) onchange(!checked);
	}
</script>

<!-- Its role and state are the switch's own: they follow the extra attributes. -->
<button type="button" aria-label={label} aria-describedby={describedby} {...rest} class={['ap-switch', className]} role="switch" aria-checked={checked} aria-disabled={locked || undefined} onclick={chain(toggle, onclick)}><span></span></button>
