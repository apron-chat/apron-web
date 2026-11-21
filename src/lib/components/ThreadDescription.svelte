<script lang="ts">
	import Description from '$lib/design/components/ThreadDescription.svelte';
	import DescriptionText from './DescriptionText.svelte';

	/**
	 * A room's or thread's description, its first lines under the header as the design system's ThreadDescription draws
	 * them (DescriptionText's rendering): Read all, or a click on it, opens the whole (`onexpand`), its × puts it away
	 * (`ondismiss`), and an edit of it kept as a draft says so and is taken up from there (`ondraft`).
	 */
	interface Props {
		description: string;
		thread: boolean;
		onopenroom: (roomId: string) => void;
		ondismiss: () => void;
		onexpand: () => void;
		draft?: boolean;
		ondraft?: () => void;
	}
	let { description, thread, onopenroom, ondismiss, onexpand, draft = false, ondraft }: Props = $props();
</script>

<Description label={thread ? 'Thread description' : 'Room description'} {ondismiss} {onexpand} {draft} {ondraft}>
	<DescriptionText {description} {onopenroom} testid="pane-description" />
</Description>
