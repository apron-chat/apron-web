<script lang="ts">
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Search from '@lucide/svelte/icons/search';
	import { composing } from './compose';
	import Dialog from './Dialog.svelte';
	import type { PaletteRow, PaletteSection } from './types';

	/**
	 * Every command the user can use, in a centered Dialog, as the keyboard shortcuts are: a field that narrows them,
	 * and below it titled sections of them as a listbox (↑ ↓ move, Enter or a press picks). Each row is a command's
	 * `/name`, its hint and its description, as written; a command's forms are set in under its first word. One that
	 * won't work right now is greyed, with why, and can still be picked.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** What's typed in the field, which the caller narrows `sections` by. `bind:query`. */
		query?: string;
		sections: PaletteSection[];
		/** The commands are on their way: the list says so. */
		loading?: boolean;
		/** A row picked, by press or Enter, by its name; it closes. */
		onpick?: (name: string) => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
	}
	let { open = $bindable(false), query = $bindable(''), sections, loading = false, onpick, onclose, class: className }: Props = $props();
	const uid = $props.id();
	const listId = `${uid}-commands`;
	let input = $state<HTMLInputElement | undefined>();
	let list = $state<HTMLUListElement | undefined>();
	/** Every row, in the order shown, with the index of each section's first. */
	const rows = $derived(sections.flatMap((section) => section.rows));
	const starts = $derived(sections.reduce<number[]>((at, section, index) => [...at, index ? at[index - 1] + sections[index - 1].rows.length : 0], []));
	/** The row the keyboard is on: the first, as what's typed changes. */
	let active = $state(0);
	const status = $derived(loading && !rows.length ? 'Loading commands…' : rows.length ? `${rows.length === 1 ? '1 command' : `${rows.length} commands`}.` : `No command matches “${query.trim()}”.`);

	$effect(() => {
		if (!open) return;
		void tick().then(() => input?.focus());
	});
	$effect(() => {
		void query;
		active = 0;
	});
	// The row the keyboard is on stays in view.
	$effect(() => {
		list?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
	});

	function pick(name: string): void {
		onpick?.(name);
		open = false;
	}

	function keydown(event: KeyboardEvent): void {
		if (composing(event)) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!rows.length) return;
			event.preventDefault();
			active = event.key === 'ArrowDown' ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (rows[active]) pick(rows[active].name);
		}
	}
</script>

{#snippet row(command: PaletteRow, i: number)}
	<!-- The field's combobox takes the keys for its options (↑ ↓, Enter), which keep the focus out of the list. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<li
		id="{listId}-{i}" role="option" aria-selected={i === active} class={['ap-palette-row', command.form && 'ap-palette-form', command.unfit && 'ap-palette-unfit', i === active && 'ap-palette-row-active']}
		onmousedown={(event) => event.preventDefault()} onclick={() => pick(command.name)} onmouseenter={() => (active = i)}
	>
		<span class="ap-palette-line">
			<bdi class="ap-palette-name">/{command.name}</bdi>
			{#if command.hint}<span class="ap-palette-args" dir="auto">{command.hint}</span>{/if}
			{#if command.unfit}<span class="ap-palette-tag">{command.unfit}</span>{/if}
		</span>
		{#if command.description}<span class="ap-palette-desc" dir="auto">{command.description}</span>{/if}
	</li>
{/snippet}

<Dialog class={['ap-palette', className]} bind:open size="md" title="Commands" subtitle="Type / in the composer to complete one as you type." backdropCloses {onclose}>
	<div class="ap-fieldlabel">
		<label class="ap-sr" for="{uid}-query">Find a command</label>
		<div class="ap-search-field">
			<Search class="ap-search-glass" size={16} aria-hidden="true" />
			<input
				id="{uid}-query" class="ap-field ap-search-input" type="search" bind:this={input} bind:value={query} onkeydown={keydown}
				role="combobox" aria-autocomplete="list" aria-expanded={rows.length > 0} aria-controls={listId} aria-activedescendant={rows.length ? `${listId}-${active}` : undefined}
				placeholder="Find a command" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" dir="auto"
			/>
		</div>
		<p class="ap-sr" role="status" aria-live="polite" aria-atomic="true">{status}</p>
	</div>
	<ul class="ap-palette-list" id={listId} role="listbox" aria-label="Commands" aria-busy={loading} bind:this={list}>
		{#each sections as section, s (section.title)}
			<li class="ap-palette-section" role="presentation">{section.title}</li>
			{#each section.rows as command, r (command.name)}
				{@render row(command, starts[s] + r)}
			{/each}
		{:else}
			<li class="ap-search-empty" role="presentation">{loading ? 'Loading commands…' : `No command matches “${query.trim()}”.`}</li>
		{/each}
	</ul>
</Dialog>
