<script lang="ts">
	import Bell from '@lucide/svelte/icons/bell';
	import Nudge from '$lib/design/components/Nudge.svelte';

	interface Props {
		/** Who mentioned you, by name. */
		from: string;
		/** Where: the room's or thread's title. */
		room: string;
		/** Push works here, so notifications reach this device with Apron closed too. */
		whenClosed: boolean;
		/** Points at Preferences (where the switch is), when it's on screen. */
		pointer?: boolean;
		/** Turn on: asks the browser from this tap, as the Notifications switch does. */
		onaccept: () => void;
		/** Not now, or Escape: a choice too, so it isn't offered again. */
		ondecline: () => void;
	}
	let { from, room, whenClosed, pointer = false, onaccept, ondecline }: Props = $props();

	let detail = $derived(`${from} mentioned you in ${room}. Apron can alert you on this device${whenClosed ? ', even when it’s closed' : ' while it’s open'}.`);

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		ondecline();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notify-prompt" onkeydown={keydown}>
	<Nudge title="Get notified when you’re mentioned?" {detail} note={pointer ? 'You can change this any time in Preferences.' : undefined} {pointer} testid="notify-prompt">
		{#snippet icon()}<Bell size={16} strokeWidth={2} />{/snippet}
		{#snippet actions()}
			<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={ondecline}>Not now</button>
			<button class="ap-btn ap-btn-primary ap-btn-sm" type="button" onclick={onaccept}>Turn on</button>
		{/snippet}
	</Nudge>
</div>
