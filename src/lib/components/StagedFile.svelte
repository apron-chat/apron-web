<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import type { UploadFile } from '$lib/protocol/client';
	import { fileSize } from '$lib/ui/images';
	import type { StagedFile } from '$lib/ui/pane-drafts.svelte';

	/**
	 * A file attached to the draft, before it is sent (the design system's
	 * `Attachments`): an image as a thumbnail, a voice clip or other audio
	 * with a player to listen back, anything else as a file card. Each is labeled with its name and size as
	 * they will be sent, once the file is readied (an image shrunk and maybe
	 * re-encoded). Previews read the local file and let it go once the file
	 * leaves the draft.
	 */
	let { staged }: { staged: StagedFile } = $props();
	let file = $derived(staged.file);
	let kind = $derived(file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file');
	let src = $state<string | undefined>();
	/** The file as it will be sent, once readied. */
	let ready = $state<UploadFile | undefined>();
	let name = $derived(ready?.file.name || file.name || 'File');
	let detail = $derived(ready ? fileSize(ready.file.size) : 'Preparing…');

	$effect(() => {
		if (kind === 'file') return;
		const url = URL.createObjectURL(file);
		src = url;
		return () => {
			URL.revokeObjectURL(url);
			src = undefined;
		};
	});

	$effect(() => {
		const prepared = staged.prepared;
		let current = true;
		ready = undefined;
		// A file that can't be readied is taken off the draft with the reason.
		prepared.then((result) => { if (current) ready = result; }, () => {});
		return () => { current = false; };
	});
</script>

{#if kind === 'image'}
	<figure class="ap-embed ap-attachment-thumb" title={`${name} · ${detail}`}>
		<img {src} alt={name} />
		<figcaption class="ap-attachment-label" data-testid="staged-label">
			<span class="ap-attachment-name">{name}</span>
			<span class="ap-attachment-size">{detail}</span>
		</figcaption>
	</figure>
{:else if kind === 'audio'}
	<div class="ap-embed ap-embed-card ap-embed-audiocard">
		<span class="ap-embed-cardtext" data-testid="staged-label">
			<span class="ap-embed-title">{name}</span>
			<span class="ap-embed-detail">{detail}</span>
		</span>
		<audio class="ap-embed-audio" {src} controls preload="metadata"></audio>
	</div>
{:else}
	<div class="ap-embed ap-embed-card ap-embed-file">
		<span class="ap-embed-fileglyph">
			<FileIcon size={20} aria-hidden="true" />
		</span>
		<span class="ap-embed-cardtext" data-testid="staged-label">
			<span class="ap-embed-title">{name}</span>
			<span class="ap-embed-detail">{detail}</span>
		</span>
	</div>
{/if}
