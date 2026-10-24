<script lang="ts">
	import DesignJumpBar from '$lib/design/components/JumpBar.svelte';

	interface Props {
		/** Messages that arrived since the viewer scrolled up. */
		count: number;
		/** Mentions of the viewer among them. */
		mentions: number;
		onjump: () => void;
		onjumpmention: () => void;
	}
	let { count, mentions, onjump, onjumpmention }: Props = $props();
</script>

<!-- The mention bar centred above the composer, or the jump-to-latest button floating over the timeline's corner. -->
<DesignJumpBar docked {count} {mentions} {onjump} {onjumpmention} buttonTestid="jump-button" />
