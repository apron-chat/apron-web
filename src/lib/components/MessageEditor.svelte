<script lang="ts">
	import { untrack } from 'svelte';
	import AttachmentTile from '$lib/design/components/AttachmentTile.svelte';
	import DesignMessageEditor from '$lib/design/components/MessageEditor.svelte';
	import type { EmbedEdits, UploadState } from '$lib/protocol/client';
	import type { Embed } from '$lib/protocol/types';
	import { embedTile } from '$lib/ui/attachments';
	import { directory } from '$lib/ui/directory.svelte';
	import { handheld } from '$lib/ui/handheld';

	/**
	 * Your message being edited, in place (the design system's
	 * `MessageEditor`): its text over its embeds, shown as tiles as on a
	 * draft. A tile's (x) leaves that embed out of the save and
	 * an upload's name can be changed (its `title`, §4.8.4); nothing is sent
	 * until Save, and Cancel or Escape drops it all. An upload still being
	 * written can't be removed.
	 */
	interface Props {
		text: string;
		embeds: Embed[];
		/** Files this client is writing to upload embeds, by `embed_id`. */
		uploads: Record<string, UploadState>;
		/** The new text, and the embed changes if there are any. */
		onsave: (text: string, edits?: EmbedEdits) => void;
		oncancel: () => void;
	}
	let { text, embeds, uploads, onsave, oncancel }: Props = $props();

	const onHandheld = handheld();
	let draft = $state(untrack(() => text));
	/** Embeds removed and renamed so far, by `embedKey`; applied to the message as it is now when saved. */
	let removed = $state<string[]>([]);
	let titles = $state<Record<string, string>>({});

	/** An embed's name in the edit: its `embed_id`, or its value on a server that stores embeds as given. */
	const embedKey = (embed: Embed): string => embed.embed_id ?? JSON.stringify(embed);
	let shown = $derived(embeds.filter((embed) => !removed.includes(embedKey(embed))));
	let renamed = $derived(shown.flatMap((embed) => {
		const title = titles[embedKey(embed)];
		return title !== undefined && title !== embedTile(embed, directory.origin, directory.mediaOrigins).name ? [{ embed, title }] : [];
	}));
	let changed = $derived(draft !== text || shown.length !== embeds.length || renamed.length > 0);
	/** A message keeps text or an embed (§3.5); emptied, it's deleted instead. */
	let canSave = $derived(Boolean(draft.trim()) || shown.length > 0);
	const writing = (embed: Embed): boolean => Boolean(embed.embed_id && uploads[embed.embed_id] && !uploads[embed.embed_id].failed);

	function save(): void {
		if (!canSave) return;
		if (!changed) {
			oncancel();
			return;
		}
		const dropped = embeds.filter((embed) => removed.includes(embedKey(embed)));
		const edits: EmbedEdits = { ...(dropped.length ? { removed: dropped } : {}), ...(renamed.length ? { renamed } : {}) };
		onsave(draft, dropped.length || renamed.length ? edits : undefined);
	}
</script>

<DesignMessageEditor testid="message-editor" bind:value={draft} {canSave} handheld={onHandheld} onsave={save} {oncancel} attachments={shown.length > 0 ? tiles : undefined} />

{#snippet tiles()}
	{#each shown as embed, index (embed.embed_id ?? index)}
		{@const key = embedKey(embed)}
		{@const tile = embedTile(embed, directory.origin, directory.mediaOrigins)}
		{@const name = titles[key] ?? tile.name}
		<AttachmentTile {name} detail={tile.detail} kind={tile.kind} src={tile.src} labelTestid="edit-attachment"
			onrename={tile.renamable ? (title) => (titles[key] = title) : undefined}
			onremove={writing(embed) ? undefined : () => (removed = [...removed, key])} />
	{/each}
{/snippet}
