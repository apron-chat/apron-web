<script lang="ts">
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Button from '$lib/design/components/Button.svelte';
	import Nudge from '$lib/design/components/Nudge.svelte';
	import { listNames } from '$lib/ui/membership';

	/**
	 * A message held back at Send because it mentions people and holds a checklist: let them edit its text
	 * (`ext:editors`), so they can tick it, or send it as only yours to change. Escape puts it away, with the message
	 * still in the composer. As a Nudge, it leaves the focus in the composer, so no key typed on answers it; the page
	 * reads it out as it arrives.
	 */
	interface Props {
		/** Who it mentions, by name. */
		names: string[];
		onshare: () => void;
		onsend: () => void;
		/** Escape: back to the message, unsent. */
		oncancel: () => void;
	}
	let { names, onshare, onsend, oncancel }: Props = $props();

	let title = $derived(`Let ${listNames(names)} edit this message?`);
	let detail = $derived(`${names.length === 1 ? 'They' : 'Each of them'} could tick its checklist and change its text.`);

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		oncancel();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editors-prompt" onkeydown={keydown}>
	<Nudge {title} {detail} pointer testid="editors-prompt">
		{#snippet icon()}<ListChecks size={16} strokeWidth={2} />{/snippet}
		{#snippet actions()}
			<Button size="sm" variant="ghost" label="Only I can edit" onclick={onsend} />
			<Button size="sm" variant="primary" label="Let them edit" onclick={onshare} />
		{/snippet}
	</Nudge>
</div>
