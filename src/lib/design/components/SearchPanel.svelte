<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Hash from '@lucide/svelte/icons/hash';
	import Lock from '@lucide/svelte/icons/lock';
	import Dialog from './Dialog.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import type { RoomResult, SearchAction, SearchMode, SearchResult } from './types';

	/**
	 * Searching, in a centered Dialog: a field, and what matches below it as a listbox (↑ ↓ move, Enter opens). It
	 * finds messages, newest first, each with its room, sender, time and a line of it with the words searched for
	 * marked; or (`kind: 'rooms'`) rooms and threads, each with its title marked, where it is, and what's new in it or
	 * that you haven't joined it. `modes` switches between such searches above the field. What it searches, and how
	 * far back, is the caller's: `note` says so, and `action`, after the results, can look further.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** Its title, which names the dialog. */
		title?: string;
		/** What it finds: `messages` (the default) or `rooms`, for what its list and status call them. */
		kind?: 'messages' | 'rooms';
		/** What it can be switched between, above the field, the one shown `mode`: none, no switch. */
		modes?: SearchMode[];
		/** The `modes` id shown. `bind:mode`. */
		mode?: string;
		/** What's typed in the field. `bind:query`. */
		query?: string;
		results: Array<SearchResult | RoomResult>;
		/** A search is under way for what's typed: the list says so until it has results. */
		searching?: boolean;
		/** More matched than are listed: a line at the end says to narrow the search. */
		more?: boolean;
		/** Under the field: what is searched, such as "Messages kept on this device for the last 30 days." */
		note?: string;
		/** In the empty field, such as how to narrow a search. */
		placeholder?: string;
		/** After the results: a button to look further, such as on the server, and what it does. */
		action?: SearchAction;
		/** Where the caret is in the field: bindable, kept as it moves. */
		caret?: number;
		/**
		 * Suggestions for what's typed at the caret, such as people for `user:`, below the field: while they show,
		 * `onfieldkey` takes the field's keys first, and `suggesting` names their listbox and the option the keyboard is
		 * on, for the field's `aria-controls` and `aria-activedescendant`.
		 */
		suggestions?: Snippet;
		suggesting?: { list: string; option?: string };
		/** A key in the field, before the results take it, with the id of the result the keyboard is on: true when it was taken. */
		onfieldkey?: (event: KeyboardEvent, active: string | undefined) => boolean;
		/** How far back history is kept, such as "30 Days": a button beside the title, which `onhistory` takes. */
		kept?: string;
		/** The `kept` button pressed, such as to open the settings of what this device keeps; the panel closes. */
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
	let {
		open = $bindable(false), title = 'Search Local History', kind = 'messages', modes, mode = $bindable(), query = $bindable(''), caret = $bindable(0),
		suggestions, suggesting, onfieldkey, results, searching = false, more = false, note, placeholder = 'Words in a message', action, kept, onhistory, onpick, onclose, class: className, listTestid
	}: Props = $props();
	const uid = $props.id();
	const listId = `${uid}-results`;
	/** The result the keyboard is on: the first, once there are any. */
	let active = $state(0);
	let input = $state<HTMLInputElement | undefined>();
	let list = $state<HTMLUListElement | undefined>();
	const typed = $derived(query.trim() !== '');
	const words = $derived(kind === 'rooms' ? { one: 'room', many: 'rooms', found: 'Rooms and threads found', none: 'No rooms or threads match', more: 'Only the best matches are listed. Add words to narrow it down.' } : { one: 'message', many: 'messages', found: 'Messages found', none: 'No messages match', more: 'Only the newest are listed. Add words to narrow it down.' });
	/** What a screen reader hears as results change: the list itself isn't read as it fills. */
	const status = $derived(!typed ? '' : searching ? 'Searching…' : results.length ? `${results.length === 1 ? `1 ${words.one}` : `${results.length} ${words.many}`} found${more ? kind === 'rooms' ? ', the best' : ', the newest' : ''}.` : `${words.none} “${query.trim()}”.`);

	$effect(() => {
		if (!open) return;
		void tick().then(() => input?.focus());
	});

	/** The result the keyboard is on, by id, and the query the results last shown were for. */
	let activeId: string | undefined;
	let shownFor: string | undefined;

	// Results for a new query put the keyboard back on the first; the same query's, redrawn (what's new in a room
	// changed, a listing came in), keep it on the result it was on, as long as that is still there.
	$effect(() => {
		const list = results;
		const asked = untrack(() => query);
		const kept = asked === shownFor && activeId !== undefined ? list.findIndex((result) => result.id === activeId) : -1;
		shownFor = asked;
		active = kept >= 0 ? kept : 0;
	});
	$effect(() => {
		activeId = results[active]?.id;
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
		if (onfieldkey?.(event, results[active]?.id)) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!results.length) return;
			event.preventDefault();
			active = event.key === 'ArrowDown' ? Math.min(active + 1, results.length - 1) : Math.max(active - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (results[active]) pick(results[active].id);
		}
	}

	const isRoom = (result: SearchResult | RoomResult): result is RoomResult => result.kind === 'room';
