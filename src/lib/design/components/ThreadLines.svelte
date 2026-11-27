<script lang="ts">
	import * as icons from './Icons.svelte';

	interface Props {
		/** The thread's `description` (§3.4) as text, marked by a text icon. */
		description?: string;
		/** Its newest message, on the line after the description, marked by a reply arrow: its sender, then its text on one line. */
		latest?: { sender?: string; text: string };
		/** How many lines the description may take, its line breaks kept; one (the default) runs it together on a line. */
		descriptionLines?: number;
		/** A `data-testid` for the description's line. */
		descriptionTestid?: string;
		/** A `data-testid` for the newest message's line. */
		latestTestid?: string;
	}
	let { description, latest, descriptionLines = 1, descriptionTestid, latestTestid }: Props = $props();
	/** Shared by a thread's sidebar row (RoomItem) and its card in the room (ThreadMarker), so the two preview it alike. */
	const multi = $derived(descriptionLines > 1);
	const descriptionText = $derived(multi ? description?.trim() : description?.replace(/\s+/g, ' ').trim());
</script>

{#if descriptionText}<span class={['ap-tline', 'ap-tline-description', multi && 'ap-tline-multi']} style:--ap-tline-lines={multi ? descriptionLines : undefined} data-testid={descriptionTestid}><span class="ap-tline-icon" role="img" aria-label="Description">{@render icons.textAlignStart()}</span><span class="ap-tline-text">{descriptionText}</span></span>{/if}{#if latest}<span class="ap-tline ap-tline-latest" data-testid={latestTestid}><span class="ap-tline-icon" role="img" aria-label="Latest message">{@render icons.cornerDownRight()}</span><span class="ap-tline-text">{#if latest.sender}<span class="ap-tline-sender">{latest.sender}</span>{' '}{/if}{latest.text}</span></span>{/if}
