<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import AttachmentTile from '$lib/design/components/AttachmentTile.svelte';
	import DesignMessageEditor from '$lib/design/components/MessageEditor.svelte';
	import type { EmbedEdits, UploadState } from '$lib/protocol/client';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { Embed } from '$lib/protocol/types';
	import { embedTile } from '$lib/ui/attachments';
	import { directory } from '$lib/ui/directory.svelte';
	import { handheld } from '$lib/ui/handheld';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import MessageField from './MessageField.svelte';
	import type { MessageEditorField } from '$lib/design/components/types';

	/**
	 * Your message being edited, in place (the design system's
	 * `MessageEditor`): its text over its embeds, shown as tiles as on a
	 * draft. A tile's (x) leaves that embed out of the save and
	 * an upload's name can be changed (its `title`, §4.8.4); nothing is sent
	 * until Save, and Cancel or Escape drops it all. An upload still being
	 * written can't be removed. The text is written as in the composer, with
	 * mentions as chips and the same autocomplete (`MessageField`); who it
	 * mentions is saved from its chips.
	 */
	interface Props {
		text: string;
		embeds: Embed[];
		/** Files this client is writing to upload embeds, by `embed_id`. */
		uploads: Record<string, UploadState>;
		/** Who the message mentions now (`body.mentions`): their `@user_id`s in the text show as chips, known or not. */
		mentions?: string[];
		/** Who an `@` can name, as in the composer. */
		people?: MentionPerson[];
		/** Rooms and threads a `#` can name. */
		rooms?: RoomSuggestion[];
		/** The new text, the embed changes if there are any, and who the new text mentions (`body.mentions`, §3.5). */
		onsave: (text: string, edits: EmbedEdits | undefined, mentions: string[]) => void;
		oncancel: () => void;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
	}
	let { text, embeds, uploads, mentions: mentioned = [], people = [], rooms = [], onsave, oncancel, onmention }: Props = $props();

	const onHandheld = handheld();
	let value = $state(untrack(() => text));
	let mentions = $state<string[]>([]);
	let field = $state<MessageField | undefined>();
	// It opens with the focus, the caret at the end.
	onMount(() => field?.focus(true));
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
	let changed = $derived(value !== text || shown.length !== embeds.length || renamed.length > 0);
	/** A message keeps text or an embed (§3.5); emptied, it's deleted instead. */
	let canSave = $derived(Boolean(value.trim()) || shown.length > 0);
	const writing = (embed: Embed): boolean => Boolean(embed.embed_id && uploads[embed.embed_id] && !uploads[embed.embed_id].failed);

	function save(): void {
		field?.finish();
		if (!canSave) return;
		if (!changed) {
			oncancel();
			return;
		}
		const dropped = embeds.filter((embed) => removed.includes(embedKey(embed)));
		const edits: EmbedEdits = { ...(dropped.length ? { removed: dropped } : {}), ...(renamed.length ? { renamed } : {}) };
		onsave(value, dropped.length || renamed.length ? edits : undefined, mentions);
	}
</script>

<DesignMessageEditor testid="message-editor" {value} {canSave} handheld={onHandheld} onsave={save} {oncancel} field={editable} attachments={shown.length > 0 ? tiles : undefined} />

{#snippet editable({ class: className, label }: MessageEditorField)}
	<MessageField bind:this={field} bind:value bind:mentions {people} {rooms} known={mentioned} class={className} aria-label={label} onsubmit={save} {onmention} />
{/snippet}

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
