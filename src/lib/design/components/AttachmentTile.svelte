<script lang="ts">
	import * as icons from './Icons.svelte';
	import type { MediaSrc } from './types';
	/*
	 * One file on a draft, or in a message being edited (§4.8.4): an image as a thumbnail, audio with a player
	 * to listen back, a link or any other file as a card. Its name is a button that renames it in place; the
	 * (x) on its corner takes it off.
	 */
	import { tick } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { composing } from './compose';
	import AudioPlayer from './AudioPlayer.svelte';

	interface Props {
		name: string;
		/** Under the name: the size it goes out at, "Preparing…", or what it is. */
		detail?: string;
		kind?: 'image' | 'audio' | 'file' | 'link';
		/** Previews an image or audio clip (an object URL, or a file the server hosts). */
		src?: MediaSrc;
		/**
		 * Rename in place: a click on the name opens it for typing, all of it selected. Enter or clicking away
		 * keeps the new name, Escape keeps the old one; an empty name changes nothing.
		 */
		onrename?: (name: string) => void;
		/** The (x): take it off. */
		onremove?: () => void;
		/** The (x)'s label, `Remove {name}` by default. */
		removeLabel?: string;
		/** `data-testid` on the name and detail. */
		labelTestid?: string;
		/** Classes for the tile, added to its own. */
		class?: ClassValue;
	}
	let { name, detail, kind = 'file', src, onrename, onremove, removeLabel, labelTestid, class: className }: Props = $props();

	/** Long names lose their middle, not their end: the last characters, such as the extension, stay in view. */
	const TAIL = 8;
	let split = $derived(name.length > TAIL + 4 ? [name.slice(0, -TAIL), name.slice(-TAIL)] : undefined);

	let renaming = $state(false);
	let draft = $state('');
	let input = $state<HTMLInputElement | undefined>();
	let renameButton = $state<HTMLButtonElement | undefined>();

	async function rename(): Promise<void> {
		draft = name;
		renaming = true;
		await tick();
		input?.focus();
		input?.select();
	}

	async function finish(keep: boolean, refocus: boolean): Promise<void> {
		if (!renaming) return;
		renaming = false;
		const next = draft.trim();
		if (keep && next && next !== name) onrename?.(next);
		if (!refocus) return;
		await tick();
		renameButton?.focus();
	}

	/* The keys stop here: Enter must not send or save the message around it, nor Escape cancel it. */
	function keydown(event: KeyboardEvent): void {
		if (composing(event)) return;
		if (event.key === 'Enter' || event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			void finish(event.key === 'Enter', true);
		}
	}
</script>

{#snippet shown(nameClass: string)}
	{#if split}
		<span class={[nameClass, 'ap-attachment-split']}><span class="ap-attachment-stem">{split[0]}</span><span class="ap-attachment-tail">{split[1]}</span></span>
	{:else}
		<span class={nameClass}>{name}</span>
	{/if}
{/snippet}

{#snippet label(nameClass: string, detailClass: string)}
	{#if renaming}
		<input class="ap-attachment-input" bind:this={input} bind:value={draft} aria-label="File name" spellcheck="false" onkeydown={keydown} onblur={() => finish(true, false)} />
	{:else if onrename}
		<button class="ap-attachment-rename" type="button" bind:this={renameButton} aria-label={`Rename ${name}`} title="Rename" data-testid={labelTestid} onclick={rename}>
			{@render shown(nameClass)}
			<span class={['ap-attachment-meta', detailClass]}>
				{#if detail}<span class="ap-attachment-detail">{detail}</span>{/if}
				<span class="ap-attachment-renamehint" aria-hidden="true">
					{@render icons.pencil()}<span class="ap-attachment-renametext">Rename</span>
				</span>
			</span>
		</button>
	{:else}
		<span class="ap-attachment-text" data-testid={labelTestid}>
			{@render shown(nameClass)}
			{#if detail}<span class={detailClass}>{detail}</span>{/if}
		</span>
	{/if}
{/snippet}

<div class={['ap-attachment', renaming && 'ap-attachment-renaming', className]}>
	{#if kind === 'image'}
		<figure class="ap-embed ap-attachment-thumb" title={renaming ? undefined : detail ? `${name} · ${detail}` : name}>
			<img {src} alt={name} />
			<figcaption class="ap-attachment-label">{@render label('ap-attachment-name', 'ap-attachment-size')}</figcaption>
		</figure>
	{:else if kind === 'audio'}
		<div class="ap-embed ap-embed-card ap-embed-audiocard">
			<span class="ap-embed-cardtext">{@render label('ap-embed-title', 'ap-embed-detail')}</span>
			<AudioPlayer {src} preload="metadata" label={name} />
		</div>
	{:else}
		<div class="ap-embed ap-embed-card ap-embed-file">
			<span class="ap-embed-fileglyph">
				{#if kind === 'link'}
					{@render icons.link()}
				{:else}
					{@render icons.file()}
				{/if}
			</span>
			<span class="ap-embed-cardtext">{@render label('ap-embed-title', 'ap-embed-detail')}</span>
		</div>
	{/if}
	{#if onremove && !renaming}
		{@const removeText = removeLabel ?? `Remove ${name}`}
		<button type="button" class="ap-embed-remove" aria-label={removeText} title={removeText} onclick={onremove}>
			{@render icons.x()}
		</button>
	{/if}
</div>
