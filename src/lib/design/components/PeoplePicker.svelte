<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Avatar from './Avatar.svelte';
	import type { PickPerson } from './types';

	/**
	 * Picking people, for a Dialog's form (PrivateRoomForm, AddMembersForm): a field holding them as chips, with the
	 * people who match what's typed below it as a listbox (↑ ↓ move, Enter picks, Backspace in an empty field takes the
	 * last chip back). Enter with no option under the keyboard submits the form around it.
	 */
	interface Props {
		/** The field's label, such as "To". */
		label: string;
		/** Everyone who matches `query`, picked or not: a picked person's row has a check. */
		people: PickPerson[];
		/** The people picked so far, in order: the chips. */
		chosen: PickPerson[];
		/** What's typed in the field. `bind:query`. */
		query?: string;
		placeholder?: string;
		/** The list of people shows; without it, only the field (such as when something else takes the list's place). */
		listed?: boolean;
		/** In the list, with nothing typed and no one to list: "No one to talk to yet". */
		empty?: string;
		/** The field takes no typing, such as while nothing can be picked. */
		disabled?: boolean;
		/** A request is in flight: the field and the chips' × wait. */
		busy?: boolean;
		/** A person picked from the list, by press or Enter: toggle them in or out of the chips. */
		onchoose?: (person: PickPerson) => void;
		/** A chip's × or Backspace: take them out. */
		onremove?: (userId: string) => void;
		/** A `data-testid` for the listbox of people. */
		listTestid?: string;
	}
	let {
		label, people, chosen, query = $bindable(''), placeholder = 'Name or @user_id', listed = true, empty = 'No one to pick yet', disabled = false, busy = false,
		onchoose, onremove, listTestid
	}: Props = $props();
	const uid = $props.id();
	const listId = `${uid}-people`;
	const picked = $derived(new Set(chosen.map((person) => person.user_id)));
	/** The option the keyboard is on; none until an arrow moves to one, or something is typed. */
	let active = $state(-1);
	let input = $state<HTMLInputElement | undefined>();
	let list = $state<HTMLUListElement | undefined>();

	/** Focus its field, such as once its Dialog has opened. */
	export function focus(): void {
		input?.focus();
	}

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
		onchoose?.(person);
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

<div class="ap-fieldlabel">
	<label for="{uid}-to">{label}</label>
	<!-- A press anywhere in the field puts the caret in its input, as a plain field does. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ap-field ap-pick-field" onclick={(event) => { if (event.target === event.currentTarget) input?.focus(); }}>
		{#each chosen as person (person.user_id)}
			<span class="ap-pick-chip">
				<Avatar name={person.name || person.user_id} src={person.src} hue={person.hue} size="sm" />
				<bdi class="ap-pick-chip-name">{person.name || person.user_id}</bdi>
				<button type="button" class="ap-iconbtn ap-iconbtn-round ap-pick-chip-remove" aria-label="Remove {person.name || person.user_id}" disabled={busy} onclick={() => { onremove?.(person.user_id); input?.focus(); }}><X size={12} aria-hidden="true" /></button>
			</span>
		{/each}
		<input
			id="{uid}-to" class="ap-pick-input" bind:this={input} bind:value={query} onkeydown={keydown} disabled={busy || disabled}
			role="combobox" aria-autocomplete="list" aria-expanded={listed} aria-controls={listId} aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
			placeholder={chosen.length ? '' : placeholder} autocomplete="off" spellcheck="false" dir="auto"
		/>
	</div>
</div>
{#if listed}
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
				{#if chosenHere}<Check class="ap-pick-check" size={16} aria-hidden="true" />{:else if person.tag}<span class="ap-pick-tag">{person.tag}</span>{/if}
			</li>
		{:else}
			<li class="ap-pick-empty" role="presentation">{query ? `No one matches “${query}”` : empty}</li>
		{/each}
	</ul>
{/if}
