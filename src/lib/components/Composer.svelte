<script lang="ts">
	import { untrack } from 'svelte';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import { emojiAnchor, emojiPicker } from '$lib/ui/emoji-picker.svelte';
	import { isCommand } from '$lib/ui/commands';
	import { mediaLimit, type MediaTypes } from '$lib/protocol/client';
	import { linkPreviews } from '$lib/ui/link-previews';
	import { directory } from '$lib/ui/directory.svelte';
	import { loadableOg } from './embeds/og';
	import { pastedFiles } from '$lib/ui/file-transfer';
	import { clockLabel } from '$lib/ui/time';
	import type { StagedFile as Staged } from '$lib/ui/pane-drafts.svelte';
	import MentionText from './MentionText.svelte';
	import Embed from './embeds/Embed.svelte';
	import StagedFile from './StagedFile.svelte';
	import DesignComposer from '$lib/design/components/Composer.svelte';
	import MessageField from './MessageField.svelte';
	import { VoiceRecorder, type VoiceFormat } from '$lib/ui/voice-recorder.svelte';
	import type { ComposerField } from '$lib/design/components/types';

	/** How long typing pauses before the draft's links are looked up; a paste looks them up at once. */
	const PREVIEW_TYPING_PAUSE_MS = 800;
	/** What a clip may be recorded as where the server states the types it takes, by preference. */
	const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'];

	interface Props {
		/** The draft as sent: mentions are `@user_id` (Appendix A.3); the field shows them as name chips. */
		value: string;
		/**
		 * The `user_id`s the draft mentions, for `body.mentions` (§3.5): one per
		 * chip, picked or typed out in full, so a chip deleted from the text is
		 * no longer mentioned.
		 */
		mentions?: string[];
		/**
		 * Link previews removed from this draft, by URL: the message goes out
		 * without them. Emptied with the draft.
		 */
		dismissed?: string[];
		placeholder: string;
		disabled: boolean;
		/**
		 * The field takes typing, but nothing sends yet: Send stays off and Enter keeps the draft, as while a short
		 * drop of the connection comes back.
		 */
		holdSend?: boolean;
		/** Attachments and voice clips (capability `embed:upload`, §4.8.4): each file goes out as an `upload` embed. */
		canUpload: boolean;
		/**
		 * The types of attachment the server takes and their limits, where it
		 * states them (`ext.media.upload`, EXT.md §6): the file picker offers
		 * those, and a voice clip is recorded as one of them, or not offered.
		 */
		uploadLimits?: MediaTypes;
		/** Files attached to the draft, shown above the field until it is sent; each can be removed first. */
		files?: Staged[];
		/**
		 * Cap `command` (§4.1): text starting with one `/` is a command, shown
		 * with a Command tag in monospace and sent with Run.
		 */
		canCommand?: boolean;
		/**
		 * Live typing (`/live`): the draft is a message others see as it is typed (an `append` embed, §4.8.5), so it is
		 * no command and takes no link previews, and Send finishes it.
		 */
		live?: boolean;
		/** Who an `@` can name: the room's members, else its recent senders. */
		people: MentionPerson[];
		/** Rooms and threads available for `#room` mentions. */
		rooms?: RoomSuggestion[];
		/** The message being replied to, when there is one: its sender and first line, or why it can't be shown. */
		reply?: { name?: string; text: string };
		oninput: () => void;
		onsend: () => void;
		/** Picked or pasted files, or a finished voice clip, to attach to the draft. */
		onfiles: (files: File[]) => void;
		/** A staged file's (x): take it off the draft. */
		onunstage: (id: string) => void;
		/** A staged file's new name, which it is sent with. */
		onrename: (id: string, title: string) => void;
		/** Escape while replying (`reply`) cancels it too. */
		oncancelreply: () => void;
		/** Escape no picker took, before a reply's cancel, such as to put away an ask about the draft. True when it did something. */
		onescape?: () => boolean;
		/** ↑ in the empty field: the keyboard goes up to the messages. True when there was one to go to. */
		onup?: () => boolean;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
		/** Sending waits until then, as the server asked (`retry_after`, epoch milliseconds): Send counts down, and the draft stays. */
		waitUntil?: number;
	}
	let { value = $bindable(), mentions = $bindable([]), dismissed = $bindable([]), placeholder, disabled, holdSend = false, canUpload, files = [], uploadLimits, canCommand = false, live, people, rooms = [], reply, oninput, onsend, onfiles, onunstage, onrename, oncancelreply, onescape, onup, onmention, waitUntil }: Props = $props();

	/** The field: chips and autocomplete, as in the message editor. */
	let field = $state<MessageField | undefined>();
	let emojiButton = $state<HTMLButtonElement | undefined>();
	const recorder = new VoiceRecorder();

	let recording = $derived(recorder.phase === 'recording');
	/** The file picker's `accept`: the patterns the server takes, unless one is any type. */
	let accept = $derived(uploadLimits && !Object.hasOwn(uploadLimits, '*/*') ? Object.keys(uploadLimits).join(',') : undefined);
	/**
	 * What a voice clip is recorded as, and its `max_bytes`: the browser's own
	 * type without stated limits, else the first of `VOICE_TYPES` that the
	 * browser records and the server takes. Undefined: no voice clips.
	 */
	let voice = $derived.by((): VoiceFormat | undefined => {
		if (typeof MediaRecorder === 'undefined') return undefined;
		if (!uploadLimits) return {};
		for (const type of VOICE_TYPES) {
			const limit = mediaLimit(uploadLimits, type);
			if (limit && MediaRecorder.isTypeSupported(type)) return { type, maxBytes: limit.max_bytes };
		}
		return undefined;
	});
	/** Voice messages need uploads, a type the server takes, and a browser that can record. */
	let canRecord = $derived(canUpload && voice !== undefined && Boolean(navigator.mediaDevices?.getUserMedia));
	let command = $derived(canCommand && isCommand(value) && !live);
	let emojiOpen = $derived(emojiPicker.isOpenFor(emojiButton));
	/** Bumped when a fetched preview arrives, so the previews below are redrawn. */
	let previewsArrived = $state(0);
	/** The link embeds the draft will be sent with (a command takes none). */
	let previews = $derived.by(() => {
		void previewsArrived;
		if (command || disabled) return [];
		const embeds = linkPreviews.embeds(value, dismissed);
		return embeds.length && live ? [] : embeds;
	});
	/** Those as the design system's Composer takes them: their pictures only from where link previews may load from (each is drawn by `preview` below, which asks the same). */
	let previewCards = $derived(previews.map((embed) => ({ ...embed, og: loadableOg(embed.og, directory.mediaGate) })));

	$effect(() => linkPreviews.subscribe(() => previewsArrived++));
	// Typed links are looked up once typing pauses, so a half-typed URL isn't.
	$effect(() => {
		const text = value;
		if (command || disabled || linkPreviews.links(text).length === 0 || live) return;
		const timer = setTimeout(() => void linkPreviews.prefetch(text), PREVIEW_TYPING_PAUSE_MS);
		return () => clearTimeout(timer);
	});
	// A sent or cleared draft forgets which previews were removed.
	$effect(() => {
		if (!value.trim() && untrack(() => dismissed.length)) dismissed = [];
	});

	export function focus(): void {
		field?.focus();
	}

	/** Puts a mention chip for this user where the caret was (else at the end), as picking them would, and focuses the field. */
	export function mention(userId: string): void {
		field?.mention(userId);
	}

	/**
	 * Closes the picker and stops any recording without sending: the pane is changing under it. The previews removed
	 * stay with the draft, which the page keeps per pane.
	 */
	export function reset(): void {
		field?.reset();
		emojiPicker.release(emojiButton);
		stopRecording(false);
	}

	$effect(() => () => stopRecording(false));
	// The emoji picker lets go of its button when the button goes (`emojiAnchor`, as on a message's React).
	$effect(() => (emojiButton ? emojiAnchor(emojiButton) : undefined));

	function send(): void {
		// Enter while sending waits: the draft stays as it is.
		if (holdSend || (waitUntil !== undefined && waitUntil > Date.now())) return;
		field?.finish();
		onsend();
	}

	/** The field's keys no picker took: Escape cancels a reply, and ↑ in the empty field goes up to the messages. */
	function key(event: KeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
		if (event.key === 'Escape' && onescape?.()) {
			// Taken: an ask about the draft went away, and the reply stays.
		} else if (event.key === 'Escape' && reply) oncancelreply();
		else if (!(event.key === 'ArrowUp' && !value && files.length === 0 && onup?.())) return false;
		event.preventDefault();
		return true;
	}

	/** The emoji button: the full picker, whose pick lands where the caret was. Emoji are text, so no capability gates it. */
	function openEmoji(): void {
		if (emojiButton) emojiPicker.toggle({ anchor: emojiButton, onpick: (emoji) => field?.insert(emoji) });
	}

	/** Drops a link's preview from this draft; typing carries on in the field. */
	function dismissPreview(url: string): void {
		dismissed = [...dismissed, url];
		focus();
	}

	/** A pasted image (or file) is attached like a picked one, unless the paste is text (`pastedFiles`). */
	function paste(event: ClipboardEvent): void {
		const files = pastedFiles(event.clipboardData);
		if (canUpload && !disabled && !recording && files.length) {
			event.preventDefault();
			onfiles(files);
			return;
		}
		void linkPreviews.prefetch(event.clipboardData?.getData('text/plain') ?? '');
	}

	/** Microphone: record, then hand the clip over as an audio file. */
	function startRecording(): void {
		if (disabled || !canRecord || !voice) return;
		void recorder.start(voice, (clip) => onfiles([clip]));
	}

	function stopRecording(send = true): void {
		recorder.stop(send);
	}
