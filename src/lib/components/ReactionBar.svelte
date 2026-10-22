<script lang="ts">
	import DesignReactionBar from '$lib/design/components/ReactionBar.svelte';
	import type { ReactionChip } from '$lib/ui/reactions';
	import { reactorsList } from '$lib/ui/reactors.svelte';

	interface Props {
		/** One chip per emoji on the message; empty for tombstones and messages nobody reacted to. */
		chips: ReactionChip[];
		/** The server takes reactions and the session can send them now. */
		enabled: boolean;
		/** Adds the emoji to your set, or removes it when it is already there. */
		ontoggle: (emoji: string) => void;
	}
	let { chips, enabled, ontoggle }: Props = $props();

	/** Who reacted, read from the current chips, so the open list follows changes. */
	function showReactors(emoji: string, anchor: HTMLElement): void {
		reactorsList.open({ anchor, emoji, reactors: () => chips.find((chip) => chip.emoji === emoji)?.reactors ?? [] });
	}
</script>

<!-- A right-click, the context menu key or a long press on a chip lists who reacted; the message's React action opens the picker. -->
<DesignReactionBar reactions={chips} disabled={!enabled} add={false} {ontoggle} onreactors={showReactors} testid="reactions" chipTestid="reaction-chip" />
