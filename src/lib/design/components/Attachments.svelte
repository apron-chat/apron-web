<script lang="ts">
	/* upload embeds still on the draft (§4.8.4): shown above the Composer, each removable, until the message is sent */
	import FileGlyph from './FileGlyph.svelte';

	interface Props {
		/**
		 * The draft's files, in the order they will be sent. `size` is the size they go out at, after an image is
		 * shrunk; until it is known pass `preparing`. `src` previews an image or audio clip (an object URL).
		 */
		files: { name: string; size?: string; preparing?: boolean; kind?: 'image' | 'audio' | 'file'; src?: string }[];
		/** The (x) on a file: take it off the draft. */
		onremove?: (index: number) => void;
	}
	let { files, onremove }: Props = $props();
</script>

{#if files.length > 0}
	<div class="ap-attachments" aria-label="Files to send">
		{#each files as file, index (index)}
			{@const detail = file.preparing ? 'Preparing…' : file.size ?? ''}
			<div class="ap-attachment">
				{#if file.kind === 'image'}
					<figure class="ap-embed ap-attachment-thumb" title={detail ? `${file.name} · ${detail}` : file.name}>
						<img src={file.src} alt={file.name} />
						<figcaption class="ap-attachment-label"><span class="ap-attachment-name">{file.name}</span>{#if detail}<span class="ap-attachment-size">{detail}</span>{/if}</figcaption>
					</figure>
				{:else if file.kind === 'audio'}
					<div class="ap-embed ap-embed-card ap-embed-audiocard">
						<span class="ap-embed-cardtext"><span class="ap-embed-title">{file.name}</span>{#if detail}<span class="ap-embed-detail">{detail}</span>{/if}</span>
						<audio class="ap-embed-audio" src={file.src} controls preload="metadata"></audio>
					</div>
				{:else}
					<div class="ap-embed ap-embed-card ap-embed-file">
						<span class="ap-embed-fileglyph"><FileGlyph /></span>
						<span class="ap-embed-cardtext"><span class="ap-embed-title">{file.name}</span>{#if detail}<span class="ap-embed-detail">{detail}</span>{/if}</span>
					</div>
				{/if}
				{#if onremove}
					<button type="button" class="ap-embed-remove" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} onclick={() => onremove(index)}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
