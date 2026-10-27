<script lang="ts">
	/* Above the Composer while you type `@name` (people), `#room` (rooms and threads) or `:shortcode` (emoji); ↑ ↓ move, Tab or Enter takes one. */
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import type { PickerEmoji, PickerRoom, Sender } from './types';
	import { uid } from './util';

	/** The list is a listbox, as its options need. */
	interface Props {
		/** What has been typed after the `@`, `#` or `:`; in a person's name and ID it reads in accent. */
		query?: string;
		/** `@`: who can be named. The list shows `rooms` instead when given, else `emoji`. */
		people?: Sender[];
		/** `#`: rooms and threads, each its title and `#room_id`. */
		rooms?: PickerRoom[];
		/** `:`: emoji, each its glyph, `:shortcode:` and name. */
		emoji?: PickerEmoji[];
		/** The highlighted option, which Tab (and Enter) takes. */
		active?: number;
		/** A pick (a click keeps the focus in the field): the item and its index in the list shown. */
		onpick?: (item: Sender | PickerRoom | PickerEmoji, index: number) => void;
		onhover?: (index: number) => void;
		/** The list's ID, which the field names in `aria-controls`; option `i` is `${id}-${i}`, its `aria-activedescendant`. */
		id?: string;
		/** Replaces a person's avatar, such as with one tinted by their ID. */
		avatar?: Snippet<[Sender]>;
		/** Classes for the list, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the list. */
		testid?: string;
	}
	let { query = '', people = [], rooms, emoji, active = 0, onpick, onhover, id, avatar, class: className, testid }: Props = $props();

	const kind = $derived(rooms ? 'rooms' : emoji ? 'emoji' : 'people');
	const items: (Sender | PickerRoom | PickerEmoji)[] = $derived(rooms ?? emoji ?? people);
	const listLabel = $derived(kind === 'rooms' ? 'Room suggestions' : kind === 'emoji' ? 'Emoji suggestions' : 'Mention someone');
	const emptyText = $derived(kind === 'rooms' ? `No room matches “${query}”` : kind === 'emoji' ? `No emoji match “${query}”` : query ? `No one here matches “${query}”` : 'People in this room');
	const q = $derived(query.toLowerCase());
	const key = (item: Sender | PickerRoom | PickerEmoji, index: number): string => ('user_id' in item ? uid(item) : item.id) ?? String(index);
	let list = $state<HTMLUListElement>();

	function split(text: string): [string, string, string] | null {
		const i = q ? text.toLowerCase().indexOf(q) : -1;
		return i < 0 ? null : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
	}

	// The highlighted option stays in view as the keys move it through a list that scrolls.
	$effect(() => {
		if (!items[active] || !list) return;
		list.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
	});
</script>

<!-- `prefix` shares the text's first node, so the line shapes as one run. -->
{#snippet mark(text: string, prefix = '')}{@const m = split(text)}{#if m}{prefix}{m[0]}<mark class="ap-mpick-hit">{m[1]}</mark>{m[2]}{:else}{prefix}{text}{/if}{/snippet}

{#if !items.length}
	<!-- A listbox even with no options, as the field's `aria-controls` names it. -->
	<div {id} aria-label={listLabel} data-testid={testid} class={['ap-mpick', className]} role="listbox"><div class="ap-mpick-empty">{emptyText}</div></div>
{:else}
	<ul {id} aria-label={listLabel} data-testid={testid} class={['ap-mpick', className]} role="listbox" bind:this={list}>
		{#each items as item, i (key(item, i))}
			<li id={id && `${id}-${i}`} role="option" aria-selected={i === active} class={['ap-mpick-item', i === active && 'ap-mpick-active']} onmousedown={(e) => { e.preventDefault(); onpick?.(item, i); }} onmouseenter={() => onhover?.(i)}>
				{#if 'user_id' in item}
					{@const pid = uid(item) || ''}
					{@const name = item.name?.trim() || pid}
					{#if avatar}{@render avatar(item)}{:else}<Avatar {name} src={item.avatar} size="sm" />{/if}
					<span class="ap-mpick-name">{@render mark(name)}</span>
					{#if pid !== name}<span class="ap-mpick-id">{@render mark(pid, '@')}</span>{/if}
				{:else if 'native' in item}
					<span class="ap-mpick-emoji-glyph" aria-hidden="true">{#if item.image}<img class="ap-cemoji" src={item.image} alt="" />{:else}{item.native}{/if}</span>
					<span class="ap-mpick-name">:{item.id}:</span>
					<span class="ap-mpick-id">{item.name}</span>
				{:else}
					<span class="ap-mpick-name">{item.title}</span>
					<span class="ap-mpick-id">#{item.id}</span>
				{/if}
				{#if i === active}<kbd class="ap-mpick-kbd">Tab</kbd>{/if}
			</li>
		{/each}
	</ul>
{/if}
