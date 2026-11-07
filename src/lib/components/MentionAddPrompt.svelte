<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Button from '$lib/design/components/Button.svelte';
	import Nudge from '$lib/design/components/Nudge.svelte';
	import { listNames } from '$lib/ui/membership';

	/**
	 * A message held back because it mentions people who aren't in the room or thread: add them and send it, or send it
	 * as it is. Escape puts it away, with the message still in the composer. As a Nudge, it leaves the focus where it
	 * is, in the composer: adding someone can't be taken back, so no key typed on (Space, a second Enter) may do it. Its
	 * buttons are a press, or Shift+Tab, away.
	 */
	interface Props {
		/** Who isn't in it, by name, as mentioned. */
		names: string[];
		/** Where the message goes: the room's or thread's title. */
		place: string;
		thread?: boolean;
		/** Adding them: the buttons wait. */
		busy?: boolean;
		onadd: () => void;
		onsend: () => void;
		/** Escape: back to the message, unsent. */
		oncancel: () => void;
	}
	let { names, place, thread = false, busy = false, onadd, onsend, oncancel }: Props = $props();

	let title = $derived(`Add ${listNames(names)} to ${place}?`);
	let detail = $derived(`You mentioned them, but they aren’t in this ${thread ? 'thread' : 'room'}.`);

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || busy) return;
		event.preventDefault();
		oncancel();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mention-add-prompt" onkeydown={keydown}>
	<Nudge {title} {detail} pointer testid="mention-add-prompt">
		{#snippet icon()}<UserPlus size={16} strokeWidth={2} />{/snippet}
		{#snippet actions()}
			<Button size="sm" variant="ghost" label="Send without adding" disabled={busy} onclick={onsend} />
			<Button size="sm" variant="primary" label={busy ? 'Adding…' : 'Add and send'} disabled={busy} onclick={onadd} />
		{/snippet}
	</Nudge>
</div>
