<script lang="ts">
	import Bell from '@lucide/svelte/icons/bell';
	import Button from '$lib/design/components/Button.svelte';
	import Nudge from '$lib/design/components/Nudge.svelte';

	interface Props {
		/** Who mentioned you, or replied to you (`reply`), by name; with `room`, absent for the offer made at sign-in. */
		from?: string;
		/** Where: the room's or thread's title. */
		room?: string;
		/** `from` replied to one of your messages, rather than mentioning you. */
		reply?: boolean;
		/** Push works here, so notifications reach this device with Apron closed too. */
		whenClosed: boolean;
		/** Points at Preferences (where the switch is), when it's on screen. */
		pointer?: boolean;
		/** Turn on: asks the browser from this tap, as the Notifications switch does. */
		onaccept: () => void;
		/** Not now, or Escape: a choice too, so it isn't offered again. */
		ondecline: () => void;
	}
	let { from, room, reply = false, whenClosed, pointer = false, onaccept, ondecline }: Props = $props();

	let detail = $derived(`${from !== undefined && room !== undefined ? `${from} ${reply ? 'replied to you' : 'mentioned you'} in ${room}. ` : ''}Apron can alert you on this device${whenClosed ? ', even when it’s closed' : ' while it’s open'}.`);

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		ondecline();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notify-prompt" onkeydown={keydown}>
	<Nudge title="Get notified about mentions and replies?" {detail} note={pointer ? 'You can change this any time in Preferences.' : undefined} {pointer} testid="notify-prompt">
		{#snippet icon()}<Bell size={16} strokeWidth={2} />{/snippet}
		{#snippet actions()}
			<Button size="sm" variant="ghost" label="Not now" onclick={ondecline} />
			<Button size="sm" variant="primary" label="Turn on" onclick={onaccept} />
		{/snippet}
	</Nudge>
</div>
