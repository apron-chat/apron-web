<script lang="ts">
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import PeoplePicker from './PeoplePicker.svelte';
	import type { PickPerson } from './types';

	/**
	 * Adding people to a room or thread (`room_join` with each `user_id`, §4.2.2), in a centered Dialog: a PeoplePicker
	 * of the people you could add, as New private conversation picks them, and Add.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** The room's or thread's title, which the title names: "Add people to design". */
		room?: string;
		/** Everyone who matches `query`, picked or not: a picked person's row has a check. */
		people: PickPerson[];
		/** The people picked so far, in order: the chips. */
		chosen: PickPerson[];
		/** What's typed in the field. `bind:query`. */
		query?: string;
		status?: 'idle' | 'saving';
		/** What went wrong, such as who the server wouldn't add. */
		error?: string;
		/** The session can't take requests: the form stays open but won't submit. */
		disabled?: boolean;
		/** Toggles a person in or out of the chips. */
		onpick?: (userId: string) => void;
		onremove?: (userId: string) => void;
		onsubmit?: () => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the listbox of people. */
		listTestid?: string;
	}
	let {
		open = $bindable(false), room, people, chosen, query = $bindable(''), status = 'idle', error, disabled = false, onpick, onremove, onsubmit, onclose, class: className, listTestid
	}: Props = $props();
	const saving = $derived(status === 'saving');
	const action = $derived(saving ? 'Adding…' : chosen.length === 1 ? `Add ${chosen[0].name || chosen[0].user_id}` : chosen.length ? `Add ${chosen.length} people` : 'Add');
	let picker = $state<PeoplePicker | undefined>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => picker?.focus());
	});
</script>

<!-- Escape, the close button and Cancel do nothing while it adds. -->
<Dialog class={['ap-pick', className]} bind:open size="md" title={room ? `Add people to ${room}` : 'Add people'} subtitle="Pick people by name, or type their @user_id." locked={saving} {error} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled && chosen.length) onsubmit?.(); }}>
	<PeoplePicker bind:this={picker} label="Add" {people} {chosen} bind:query empty="No one else to add yet" busy={saving} onchoose={(person) => onpick?.(person.user_id)} {onremove} {listTestid} />
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled || !chosen.length} label={action} />
	{/snippet}
</Dialog>
