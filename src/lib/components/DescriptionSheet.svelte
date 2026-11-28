<script lang="ts">
	import { tick } from 'svelte';
	import Sheet from '$lib/design/components/DescriptionSheet.svelte';
	import { descriptionField, type RoomFormField } from '$lib/design/components/types';
	import type { EditedRoom, RoomEdit } from '$lib/ui/room-edit.svelte';
	import DescriptionField, { type DescriptionSources } from './DescriptionField.svelte';
	import DescriptionText from './DescriptionText.svelte';

	/**
	 * The open room's or thread's description over its pane (the design system's DescriptionSheet), read or edited as
	 * `edit` says (RoomEdit, which the header reads too: its Edit and ×, or the title, Cancel and Save). Read, it is
	 * DescriptionText's; edited, it is the description's own editor (DescriptionField: written as in the composer), filling
	 * the sheet, with the keyboard in it as it opens. Ctrl+Enter (⌘+Enter) saves (`onsave`); a click on the dimmed room
	 * asks to shut it (`onclose`), and Escape to step back (`onescape`); read, Show less at its foot folds it back into its
	 * first lines (`onfold`), where that changes what shows.
	 */
	interface Props extends DescriptionSources {
		room: EditedRoom;
		thread: boolean;
		edit: RoomEdit;
		onopenroom: (roomId: string) => void;
		onsave: () => void;
		onclose: () => void;
		onescape: () => void;
		/** Read, fold it back into its first lines under the header. */
		onfold?: (event: MouseEvent) => void;
		/** Opened by the pointer: no focus ring. */
		pointer?: boolean;
	}
	let { room, thread, edit, people = [], rooms = [], onmention, onopenroom, onsave, onclose, onescape, onfold, pointer }: Props = $props();

	let editing = $derived(Boolean(edit.shown?.editing));
	let saving = $derived(edit.task.busy);
	/** What the editor is drawn with, kept as one object while its parts are the same. */
	let form = $derived<RoomFormField>(descriptionField(thread, { disabled: saving, rows: 8, submit: onsave }));

	// Edited, the keyboard goes to the description as the editor opens, its caret where it was, at the start for a new edit.
	$effect(() => {
		if (!editing) return;
		void tick().then(() => document.querySelector<HTMLElement>('[data-testid="description-sheet"] [data-testid="description-input"]')?.focus());
	});
</script>

<Sheet label={thread ? 'Thread description' : 'Room description'} {editing} {onclose} {onescape} {onfold} {pointer} testid="description-sheet">
	{#if editing}
		<DescriptionField bind:value={() => edit.editing?.text ?? '', (text) => edit.setText(room.id, text)} {form} {people} {rooms} {onmention} />
	{:else}
		<DescriptionText description={room.description ?? ''} {onopenroom} testid="sheet-description" />
	{/if}
</Sheet>
