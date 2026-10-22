<script lang="ts">
	import Mention from '$lib/design/components/Mention.svelte';
	import { mentionLabel, mentionSegments } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';

	/**
	 * A line of plain message text, such as a reply's snippet, with mentions
	 * of known users and rooms shown as the Mention component, as in messages.
	 * They only read here: this sits inside controls (a reply quote jumps to
	 * its message), so nothing in it is itself clickable.
	 */
	let { text }: { text: string } = $props();

	let segments = $derived(mentionSegments(text, directory.resolve, directory.resolveRoom));
	// A user's chip reads `@name`, with their ID beside it when someone else shares the name (mentionLabel).
</script>

{#each segments as segment, index (index)}{#if typeof segment === 'string'}{segment}{:else if segment.target.kind === 'room'}<Mention roomId={segment.target.id} name={segment.target.title} hash={segment.hash} />{:else}<Mention user_id={segment.target.id} name={mentionLabel(segment).slice(1)} me={segment.target.me} />{/if}{/each}
