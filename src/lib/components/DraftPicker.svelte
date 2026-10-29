<script lang="ts">
	import type { DraftField } from '$lib/ui/draft-field.svelte';
	import AutocompletePicker from './AutocompletePicker.svelte';

	/** The autocomplete open in a `DraftField`, if one is: the people an `@` can name, the rooms a `#` can, or the emoji a `:` can put in. */
	interface Props {
		draft: DraftField;
		/** A `data-testid` for the people's list. */
		testid?: string;
	}
	let { draft, testid }: Props = $props();
</script>

{#if draft.pickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.query ?? ''} people={draft.matches} active={draft.activeIndex} {testid} onpick={(index) => draft.pick(draft.matches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.roomPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.roomFound?.query ?? ''} rooms={draft.roomMatches} active={draft.activeIndex} onpick={(index) => draft.pickRoom(draft.roomMatches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.emojiPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.emojiFound?.query ?? ''} emoji={draft.emojiMatches} active={draft.activeIndex} onpick={(index) => draft.pickEmoji(draft.emojiMatches[index])} onhover={(index) => draft.hover(index)} />
{/if}
