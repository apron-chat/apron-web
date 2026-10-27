<script lang="ts">
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Callout from './Callout.svelte';
	import Dialog from './Dialog.svelte';
	import Faces from './Faces.svelte';
	import PeoplePicker from './PeoplePicker.svelte';
	import type { PickPerson, PickRoom } from './types';

	/**
	 * Starting a private room (§4.2.4) with the people you pick, in a centered Dialog: a PeoplePicker, a Name once two
	 * or more are picked, and how many private rooms you're in of the most
	 * the server allows. At that limit it offers your private rooms to leave instead.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** Everyone who matches `query`, picked or not: a picked person's row has a check. */
		people: PickPerson[];
		/** The people picked so far, in order: the chips. */
		chosen: PickPerson[];
		/** What's typed in the field. `bind:query`. */
		query?: string;
		/** The room's title, offered once two or more are picked. `bind:name`. */
		name?: string;
		/** Private rooms you're in, of the most the server allows (`ext.settings.private_rooms`): "2 of 5". */
		quota?: { used: number; max: number };
		/** At the limit: your private rooms to leave, the quietest first, in place of the people; nothing can start. */
		full?: PickRoom[];
		/** More private rooms at the limit than `full` lists. */
		fullMore?: number;
		status?: 'idle' | 'saving';
		/** What went wrong, such as the server refusing. */
		error?: string;
		/** The session can't take requests: the form stays open but won't submit. */
		disabled?: boolean;
		/** Toggles a person in or out of the chips. */
		onpick?: (userId: string) => void;
		onremove?: (userId: string) => void;
		/** Picked alone, a person you already talk to (`existing`) opens that conversation instead. */
		onopen?: (userId: string) => void;
		/** Leave one of `full`. */
		onleaveroom?: (roomId: string) => void;
		onsubmit?: () => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the listbox of people. */
		listTestid?: string;
	}
	let {
		open = $bindable(false), people, chosen, query = $bindable(''), name = $bindable(''), quota, full, fullMore = 0, status = 'idle', error, disabled = false,
		onpick, onremove, onopen, onleaveroom, onsubmit, onclose, class: className, listTestid
	}: Props = $props();
	const uid = $props.id();
	const saving = $derived(status === 'saving');
	const atLimit = $derived(full !== undefined);
	const action = $derived(saving ? 'Starting…' : chosen.length === 1 ? `Message ${chosen[0].name || chosen[0].user_id}` : 'Start conversation');
	/** Someone you already talk to, while no one is picked, is offered to open. */
	const listed = $derived(chosen.length ? people : people.map((person) => (person.existing ? { ...person, tag: 'Already talking · Open' } : person)));
	let picker = $state<PeoplePicker | undefined>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => picker?.focus());
	});

	function choose(person: PickPerson): void {
		if (person.existing && chosen.length === 0 && onopen) onopen(person.user_id);
		else onpick?.(person.user_id);
	}
</script>

<!-- Escape, the close button and Cancel do nothing while it starts. -->
<Dialog class={['ap-pick', className]} bind:open size="md" title="New private conversation" subtitle="A private room that only the people you pick can see." locked={saving} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled && !atLimit && chosen.length) onsubmit?.(); }}>
	<PeoplePicker bind:this={picker} label="To" people={listed} {chosen} bind:query listed={!atLimit} empty="No one to talk to yet" disabled={atLimit} busy={saving} onchoose={choose} {onremove} {listTestid} />
	{#if full}
		<Callout tone="warn" title={quota ? `You’re in ${quota.used} private ${quota.used === 1 ? 'room' : 'rooms'}, the most this server allows at once.` : 'You’re in as many private rooms as this server allows at once.'}>
			<p>Leave one to start another.</p>
		</Callout>
		<div class="ap-pick-rooms">
			<p class="ap-pick-group">Your private rooms, quietest first</p>
			{#each full as room (room.id)}
				<div class="ap-pick-row">
					<Faces people={room.faces} size="md" />
					<span class="ap-pick-who"><bdi class="ap-pick-who-name">{room.name}</bdi>{#if room.detail}<small>{room.detail}</small>{/if}</span>
					<Button size="sm" aria-label="Leave {room.name}" disabled={room.leaving} onclick={() => onleaveroom?.(room.id)}>{room.leaving ? 'Leaving…' : 'Leave'}</Button>
				</div>
			{/each}
			{#if fullMore > 0}<p class="ap-pick-group ap-pick-more">and {fullMore} more</p>{/if}
		</div>
	{:else if chosen.length >= 2}
		<label class="ap-fieldlabel" for="{uid}-name"><span class="ap-fieldlabel-row"><span>Name</span><span class="ap-fieldlabel-hint">Optional</span></span>
			<input id="{uid}-name" class="ap-field" aria-label="Name" bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto" placeholder="Named for its people without one" />
		</label>
	{/if}
	{#if error}<p class="ap-profedit-note ap-tone-danger" role="alert">{error}</p>{/if}
	{#snippet footer()}
		{#if quota}
			<span class={['ap-quota', atLimit && 'ap-quota-full']} title="Private rooms you’re in, of the most this server allows at once">
				{#if quota.max <= 10}<span class="ap-quota-bar" aria-hidden="true">{#each { length: quota.max }, i}<i class={[i < quota.used && 'ap-quota-on']}></i>{/each}</span>{/if}
				{quota.used} of {quota.max}
			</span>
		{/if}
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled || atLimit || !chosen.length} label={action} />
	{/snippet}
</Dialog>
