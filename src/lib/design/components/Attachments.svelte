<script lang="ts">
	/* upload embeds still on the draft (§4.8.4): shown above the Composer, each removable and renamable, until the message is sent */
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import AttachmentTile from './AttachmentTile.svelte';
	import type { AttachmentFile } from './types';

	/** Other attributes (`data-*`, a different `aria-label`, a `class`) go on the row. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/**
		 * The draft's files, in the order they will be sent. `size` is the size they go out at, after an image is
		 * shrunk; until it is known pass `preparing`. `src` previews an image or audio clip (an object URL).
		 */
		files?: AttachmentFile[];
		/** The (x) on a file: take it off the draft. */
		onremove?: (index: number) => void;
		/** A file's new name, the `title` it is sent with (the whole name, extension and all). */
		onrename?: (index: number, name: string) => void;
		/** Your own tiles in place of `files`', such as AttachmentTiles whose previews you manage. */
		children?: Snippet;
	}
	let { files = [], onremove, onrename, children, class: className, ...rest }: Props = $props();
</script>

{#if children || files.length > 0}
	<div aria-label="Files to send" {...rest} class={['ap-attachments', className]}>
		{#if children}{@render children()}
		{:else}
			{#each files as file, index (index)}
				<AttachmentTile name={file.name} detail={file.preparing ? 'Preparing…' : file.size} kind={file.kind} src={file.src}
					onremove={onremove && (() => onremove(index))} onrename={onrename && ((name) => onrename(index, name))} />
			{/each}
		{/if}
	</div>
{/if}
