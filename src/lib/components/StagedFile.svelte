<script lang="ts">
	import type { UploadFile } from '$lib/protocol/client';
	import AttachmentTile from '$lib/design/components/AttachmentTile.svelte';
	import { fileSize } from '$lib/ui/images';
	import type { StagedFile } from '$lib/ui/pane-drafts.svelte';

	/**
	 * A file attached to the draft, before it is sent (the design system's
	 * `AttachmentTile`): an image as a thumbnail, a voice clip or other audio
	 * with a player to listen back, anything else as a file card. Each is
	 * labeled with its name and size as they will be sent, once the file is
	 * readied (an image shrunk and maybe re-encoded), and can be renamed or
	 * taken off. Previews read the local file and let it go once the file
	 * leaves the draft.
	 */
	let { staged, onrename, onremove }: { staged: StagedFile; onrename: (title: string) => void; onremove: () => void } = $props();
	let file = $derived(staged.file);
	let kind = $derived<'image' | 'audio' | 'file'>(file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file');
	let src = $state<string | undefined>();
	/** The file as it will be sent, once readied. */
	let ready = $state<UploadFile | undefined>();
	let name = $derived(staged.title || ready?.file.name || file.name || 'File');
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

<AttachmentTile {name} {detail} {kind} {src} {onrename} {onremove} removeLabel={`Remove ${name}`} labelTestid="staged-label" />
