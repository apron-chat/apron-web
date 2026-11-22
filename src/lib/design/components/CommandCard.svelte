<script lang="ts">
	import CommandEntry from './CommandEntry.svelte';
	import type { ReferenceCommand } from './types';

	/**
	 * Above the Composer while a command's arguments are typed: that command's entry, as the CommandReference shows it
	 * (its `/name` and hint, description, and what it requires), where the MentionPicker sits. It only informs, the field
	 * keeping its keys: give it an `id` for the field's `aria-describedby`.
	 */
	interface Props {
		command: ReferenceCommand;
		/** Its ID, which the field it describes names in `aria-describedby`. */
		id?: string;
		/** A `data-testid` for the card. */
		testid?: string;
		/**
		 * Called as it's drawn, and what it returns as it goes: such as for the field to name it in `aria-describedby`
		 * for as long as it shows.
		 */
		onshow?: () => (() => void) | void;
	}
	let { command, id, testid, onshow }: Props = $props();
</script>

<div class="ap-mpick" {id} data-testid={testid} {@attach () => onshow?.()}>
	<dl class="ap-keys-list ap-cmdcard"><CommandEntry {command} /></dl>
</div>
