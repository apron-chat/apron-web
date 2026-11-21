<script lang="ts">
	import CommandEntry from './CommandEntry.svelte';
	import type { ReferenceCommand } from './types';

	/**
	 * Above the Composer while a command's arguments are typed: that command's entry, as the CommandReference shows it
	 * (its `/name` and hint, description, and what it requires), where the MentionPicker sits. It only informs, the field
	 * keeping its keys; a screen reader hears it as it changes, politely.
	 */
	interface Props {
		command: ReferenceCommand;
		/** A `data-testid` for the card. */
		testid?: string;
	}
	let { command, testid }: Props = $props();
</script>

<div class="ap-mpick" role="status" data-testid={testid}>
	<dl class="ap-keys-list ap-mpick-empty"><CommandEntry {command} /></dl>
</div>
