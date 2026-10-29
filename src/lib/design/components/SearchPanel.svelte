<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Dialog from './Dialog.svelte';
	import type { SearchResult } from './types';

	/**
	 * Searching messages, in a centered Dialog: a field, and the messages that match below it as a listbox, newest
	 * first, each with its room, sender, time and a line of it with the words searched for marked (↑ ↓ move, Enter
	 * opens). What it searches, and how far back, is the caller's: `note` says so.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** What's typed in the field. `bind:query`. */
		query?: string;
		results: SearchResult[];
		/** A search is under way for what's typed: the list says so until it has results. */
		searching?: boolean;
		/** More matched than are listed: a line at the end says to narrow the search. */
		more?: boolean;
		/** Under the field: what is searched, such as "Messages kept on this device for the last 30 days." */
		note?: string;
		/** In the empty field, such as how to narrow a search. */
		placeholder?: string;
		/** Where the caret is in the field: bindable, kept as it moves. */
		caret?: number;
		/**
		 * Suggestions for what's typed at the caret, such as people for `user:`, below the field: while they show,
		 * `onfieldkey` takes the field's keys first, and `suggesting` names their listbox and the option the keyboard is
		 * on, for the field's `aria-controls` and `aria-activedescendant`.
		 */
		suggestions?: Snippet;
		suggesting?: { list: string; option?: string };
		/** A key in the field, before the results take it: true when it was taken. */
		onfieldkey?: (event: KeyboardEvent) => boolean;
		/** The title's "history" is a link, such as to the settings of what this device keeps; the panel closes. */
		onhistory?: () => void;
		/** A result picked, by press or Enter, by its `id`. */
		onpick?: (id: string) => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the listbox of results. */
		listTestid?: string;
	}
	let { open = $bindable(false), query = $bindable(''), caret = $bindable(0), suggestions, suggesting, onfieldkey, results, searching = false, more = false, note, placeholder = 'Words in a message', onhistory, onpick, onclose, class: className, listTestid }: Props = $props();
	const uid = $props.id();
	const listId = `${uid}-results`;
	/** The result the keyboard is on: the first, once there are any. */
	let active = $state(0);
	let input = $state<HTMLInputElement | undefined>();
	let list = $state<HTMLUListElement | undefined>();
	const typed = $derived(query.trim() !== '');

	$effect(() => {
		if (!open) return;
		void tick().then(() => input?.focus());
	});

	// New results put the keyboard back on the first.
	$effect(() => {
		void results;
		active = 0;
	});

	// The result the keyboard is on stays in view.
	$effect(() => {
		if (!list) return;
		list.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
	});

	function pick(id: string): void {
		onpick?.(id);
		open = false;
	}

	/** Puts the caret at `at` in the field, such as after a suggestion is taken. */
	export async function place(at: number): Promise<void> {
		await tick();
		input?.focus();
		input?.setSelectionRange(at, at);
		caret = at;
	}

	function moved(): void {
		caret = input?.selectionStart ?? query.length;
	}

	function keydown(event: KeyboardEvent): void {
		if (onfieldkey?.(event)) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!results.length) return;
			event.preventDefault();
			active = event.key === 'ArrowDown' ? Math.min(active + 1, results.length - 1) : Math.max(active - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (results[active]) pick(results[active].id);
		}
	}
</script>

<Dialog class={['ap-search', className]} bind:open size="md" title="Search local history" backdropCloses {onclose}>
	{#snippet heading()}Search local {#if onhistory}<button type="button" class="ap-link" onclick={() => { open = false; onhistory(); }}>history</button>{:else}history{/if}{/snippet}
	<div class="ap-fieldlabel">
		<label class="ap-sr" for="{uid}-query">Search for</label>
		<div class="ap-search-field">
			<input
				id="{uid}-query" class="ap-field ap-search-input" type="search" bind:this={input} bind:value={query} onkeydown={keydown} oninput={moved} onkeyup={moved} onclick={moved} onselect={moved}
				role="combobox" aria-autocomplete="list" aria-expanded={suggesting !== undefined || results.length > 0} aria-controls={suggesting?.list ?? listId} aria-activedescendant={suggesting ? suggesting.option : results.length ? `${listId}-${active}` : undefined}
				{placeholder} autocomplete="off" spellcheck="false" dir="auto"
			/>
			{#if suggestions}{@render suggestions()}{/if}
		</div>
		{#if note}<p class="ap-form-hint">{note}</p>{/if}
	</div>
	<ul class="ap-search-list" id={listId} role="listbox" aria-label="Messages found" aria-busy={searching} data-testid={listTestid} bind:this={list}>
		{#each results as result, i (result.id)}
			<!-- The field's combobox takes the keys for its options (↑ ↓, Enter), which keep the focus out of the list. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id="{listId}-{i}" role="option" aria-selected={i === active} class={['ap-search-row', i === active && 'ap-search-row-active']}
				onmousedown={(event) => event.preventDefault()} onclick={() => pick(result.id)} onmouseenter={() => (active = i)}
			>
				<span class="ap-search-meta"><bdi class="ap-search-room">{result.room}</bdi><bdi class="ap-search-who">{result.who}</bdi>{#if result.when}<time class="ap-search-when" title={result.exact}>{result.when}</time>{/if}</span>
				<span class="ap-search-text" dir="auto">{#each result.parts as part, p (p)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
			</li>
		{:else}
			<li class="ap-search-empty" role="presentation">{!typed ? 'Type to search.' : searching ? 'Searching…' : `No messages match “${query.trim()}”.`}</li>
		{/each}
		{#if more}<li class="ap-search-empty" role="presentation">Only the newest are listed. Add words to narrow it down.</li>{/if}
	</ul>
</Dialog>
