<script lang="ts">
	/*
	 * One file on a draft, or in a message being edited (§4.8.4): an image as a thumbnail, audio with a player
	 * to listen back, a link or any other file as a card. Its name is a button that renames it in place; the
	 * (x) on its corner takes it off.
	 */
	import { tick } from 'svelte';
	import FileGlyph from './FileGlyph.svelte';

	interface Props {
		name: string;
		/** Under the name: the size it goes out at, "Preparing…", or what it is. */
		detail?: string;
		kind?: 'image' | 'audio' | 'file' | 'link';
		/** Previews an image or audio clip (an object URL, or a file the server hosts). */
		src?: string;
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
	}
	let { name, detail, kind = 'file', src, onrename, onremove, removeLabel, labelTestid }: Props = $props();

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
		if (event.isComposing) return;
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
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" /><path d="m15 5 4 4" /></svg><span class="ap-attachment-renametext">Rename</span>
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

<div class={['ap-attachment', renaming && 'ap-attachment-renaming']}>
	{#if kind === 'image'}
		<figure class="ap-embed ap-attachment-thumb" title={renaming ? undefined : detail ? `${name} · ${detail}` : name}>
			<img {src} alt={name} />
			<figcaption class="ap-attachment-label">{@render label('ap-attachment-name', 'ap-attachment-size')}</figcaption>
		</figure>
	{:else if kind === 'audio'}
		<div class="ap-embed ap-embed-card ap-embed-audiocard">
			<span class="ap-embed-cardtext">{@render label('ap-embed-title', 'ap-embed-detail')}</span>
			<audio class="ap-embed-audio" {src} controls preload="metadata"></audio>
		</div>
	{:else}
		<div class="ap-embed ap-embed-card ap-embed-file">
			<span class="ap-embed-fileglyph">
				{#if kind === 'link'}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
				{:else}
					<FileGlyph />
				{/if}
			</span>
			<span class="ap-embed-cardtext">{@render label('ap-embed-title', 'ap-embed-detail')}</span>
		</div>
	{/if}
	{#if onremove && !renaming}
		{@const removeText = removeLabel ?? `Remove ${name}`}
		<button type="button" class="ap-embed-remove" aria-label={removeText} title={removeText} onclick={onremove}>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
		</button>
	{/if}
</div>