</script>

<!-- The design system's Composer draws the field and what sits above it; this fills in the editing: chips, autocomplete, recording, files and previews. -->
<DesignComposer
	{placeholder}
	{value}
	{disabled}
	canSend={holdSend ? false : undefined}
	{canCommand}
	{live}
	{canUpload}
	{canRecord}
	{onfiles}
	{accept}
	onrecord={startRecording}
	onstoprecording={() => stopRecording()}
	{recording}
	recordingTime={clockLabel(recorder.seconds)}
	onsend={send}
	{waitUntil}
	field={editable}
	onemoji={openEmoji}
	{emojiOpen}
	bind:emojiButton
	{reply}
	{replyText}
	{oncancelreply}
	attachments={files.length > 0 ? staged : undefined}
	previews={previewCards}
	{preview}
	onremovepreview={(index) => dismissPreview(previews[index]?.url ?? '')}
	replyTestid="reply-draft"
	attachmentsTestid="staged-files"
	previewsTestid="link-previews"
	fileInputTestid="attach-input"
	commandTestid="command-tag"
	liveTestid="live-tag"
	emojiTestid="emoji-button"
	sendTestid="send-button"
/>

{#snippet editable({ placeholder, disabled }: ComposerField)}
	<MessageField bind:this={field} bind:value bind:mentions {people} {rooms} {placeholder} {disabled} id="message-input" data-testid="message-input" pickerTestid="mention-picker" onsubmit={send} onkey={key} {oninput} {onmention} onpaste={paste} />
{/snippet}
{#snippet replyText()}<MentionText text={reply?.text ?? ''} />{/snippet}
{#snippet staged()}
	{#each files as staged (staged.id)}
		<StagedFile {staged} onrename={(title) => onrename(staged.id, title)} onremove={() => { onunstage(staged.id); focus(); }} />
	{/each}
{/snippet}
{#snippet preview(index: number)}<Embed embed={previews[index]} />{/snippet}
