<script lang="ts">
	/* upload embeds still on the draft (§4.8.4): shown above the Composer, each removable and renamable, until the message is sent */
	import AttachmentTile from './AttachmentTile.svelte';

	interface Props {
		/**
		 * The draft's files, in the order they will be sent. `size` is the size they go out at, after an image is
		 * shrunk; until it is known pass `preparing`. `src` previews an image or audio clip (an object URL).
		 */
		files: { name: string; size?: string; preparing?: boolean; kind?: 'image' | 'audio' | 'file'; src?: string }[];
		/** The (x) on a file: take it off the draft. */
		onremove?: (index: number) => void;
		/** A file's new name, the `title` it is sent with (the whole name, extension and all). */
		onrename?: (index: number, name: string) => void;
	}
	let { files, onremove, onrename }: Props = $props();
</script>

{#if files.length > 0}
	<div class="ap-attachments" aria-label="Files to send">
		{#each files as file, index (index)}
			<AttachmentTile name={file.name} detail={file.preparing ? 'Preparing…' : file.size} kind={file.kind} src={file.src}
				onremove={onremove && (() => onremove(index))} onrename={onrename && ((name) => onrename(index, name))} />
		{/each}
	</div>
{/if}