</script>

<!-- How far back history is kept, beside the title: it goes to where that's set. -->
{#snippet keptButton()}<button type="button" class="ap-dialog-titlebtn" aria-label="{kept} of history kept, in Preferences" title="How long history is kept on this device" onclick={() => { open = false; onhistory?.(); }}>{kept}</button>{/snippet}
<Dialog class={['ap-search', className]} bind:open size="md" {title} titleEnd={kept && onhistory ? keptButton : undefined} backdropCloses {onclose}>
	{#if modes?.length}
		<div class="ap-seg ap-search-modes" role="group" aria-label="Search for">
			{#each modes as candidate (candidate.id)}
				<button class="ap-seg-item" class:ap-seg-on={mode === candidate.id} type="button" aria-pressed={mode === candidate.id} aria-keyshortcuts={candidate.shortcut} onclick={() => { mode = candidate.id; input?.focus(); }}>
					{candidate.label}{#if candidate.keys}<kbd class="ap-keys-key ap-search-modekeys" aria-hidden="true">{candidate.keys}</kbd>{/if}
				</button>
			{/each}
		</div>
	{/if}
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
		<p class="ap-sr" role="status" aria-live="polite" aria-atomic="true">{status}</p>
	</div>
	<ul class="ap-search-list" id={listId} role="listbox" aria-label={words.found} aria-busy={searching} data-testid={listTestid} bind:this={list}>
		{#each results as result, i (result.id)}
			{#if result.group && result.group !== results[i - 1]?.group}<li class="ap-search-group" role="presentation">{result.group}</li>{/if}
			<!-- The field's combobox takes the keys for its options (↑ ↓, Enter), which keep the focus out of the list. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id="{listId}-{i}" role="option" aria-selected={i === active} class={['ap-search-row', isRoom(result) && 'ap-search-roomrow', isRoom(result) && !result.joined && 'ap-search-unjoined', i === active && 'ap-search-row-active']}
				onmousedown={(event) => event.preventDefault()} onclick={() => pick(result.id)} onmouseenter={() => (active = i)}
			>
				{#if isRoom(result)}
					{#if result.thread}<CornerDownRight class="ap-search-icon" aria-label="Thread" />{:else}<Hash class="ap-search-icon" aria-label="Room" />{/if}
					<span class="ap-search-main">
						<bdi class="ap-search-title">{#each result.parts as part, p (p)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</bdi>{#if result.private}<Lock class="ap-lock" aria-label="Private" />{/if}
						{#if result.detail}<span class="ap-search-detail" dir="auto">{result.detail}</span>{/if}
					</span>
					{#if !result.joined}<span class="ap-search-tag">Not joined</span>
					{:else if result.unread || result.mentions}<UnreadCount unread={result.unread ?? 0} mentions={result.mentions ?? 0} quiet={result.muted} noun={result.thread ? 'reply' : 'message'} />{/if}
				{:else}
					<span class="ap-search-meta"><bdi class="ap-search-room">{result.room}</bdi><bdi class="ap-search-who">{result.who}</bdi>{#if result.when}<time class="ap-search-when" title={result.exact}>{result.when}</time>{/if}</span>
					<span class="ap-search-text" dir="auto">{#each result.parts as part, p (p)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
				{/if}
			</li>
		{:else}
			<li class="ap-search-empty" role="presentation">{!typed ? (kind === 'rooms' ? 'No rooms or threads yet.' : 'Type to search.') : searching ? 'Searching…' : `${words.none} “${query.trim()}”.`}</li>
		{/each}
		{#if more}<li class="ap-search-empty" role="presentation">{words.more}</li>{/if}
	</ul>
	{#if action}
		<div class="ap-search-action">
			{#if action.note}<p class="ap-search-actionnote">{action.note}</p>{/if}
			{#if !action.done}<button type="button" class="ap-btn ap-btn-sm" disabled={action.busy} aria-busy={action.busy} onclick={() => { action.onclick(); input?.focus(); }}>{action.busy ? 'Loading…' : action.label}</button>{/if}
		</div>
	{/if}
</Dialog>
