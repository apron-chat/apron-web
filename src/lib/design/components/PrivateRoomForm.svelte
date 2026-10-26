<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import Callout from './Callout.svelte';
	import Dialog from './Dialog.svelte';
	import Faces from './Faces.svelte';
	import type { PickPerson, PickRoom } from './types';

	/**
	 * Starting a private room (§4.2.4) with the people you pick, in a centered Dialog: a field holding them as chips,
	 * with the people who match what's typed below it as a listbox (↑ ↓ move, Enter picks, Backspace in an empty field
	 * takes the last chip back), a Name once two or more are picked, and how many private rooms you're in of the most
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
	const listId = `${uid}-people`;
	const saving = $derived(status === 'saving');
	const atLimit = $derived(full !== undefined);
	const picked = $derived(new Set(chosen.map((person) => person.user_id)));
	const action = $derived(saving ? 'Starting…' : chosen.length === 1 ? `Message ${chosen[0].name || chosen[0].user_id}` : 'Start conversation');
	/** The option the keyboard is on; none until an arrow moves to one, or something is typed. */
	let active = $state(-1);
	let input = $state<HTMLInputElement | undefined>();
	let list = $state<HTMLUListElement | undefined>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => input?.focus());
	});

	// Something typed puts the keyboard on the first match; an emptied field (a pick empties it) on none, so Enter submits.
	$effect(() => {
		active = query ? 0 : -1;
	});

	// Fewer matches than before: the keyboard stays on one that's there.
	$effect(() => {
		if (active >= people.length) active = people.length - 1;
	});

	// The option the keyboard is on stays in view.
	$effect(() => {
		if (active < 0 || !list) return;
		list.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
	});

	function choose(person: PickPerson): void {
		if (person.existing && chosen.length === 0 && onopen) onopen(person.user_id);
		else onpick?.(person.user_id);
		query = '';
		input?.focus();
	}



	function keydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!people.length) return;
			event.preventDefault();
			active = event.key === 'ArrowDown' ? Math.min(active + 1, people.length - 1) : Math.max(active - 1, 0);
		} else if (event.key === 'Enter' && active >= 0 && people[active]) {
			// Enter picks the option the keyboard is on; with none, it submits.
			event.preventDefault();
			choose(people[active]);
		} else if (event.key === 'Backspace' && !query && chosen.length && !event.repeat) {
			event.preventDefault();
			onremove?.(chosen[chosen.length - 1].user_id);
		}
	}
</script>

<!-- Escape, the close button and Cancel do nothing while it starts. -->
<Dialog class={['ap-pick', className]} bind:open size="md" title="New private conversation" subtitle="A private room that only the people you pick can see." locked={saving} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled && !atLimit && chosen.length) onsubmit?.(); }}>
	<div class="ap-fieldlabel">
		<label for="{uid}-to">To</label>
		<!-- A press anywhere in the field puts the caret in its input, as a plain field does. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="ap-field ap-pick-field" onclick={(event) => { if (event.target === event.currentTarget) input?.focus(); }}>
			{#each chosen as person (person.user_id)}
				<span class="ap-pick-chip">
					<Avatar name={person.name || person.user_id} src={person.src} hue={person.hue} size="sm" />
					<bdi class="ap-pick-chip-name">{person.name || person.user_id}</bdi>
					<button type="button" class="ap-pick-chip-remove" aria-label="Remove {person.name || person.user_id}" disabled={saving} onclick={() => { onremove?.(person.user_id); input?.focus(); }}><X size={12} aria-hidden="true" /></button>
				</span>
			{/each}
			<input
				id="{uid}-to" class="ap-pick-input" bind:this={input} bind:value={query} onkeydown={keydown} disabled={saving || atLimit}
				role="combobox" aria-autocomplete="list" aria-expanded={!atLimit} aria-controls={listId} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
				placeholder={chosen.length ? '' : 'Name or @user_id'} autocomplete="off" spellcheck="false" dir="auto"
			/>
		</div>
	</div>
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
	{:else}
		<ul class="ap-pick-list" id={listId} role="listbox" aria-label="People" aria-multiselectable="true" data-testid={listTestid} bind:this={list}>
			{#each people as person, i (person.user_id)}
				{@const chosenHere = picked.has(person.user_id)}
				<!-- The field's combobox takes the keys for its options (↑ ↓, Enter), which keep the focus out of the list. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{listId}-{i}" role="option" aria-selected={chosenHere} class={['ap-pick-row', i === active && 'ap-pick-row-active', chosenHere && 'ap-pick-row-on']}
					onmousedown={(event) => event.preventDefault()} onclick={() => choose(person)} onmouseenter={() => (active = i)}
				>
					<Avatar name={person.name || person.user_id} src={person.src} hue={person.hue} size="md" status={person.status} statusLabel={person.statusLabel} />
					<span class="ap-pick-who"><bdi class="ap-pick-who-name">{person.name || person.user_id}</bdi><small>{person.detail ?? `@${person.user_id}`}</small></span>
					{#if chosenHere}<Check class="ap-pick-check" size={16} aria-hidden="true" />{:else if person.existing && chosen.length === 0}<span class="ap-pick-tag">Already talking · Open</span>{/if}
				</li>
			{:else}
				<li class="ap-pick-empty" role="presentation">{query ? `No one matches “${query}”` : 'No one to talk to yet'}</li>
			{/each}
		</ul>
		{#if chosen.length >= 2}
			<label class="ap-fieldlabel" for="{uid}-name"><span class="ap-fieldlabel-row"><span>Name</span><span class="ap-fieldlabel-hint">Optional</span></span>
				<input id="{uid}-name" class="ap-field" aria-label="Name" bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto" placeholder="Named for its people without one" />
			</label>
		{/if}
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
