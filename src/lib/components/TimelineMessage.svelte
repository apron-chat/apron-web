<script lang="ts">
	import type { Snippet } from 'svelte';
	import Message from '$lib/design/components/Message.svelte';
	import type { MessageEmbed, MessageHandlers, MessageTestids, MessageView } from '$lib/design/components/types';

	/**
	 * A timeline row: `Message` drawing the view `row` makes. The view is worked out in an effect and kept as
	 * state, not as a derived, and that is the point. A row's view reads much of the page (the session, the
	 * open room, mentions, selection, permissions), so each new snapshot reaches it by dozens of paths, and
	 * Svelte marks everything under a derived again for every path that reaches it: each row's Message, for
	 * every row, dozens of times per snapshot. An effect stops that marking; it runs once, and Message hears of
	 * a change only when the view is a new one (`messageView` hands back the same view while nothing it draws
	 * changed).
	 */
	interface Props {
		row: () => MessageView;
		on: MessageHandlers;
		testids: MessageTestids;
		/** In place of the body while this row is being edited, given its view. */
		editor: (view: MessageView) => Snippet<[MessageView]> | undefined;
		embed: Snippet<[MessageEmbed]>;
	}
	let { row, on, testids, editor, embed }: Props = $props();

	// Set at once by the effect below, which first runs as the row is made, before anything draws.
	let view = $state.raw() as MessageView;
	$effect.pre(() => {
		view = row();
	});
</script>

<Message {view} {on} {testids} editor={editor(view)} {embed} />
