<script lang="ts">
	/*
	 * A rich message field for the Composer's `field`, in place of its textarea: an empty `contenteditable` (plain text
	 * only) that you fill and read yourself, such as to show mentions as chips. It shows the placeholder while `empty`.
	 */
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (an `id`, `data-*`, `aria-*`, its event handlers, a `class`) go on the field. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Shown while `empty`: the Composer's, from its `field` snippet. */
		placeholder?: string;
		/** Nothing is in it: the placeholder shows. */
		empty?: boolean;
		disabled?: boolean;
		/** The field's element, to fill and read; `bind:element`. */
		element?: HTMLDivElement;
	}
	let { placeholder, empty, disabled, element = $bindable(), class: className, ...rest }: Props = $props();
</script>

<!-- spread: a generic text field, which the caller fills, reads and wires itself; any attribute of it is the caller's -->
<!-- `role` after the spread: a contenteditable is announced as a text box only with it. -->
<div
	aria-label="Message"
	aria-multiline="true"
	aria-placeholder={placeholder}
	aria-disabled={disabled}
	data-placeholder={placeholder}
	tabindex={disabled ? -1 : 0}
	contenteditable={disabled ? 'false' : 'plaintext-only'}
	spellcheck="true"
	dir="auto"
	{...rest}
	class={['ap-composer-field', 'ap-composer-editable', empty && 'ap-composer-editable-empty', className]}
	role="textbox"
	bind:this={element}
></div>
