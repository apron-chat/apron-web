<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { CommandCompletion, CommandContext, CommandOffer, CommandQuery } from '$lib/ui/command-query';
	import { emojiAnchor, emojiPicker } from '$lib/ui/emoji-picker.svelte';
	import { draftFacts } from '$lib/design/components/compose';
	import { mediaLimit, type MediaTypes } from '$lib/protocol/client';
	import { MARKDOWN_EXTENSIONS } from '$lib/protocol/client-views';
	import { maskSpoilers } from '$lib/protocol/spoiler';
	import { linkPreviews, samePreviews } from '$lib/ui/link-previews';
	import type { Embed as LinkEmbed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { loadableOg } from './embeds/og';
	import { pastedFiles } from '$lib/ui/file-transfer';
	import { clockLabel } from '$lib/ui/time';
	import { handheld, onMac } from '$lib/ui/handheld';
	import type { StagedFile as Staged } from '$lib/ui/pane-drafts.svelte';
	import MentionText from './MentionText.svelte';
	import Embed from './embeds/Embed.svelte';
	import StagedFile from './StagedFile.svelte';
	import DesignComposer from '$lib/design/components/Composer.svelte';
	import MessageField from './MessageField.svelte';
	import { VoiceRecorder, type VoiceFormat } from '$lib/ui/voice-recorder.svelte';
	import type { ComposerField } from '$lib/design/components/types';
	import { draftPreview, formatToolbar } from './lazy';

	/** How long typing pauses before the draft's links are looked up; a paste looks them up at once. */
	const PREVIEW_TYPING_PAUSE_MS = 800;
	/** No link previews: one array, so a draft without them hands the design system's Composer the same one on every key. */
	const NO_PREVIEWS: LinkEmbed[] = [];
	/** What a clip may be recorded as where the server states the types it takes, by preference. */
	const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'];
	/** What an embedded draft goes as where the server states the types it takes, by preference: its name says Markdown either way. */
	const DRAFT_TYPES = ['text/markdown', 'text/plain', 'application/octet-stream'];

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
		/**
		 * Nothing can be written. The page never sets it: a draft is local, so the field takes typing whatever the
		 * connection, and only Send waits for it (`holdSend`).
		 */
		disabled?: boolean;
		/**
		 * The field takes typing, but nothing sends yet: Send stays off and Enter keeps the draft, as while the
		 * connection is down or still coming up.
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
		/** Who else an `@` can name though they aren't here, offered after `people`, faded, once something is typed. */
		outsiders?: MentionPerson[];
		/** The mentions that won't reach anyone as it would go (a `user_id`, or `&role`): their chips are greyed. */
		quiet?: ReadonlySet<string>;
		/** Rooms and threads available for `#room` mentions. */
		rooms?: RoomSuggestion[];
		/**
		 * The suggestions for a command being typed (`commandCompletion` over the server's commands, `ext:command_list`,
		 * with apron-web's own), given what the composer is doing; undefined while they are on their way. Only with
		 * `oncommand`.
		 */
		complete?: (found: CommandQuery, context: CommandContext) => CommandCompletion | undefined;
		/** A `/` started a command: set where the server lists its commands (`ext:command_list`), a moment to ask for them. */
		oncommand?: () => void;
		/** Browse all commands, at the end of the suggestions: open the command palette, its field holding `filter`. */
		onbrowse?: (filter: string) => void;
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
		/** What someone the picker offers who isn't here reads beside their name: "Not in room". */
		outsideLabel?: string;
		/** Sending waits until then, as the server asked (`retry_after`, epoch milliseconds): Send counts down, and the draft stays. */
		waitUntil?: number;
		/** A message sent from here is still on its way (waiting for its link previews): Send spins, and holds. */
		sending?: boolean;
	}
	let { value = $bindable(), mentions = $bindable([]), dismissed = $bindable([]), placeholder, disabled = false, holdSend = false, canUpload, files = [], uploadLimits, canCommand = false, live, people, outsiders, quiet, rooms = [], complete, oncommand, onbrowse, reply, oninput, onsend, onfiles, onunstage, onrename, oncancelreply, onescape, onup, onmention, outsideLabel, waitUntil, sending = false }: Props = $props();

	/** The field: chips and autocomplete, as in the message editor. */
	let field = $state<MessageField | undefined>();
	let emojiButton = $state<HTMLButtonElement | undefined>();
	let design = $state<DesignComposer | undefined>();
	const recorder = new VoiceRecorder();
	/**
	 * The full panel, for writing at length, with formatting: Expand offers it once the draft has a second line. Its formatting and
	 * Preview load on demand as it opens, and it closes again as the draft is sent or the pane changes.
	 */
	let expanded = $state(false);
	/** The full panel's Write or Preview. */
	let previewing = $state(false);
	/** Shown at the full panel's foot; not on a phone or tablet, whose keyboard has no Ctrl and whose Enter starts a line anyway. */
	const sendKeys = handheld() ? undefined : [onMac() ? '⌘' : 'Ctrl', 'Enter'];

	let recording = $derived(recorder.phase === 'recording');
	/**
	 * The file picker's `accept`: the patterns the server takes, unless one is any type. Markdown's extensions go with
	 * `text/markdown`, as not every system types a `.md` file.
	 */
	let accept = $derived(uploadLimits && !Object.hasOwn(uploadLimits, '*/*')
		? [...Object.keys(uploadLimits), ...(mediaLimit(uploadLimits, 'text/markdown') ? MARKDOWN_EXTENSIONS : [])].join(',')
		: undefined);
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
	/** What Embed as attachment sends the draft as: Markdown without stated limits, else the first of `DRAFT_TYPES` the server takes. Undefined: not offered. */
	let draftType = $derived(uploadLimits ? DRAFT_TYPES.find((type) => mediaLimit(uploadLimits, type)) : 'text/markdown');
	/** Voice messages need uploads, a type the server takes, and a browser that can record. */
	let canRecord = $derived(canUpload && voice !== undefined && Boolean(navigator.mediaDevices?.getUserMedia));
	/** What the field tells of the draft as it changes (`DraftField.facts`), where reading it would ask again on every key; the draft's own until the field is drawn. */
	let facts = $derived(field?.facts() ?? draftFacts(value));
	let command = $derived(canCommand && facts.command && !live);
	/** Commands are offered as they're typed only where they're sent as commands, and not while the draft is live text. */
	let offersCommands = $derived(canCommand && !live && oncommand !== undefined);
	/** What the field reads of them, as it reads it (`CommandOffer`): one object, made once. */
	const commandOffer: CommandOffer = {
		get complete() {
			const completing = complete;
			return completing && ((found: CommandQuery) => completing(found, { replying: reply !== undefined, attaching: files.length > 0 }));
		},
		started: () => oncommand?.(),
		get browse() { return onbrowse; }
	};
	let emojiOpen = $derived(emojiPicker.isOpenFor(emojiButton));
	/**
	 * Expand is offered once the draft has a second line and can be written; the design system's Composer leaves it
	 * out for a command or live text.
	 */
	let canExpand = $derived(!expanded && !disabled && facts.multiline);
	/** Bumped when a fetched preview arrives, so the previews below are redrawn. */
	let previewsArrived = $state(0);
	/**
	 * The draft where it may hold a link (every one previewed has `://`), else empty: what link previews read, so a
	 * draft without a link doesn't look for them again on every key. A link in a spoiler gets none, which would show it.
	 */
	let linkText = $derived(facts.linked ? maskSpoilers(value) : '');
	/** The previews last found: kept while typing finds the same ones, so their cards aren't drawn again on every key. */
	let lastPreviews: LinkEmbed[] = NO_PREVIEWS;
	/** The link embeds the draft will be sent with (a command takes none). */
	let previews = $derived.by(() => {
		void previewsArrived;
		const embeds = !linkText || command || disabled ? NO_PREVIEWS : linkPreviews.embeds(linkText, dismissed);
		const next = embeds.length && live ? NO_PREVIEWS : embeds;
		return (lastPreviews = samePreviews(lastPreviews, next) ? lastPreviews : next);
	});
	/** Those as the design system's Composer takes them: their pictures only from where link previews may load from (each is drawn by `preview` below, which asks the same). */
	let previewCards = $derived(previews.map((embed) => ({ ...embed, og: loadableOg(embed.og, directory.mediaGate) })));

	$effect(() => linkPreviews.subscribe(() => previewsArrived++));
	// Typed links are looked up once typing pauses, so a half-typed URL isn't.
	$effect(() => {
		const text = linkText;
		if (!text || command || disabled || linkPreviews.links(text).length === 0 || live) return;
		const timer = setTimeout(() => void linkPreviews.prefetch(text), PREVIEW_TYPING_PAUSE_MS);
		return () => clearTimeout(timer);
	});
	// A sent or cleared draft forgets which previews were removed.
	$effect(() => {
		if (facts.blank && untrack(() => dismissed.length)) dismissed = [];
	});

	export function focus(): void {
		field?.focus();
	}

	/** The full panel is open, to make room for it. Reactive. */
	export function isExpanded(): boolean {
		return expanded;
	}

	/** The draft is past one line, to make room for it. Reactive, as it changes with every key: read it only where that matters. */
	export function isGrown(): boolean {
		return design?.isGrown() ?? false;
	}

	/** Puts `/name ` at the draft's start (a command picked in the palette), and focuses the field. */
	export function putCommand(name: string): void {
		field?.putCommand(name);
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
		expanded = false;
		previewing = false;
		field?.reset();
		emojiPicker.release(emojiButton);
		stopRecording(false);
	}

	$effect(() => () => stopRecording(false));
	/**
	 * The draft was emptied from outside, as sending it does (Send, Ctrl+Enter, or the ask to add who it mentions): the
	 * full panel closes with it. Emptied by typing, the panel stays, to write in.
	 */
	function cleared(): void {
		if (expanded) setExpanded(false);
	}
	// The emoji picker lets go of its button when the button goes (`emojiAnchor`, as on a message's React).
	$effect(() => (emojiButton ? emojiAnchor(emojiButton) : undefined));

	function send(): void {
		// Enter while sending waits: the draft stays as it is.
		if (holdSend || sending || (waitUntil !== undefined && waitUntil > Date.now())) return;
		field?.finish();
		onsend();
	}

	const expand = (): void => setExpanded(true);

	/**
	 * Embed as attachment (the full panel's, and the compact one's beside Expand): the draft, Markdown as written, goes to
	 * its files as `message.md` (renamable there) rather than into the message. Emptied from here, the field closes the
	 * full panel (`cleared`), leaving the file and the compact field for a caption. It goes as the first of `DRAFT_TYPES` the server takes it at, size included.
	 * A draft too large for every one is still offered, as the type with the largest limit, so the files say why they
	 * refused it and how large it may be; the draft stays.
	 */
	function attachDraft(): void {
		if (!value.trim() || !draftType) return;
		const size = new Blob([value]).size;
		const max = (type: string) => (uploadLimits ? mediaLimit(uploadLimits, type)?.max_bytes : undefined) ?? Infinity;
		const taken = DRAFT_TYPES.filter((type) => !uploadLimits || mediaLimit(uploadLimits, type));
		const type = taken.find((each) => size <= max(each));
		onfiles([new File([value], 'message.md', { type: type ?? taken.reduce((a, b) => (max(b) > max(a) ? b : a)) })]);
		if (!type) return;
		value = '';
		oninput();
	}

	/** Opens or closes the full panel around the same field, and puts the keyboard back in it, where it was. */
	function setExpanded(open: boolean): void {
		expanded = open;
		previewing = false;
		void tick().then(() => field?.focus());
	}

	/**
	 * The field's keys no picker took: Escape puts away an ask about the draft, else closes the full panel, else cancels
	 * a reply, and ↑ in the empty compact field goes up to the messages.
	 */
	function key(event: KeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
		if (event.key === 'Escape' && onescape?.()) {
			// Taken: an ask about the draft went away, and the reply stays.
		} else if (event.key === 'Escape' && expanded) setExpanded(false);
		else if (expanded) return false;
		else if (event.key === 'Escape' && reply) oncancelreply();
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
	{sending}
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
	onexpand={canExpand ? expand : undefined}
	onattachdraft={canUpload && draftType && !live && !command ? attachDraft : undefined}
	{expanded}
	bind:this={design}
	oncollapse={() => setExpanded(false)}
	toolbar={formatting}
	{rendered}
	{previewing}
	onpreview={(on) => (previewing = on)}
	{sendKeys}
	{facts}
	expandTestid="composer-expand"
	panelTestid="composer-panel"
/>

{#snippet editable({ placeholder, disabled }: ComposerField)}
	<MessageField bind:this={field} bind:value bind:mentions {people} {outsiders} {quiet} {rooms} {placeholder} {disabled} newlineOnEnter={expanded} id="message-input" data-testid="message-input" pickerTestid="mention-picker" onsubmit={send} onkey={key} {oninput} oncleared={cleared} {onmention} {outsideLabel} onpaste={paste} commands={offersCommands ? commandOffer : undefined} />
{/snippet}
<!-- The full panel's parts, loaded on demand as it first opens: until they come, it is a tall field with Send. -->
{#snippet formatting()}{#if formatToolbar.component}{@const FormatToolbar = formatToolbar.component}<FormatToolbar apply={(change) => field?.apply(change) ?? false} {disabled} />{/if}{/snippet}
{#snippet rendered()}{#if draftPreview.component}{@const DraftPreview = draftPreview.component}<DraftPreview text={value} links />{/if}{/snippet}
{#snippet replyText()}<MentionText text={reply?.text ?? ''} />{/snippet}
{#snippet staged()}
	{#each files as staged (staged.id)}
		<StagedFile {staged} onrename={(title) => onrename(staged.id, title)} onremove={() => { onunstage(staged.id); focus(); }} />
	{/each}
{/snippet}
{#snippet preview(index: number)}<Embed embed={previews[index]} />{/snippet}
