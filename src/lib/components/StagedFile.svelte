<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import { fileSize } from '$lib/ui/images';

	/**
	 * A file attached to the draft, before it is sent: an image as a
	 * thumbnail, a voice clip or other audio with a player to listen back,
	 * anything else as a file card with its size. Previews read the local
	 * file and let it go once the file leaves the draft.
	 */
	let { file }: { file: File } = $props();
	let kind = $derived(file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file');
	let name = $derived(file.name || 'File');
	let src = $state<string | undefined>();

	$effect(() => {
		if (kind === 'file') return;
		const url = URL.createObjectURL(file);
		src = url;
		return () => {
			URL.revokeObjectURL(url);
			src = undefined;
		};
	});
</script>

{#if kind === 'image'}
	<figure class="ap-embed ap-embed-figure staged-image" title={name}>
		<img class="ap-embed-media" {src} alt={name} />
	</figure>
{:else if kind === 'audio'}
	<div class="ap-embed ap-embed-card ap-embed-audiocard staged-audio">
		<span class="ap-embed-title">{name}</span>
		<audio class="ap-embed-audio" {src} controls preload="metadata"></audio>
	</div>
{:else}
	<div class="ap-embed ap-embed-card ap-embed-file">
		<span class="ap-embed-fileglyph">
			<FileIcon size={20} aria-hidden="true" />
		</span>
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{name}</span>
			<span class="ap-embed-detail">{fileSize(file.size)}</span>
		</span>
	</div>
{/if}

<style>
	/* Thumbnails stay small so a few fit beside each other above the field. */
	.staged-image .ap-embed-media { height: 96px; max-width: 200px; object-fit: cover; }
	.staged-audio { min-width: 260px; }
</style>
