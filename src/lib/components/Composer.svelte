<script lang="ts">
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Square from '@lucide/svelte/icons/square';
	import Mic from '@lucide/svelte/icons/mic';
	import Smile from '@lucide/svelte/icons/smile';
	import { untrack } from 'svelte';
	import { mentionClass, mentionLabel, type Mention, type MentionPerson } from '$lib/protocol/markdown';
	import { collapseMentions, draftMentions, draftText, insertMention, insertText, mentionQuery, normalizeDraft, unchip, type DraftChip, type DraftPart } from '$lib/ui/draft';
	import { isAutocompleteDismissed, type DismissedAutocomplete } from '$lib/ui/autocomplete-dismiss';
	import { emojiQuery as findEmojiQuery, searchEmoji, type EmojiQuery, type EmojiSuggestion } from '$lib/ui/emoji-autocomplete';
	import { roomQuery as findRoomQuery, searchRooms, type RoomQuery, type RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { EmojiMartData } from '@emoji-mart/data';
	import { emojiAnchor, emojiPicker, loadEmojiData } from '$lib/ui/emoji-picker.svelte';
	import { isCommand } from '$lib/ui/commands';
	import { directory } from '$lib/ui/directory.svelte';
	import { findGitHubLinks, linkPreviews } from '$lib/ui/link-previews';
	import { clockLabel } from '$lib/ui/time';
	import AutocompletePicker from './AutocompletePicker.svelte';
	import Avatar from './Avatar.svelte';
	import MentionText from './MentionText.svelte';
	import Embed from './embeds/Embed.svelte';
	import EmbedRemove from './embeds/EmbedRemove.svelte';

	const MENTION_MATCHES_MAX = 8;
	/** How long typing pauses before the draft's links are looked up; a paste looks them up at once. */
	const PREVIEW_TYPING_PAUSE_MS = 800;

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
		/** Attachments and voice clips (capability `embed:upload`, §4.6.4): each file goes out as an `upload` embed. */
		canUpload: boolean;
		/** False once the server showed it takes images only: voice clips are hidden. */
		canUploadAudio?: boolean;
		/**
		 * Cap `command` (§4.8): text starting with one `/` is a command, shown
		 * with a Command tag in monospace and sent with Run.
		 */
		canCommand?: boolean;
		/** Who an `@` can name: the room's members, else its recent senders. */
		people: MentionPerson[];
		/** Rooms and threads available for `#room` mentions. */
		rooms?: RoomSuggestion[];
		/** The message being replied to, when there is one: its sender and first line, or why it can't be shown. */
		reply?: { name?: string; text: string };
		oninput: () => void;
		onsend: () => void;
		/** Picked files or a finished voice clip, to send with whatever is in the field. */
		onfiles: (files: File[]) => void;
		oncancelreply: () => void;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
	}
	let { value = $bindable(), mentions = $bindable([]), dismissed = $bindable([]), placeholder, disabled, canUpload, canUploadAudio = true, canCommand = false, people, rooms = [], reply, oninput, onsend, onfiles, oncancelreply, onmention }: Props = $props();

	/** Unique per composer, for the open picker's ID. */
	const uid = $props.id();
	const pickerId = `${uid}-suggestions`;
	let field = $state<HTMLDivElement | undefined>();
	let attachInput = $state<HTMLInputElement | undefined>();
	let emojiButton = $state<HTMLButtonElement | undefined>();
	/** The selection in the draft text when the field last lost focus: where a picked emoji goes. */
	let lastSelection: { start: number; end: number } | undefined;
	/** The text after `@` at the caret, or undefined when the picker is closed. */
	let query = $state<string | undefined>();
	/** The `:shortcode` or `#room` at the caret, while its picker is open. */
	let emojiFound = $state<EmojiQuery | undefined>();
	let roomFound = $state<RoomQuery | undefined>();
	let dismissedAutocomplete = $state<DismissedAutocomplete | undefined>();
	let emojiData = $state.raw<EmojiMartData | undefined>();
	let active = $state(0);
	/** Where the `@` being completed starts, in the draft text. */
	let anchor = 0;
	/** The draft text the field shows, and the field showing it. */
	let shown: { field: HTMLDivElement; text: string } | undefined;
	let recordSeconds = $state<number | undefined>();
	let recorder: MediaRecorder | undefined;
	let recordTimer: ReturnType<typeof setInterval> | undefined;

	let recording = $derived(recordSeconds !== undefined);
	/** Voice messages need both uploads and a browser that can record. */
	let canRecord = $derived(canUpload && canUploadAudio && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
	let matches = $derived(query === undefined ? [] : matching(query));
	let emojiMatches = $derived(emojiFound && emojiData ? searchEmoji(emojiData, emojiFound.query) : []);
	/** The IDs a typed `#room_id` collapses into a chip for. */
	let roomIds = $derived(rooms.map((room) => room.id));
	let roomMatches = $derived(roomFound ? searchRooms(rooms, roomFound.query) : []);
	let pickerOpen = $derived(query !== undefined && !disabled);
	let roomPickerOpen = $derived(roomFound !== undefined && !disabled);
	/** Opens once the emoji data has loaded, rather than showing "no match" meanwhile. */
	let emojiPickerOpen = $derived(emojiFound !== undefined && emojiData !== undefined && !disabled);
	/**
	 * The open picker (at most one is): how many suggestions it has, how to
	 * take one, and whether Enter does (Tab always does). A bare `#` lists
	 * rooms to browse, but Enter there still sends or breaks the line.
	 */
	let completion = $derived.by((): { count: number; take: (index: number) => void; enter: boolean } | undefined => {
		if (pickerOpen) return { count: matches.length, take: (index) => pick(matches[index]), enter: true };
		if (roomPickerOpen) return { count: roomMatches.length, take: (index) => pickRoom(roomMatches[index]), enter: roomFound?.query !== '' };
		if (emojiPickerOpen) return { count: emojiMatches.length, take: (index) => pickEmoji(emojiMatches[index]), enter: true };
		return undefined;
	});
	let activeIndex = $derived(Math.min(active, Math.max(0, (completion?.count ?? 0) - 1)));
	let empty = $state(true);
	let command = $derived(canCommand && isCommand(value));
	let emojiOpen = $derived(emojiPicker.isOpenFor(emojiButton));
	/** Bumped when a fetched preview arrives, so the previews below are redrawn. */
	let previewsArrived = $state(0);
	/** The link embeds the draft will be sent with (a command takes none). */
	let previews = $derived.by(() => {
		void previewsArrived;
		return command || disabled ? [] : linkPreviews.embeds(value, dismissed);
	});

	$effect(() => linkPreviews.subscribe(() => previewsArrived++));
	// Typed links are looked up once typing pauses, so a half-typed URL isn't.
	$effect(() => {
		const text = value;
		if (command || disabled || findGitHubLinks(text).length === 0) return;
		const timer = setTimeout(() => void linkPreviews.prefetch(text), PREVIEW_TYPING_PAUSE_MS);
		return () => clearTimeout(timer);
	});
	// A sent or cleared draft forgets which previews were removed.
	$effect(() => {
		if (!value.trim() && untrack(() => dismissed.length)) dismissed = [];
	});

	/** People whose name or ID starts with the query; someone it names exactly comes first. */
	function matching(text: string): MentionPerson[] {
		const lower = text.toLowerCase();
		const exact = lower.trimEnd();
		const scored = people
			.map((person) => {
				const name = (person.name ?? '').trim().toLowerCase();
				const id = person.id.toLowerCase();
				if (exact && (name === exact || id === exact)) return { person, rank: 0 };
				if (!lower || name.startsWith(lower) || id.startsWith(lower)) return { person, rank: 1 };
				return undefined;
			})
			.filter((entry) => entry !== undefined);
		return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.person).slice(0, MENTION_MATCHES_MAX);
	}

	/** Splits a name around the letters being typed, which read in accent. */
	function mark(text: string): { before: string; hit: string; after: string } {
		const typed = query ?? '';
		const at = typed ? text.toLowerCase().indexOf(typed.toLowerCase()) : -1;
		if (at < 0) return { before: text, hit: '', after: '' };
		return { before: text.slice(0, at), hit: text.slice(at, at + typed.length), after: text.slice(at + typed.length) };
	}

	const isUser = (id: string): boolean => directory.resolve(id)?.kind === 'user';

	export function focus(): void {
		if (!field) return;
		field.focus();
		const selection = document.getSelection();
		if (!selection || !field.contains(selection.anchorNode)) placeCaret(field, draftLength(readDraft(field).parts));
	}

	/** Closes the picker and stops any recording without sending: the pane is changing under it. */
	export function reset(): void {
		closeCompletions();
		dismissedAutocomplete = undefined;
		lastSelection = undefined;
		dismissed = [];
		emojiPicker.release(emojiButton);
		stopRecording(false);
	}

	$effect(() => () => stopRecording(false));

	// A draft set from outside (a room's saved draft, a cleared field) is drawn with its mentions as chips.
	$effect(() => {
		const current = field;
		const text = value;
		if (!current || (shown?.field === current && shown.text === text)) return;
		untrack(() => {
			lastSelection = undefined;
			const collapsed = collapseMentions([text], people, { caret: text.length, isUser, rooms: roomIds });
			draw(current, collapsed.parts, document.activeElement === current ? collapsed.caret : undefined);
			commit(current, collapsed.parts, false);
		});
	});

	// --- The field: a plain-text editable whose mention chips are non-editable spans ---

	function draftLength(parts: DraftPart[]): number {
		return draftText(parts).length;
	}

	/**
	 * Reads the field back into draft parts, and the caret (the selection's
	 * focus) and the selection's other end as positions in the draft text.
	 */
	function readDraft(root: HTMLElement): { parts: DraftPart[]; caret: number | undefined; anchor: number | undefined } {
		const selection = document.getSelection();
		const selected = selection !== null && selection.rangeCount > 0;
		const focusNode = selected ? selection.focusNode : null;
		const focusOffset = selection?.focusOffset ?? 0;
		const anchorNode = selected ? selection.anchorNode : null;
		const anchorOffset = selection?.anchorOffset ?? 0;
		const parts: DraftPart[] = [];
		let length = 0;
		let caret: number | undefined;
		let anchor: number | undefined;
		const text = (chunk: string) => {
			parts.push(chunk);
			length += chunk.length;
		};
		const walk = (node: Node) => {
			node.childNodes.forEach((child, index) => {
				if (node === focusNode && index === focusOffset) caret = length;
				if (node === anchorNode && index === anchorOffset) anchor = length;
				if (child.nodeType === Node.TEXT_NODE) {
					if (child === focusNode) caret = length + focusOffset;
					if (child === anchorNode) anchor = length + anchorOffset;
					text(child.textContent ?? '');
				} else if (child instanceof HTMLElement) {
					if (child.dataset.userId) {
						parts.push({ id: child.dataset.userId });
						length += child.dataset.userId.length + 1;
					} else if (child.dataset.roomId) {
						parts.push({ id: child.dataset.roomId, room: true });
						length += child.dataset.roomId.length + 1;
					} else if (child.tagName === 'BR') {
						// A break that ends its block is the browser's placeholder for an empty line, not a line.
						if (index < node.childNodes.length - 1) text('\n');
					} else {
						if (/^(DIV|P)$/.test(child.tagName) && length > 0 && !draftText(parts).endsWith('\n')) text('\n');
						walk(child);
					}
				}
			});
			if (node === focusNode && focusOffset >= node.childNodes.length && caret === undefined) caret = length;
			if (node === anchorNode && anchorOffset >= node.childNodes.length && anchor === undefined) anchor = length;
		};
		walk(root);
		return { parts: normalizeDraft(parts), caret, anchor };
	}

	/** What a chip names, as the Mention component every rendered mention uses. */
	function chipMention(part: DraftChip): Mention {
		if (part.room) return { target: { kind: 'room', id: part.id, title: directory.resolveRoom(part.id)?.title ?? part.id }, hash: true };
		const person = people.find((entry) => entry.id === part.id) ?? directory.person({ user_id: part.id });
		return { target: { kind: 'user', id: part.id, name: person?.name?.trim() || part.id, me: directory.isMe(part.id) }, hash: false };
	}

	/** A chip: the Mention component as a non-editable span, its ID on hover. */
	function chip(part: DraftChip): HTMLSpanElement {
		const mention = chipMention(part);
		const label = mentionLabel(mention);
		const element = document.createElement('span');
		element.className = mentionClass(mention);
		element.contentEditable = 'false';
		if (part.room) element.dataset.roomId = part.id;
		else element.dataset.userId = part.id;
		if (label !== draftText([part])) element.title = draftText([part]);
		element.textContent = label;
		return element;
	}

	/** Redraws the field from draft parts; with a caret, puts the selection there. */
	function draw(root: HTMLElement, parts: DraftPart[], caret: number | undefined): void {
		const nodes: Node[] = parts.map((part) => (typeof part === 'string' ? document.createTextNode(part) : chip(part)));
		// A trailing line break needs a placeholder to show the empty line.
		if (draftText(parts).endsWith('\n')) nodes.push(document.createElement('br'));
		root.replaceChildren(...nodes);
		if (caret !== undefined) placeCaret(root, caret);
	}

	/** Puts the caret at a draft-text position; a position inside a chip lands after it. */
	function placeCaret(root: HTMLElement, caret: number): void {
		const selection = document.getSelection();
		if (!selection) return;
		const range = document.createRange();
		let offset = 0;
		let placed = false;
		for (const [index, node] of [...root.childNodes].entries()) {
			const length = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : node instanceof HTMLElement && (node.dataset.userId ?? node.dataset.roomId) ? (node.dataset.userId ?? node.dataset.roomId)!.length + 1 : 0;
			if (node.nodeType === Node.TEXT_NODE && caret <= offset + length) {
				range.setStart(node, caret - offset);
				placed = true;
				break;
			}
			if (caret < offset + length) {
				range.setStart(root, index + 1);
				placed = true;
				break;
			}
			offset += length;
		}
		if (!placed) {
			const last = root.lastChild;
			range.setStart(root, last instanceof HTMLBRElement ? root.childNodes.length - 1 : root.childNodes.length);
		}
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	/** Publishes what the field shows as the draft. */
	function commit(root: HTMLDivElement, parts: DraftPart[], typed: boolean): void {
		const text = draftText(parts);
		shown = { field: root, text };
		empty = parts.length === 0;
		const mentioned = draftMentions(parts);
		if (mentioned.join('\u0000') !== mentions.join('\u0000')) mentions = mentioned;
		if (empty && root.childNodes.length > 0) root.replaceChildren();
		if (value !== text) value = text;
		if (typed) oninput();
	}

	/** Chips finished mentions; `final` when sending, so one at the very end counts too. */
	function collapse(final: boolean): void {
		if (!field) return;
		const { parts, caret } = readDraft(field);
		const collapsed = collapseMentions(parts, people, { caret: caret ?? draftLength(parts), final, isUser, rooms: roomIds });
		if (collapsed.changed) draw(field, collapsed.parts, caret === undefined ? undefined : collapsed.caret);
		commit(field, collapsed.parts, collapsed.changed || draftText(collapsed.parts) !== value);
	}

	/** Closes whichever picker is open. */
	function closeCompletions(): void {
		query = undefined;
		emojiFound = undefined;
		roomFound = undefined;
	}

	function send(): void {
		closeCompletions();
		dismissedAutocomplete = undefined;
		collapse(true);
		onsend();
	}

	function dismissAutocomplete(): void {
		if (field) {
			const { parts, caret } = readDraft(field);
			dismissedAutocomplete = { text: draftText(parts), caret: caret ?? draftLength(parts) };
		}
		closeCompletions();
	}

	function keydown(event: KeyboardEvent): void {
		if (completion && !event.isComposing) {
			if (event.key === 'Escape') {
				event.preventDefault();
				dismissAutocomplete();
				return;
			}
			if (completion.count > 0) {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					const step = event.key === 'ArrowDown' ? 1 : completion.count - 1;
					active = (activeIndex + step) % completion.count;
					return;
				}
				if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && completion.enter)) {
					event.preventDefault();
					completion.take(activeIndex);
					return;
				}
			}
		}
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			if (event.shiftKey) document.execCommand('insertText', false, '\n');
			else send();
		}
	}

	/**
	 * Backspace against a chip turns it back into the text it showed, to edit.
	 * Handled as the delete it asks for rather than the key, since phone
	 * keyboards often send no Backspace keydown.
	 */
	function beforeinput(event: InputEvent): void {
		if (event.inputType === 'deleteContentBackward' && !event.isComposing && backspaceChip()) event.preventDefault();
	}

	/** Reverts the chip right before a bare caret; false when there's none. */
	function backspaceChip(): boolean {
		if (!field) return false;
		const { parts, caret, anchor } = readDraft(field);
		if (caret === undefined || (anchor !== undefined && anchor !== caret)) return false;
		const reverted = unchip(parts, caret, (part) => mentionLabel(chipMention(part)));
		if (!reverted) return false;
		draw(field, reverted.parts, reverted.caret);
		commit(field, reverted.parts, true);
		refreshQuery();
		return true;
	}

	/** Reads the `@`, `#`, or `:` token at the caret; anything else closes its picker. */
	function refreshQuery(): void {
		if (!field || disabled || document.activeElement !== field) {
			closeCompletions();
			dismissedAutocomplete = undefined;
			return;
		}
		const { parts, caret } = readDraft(field);
		const text = draftText(parts);
		const position = caret ?? draftLength(parts);
		if (isAutocompleteDismissed(dismissedAutocomplete, text, position)) {
			closeCompletions();
			return;
		}
		dismissedAutocomplete = undefined;
		const foundEmoji = caret === undefined ? undefined : findEmojiQuery(parts, caret);
		if (foundEmoji) {
			if (emojiFound?.start !== foundEmoji.start) active = 0;
			closeCompletions();
			emojiFound = foundEmoji;
			void loadEmojiData().then((data) => { emojiData = data; }).catch(() => { emojiFound = undefined; });
			return;
		}
		emojiFound = undefined;
		const foundRoom = caret === undefined ? undefined : findRoomQuery(parts, caret);
		if (foundRoom) {
			if (roomFound?.start !== foundRoom.start) active = 0;
			closeCompletions();
			roomFound = foundRoom;
			return;
		}
		roomFound = undefined;
		const found = caret === undefined ? undefined : mentionQuery(parts, caret);
		// A query with a space stays open only while it still names someone.
		if (!found || (/\s/.test(found.query) && matching(found.query).length === 0)) {
			query = undefined;
			return;
		}
		if (query === undefined) {
			active = 0;
			onmention?.();
		}
		anchor = found.start;
		query = found.query;
	}

	/** Swaps the typed `@…` for a chip: the person's name on screen, `@user_id` on the wire (Appendix A.3). */
	function pick(person: MentionPerson): void {
		if (!field) return;
		const { parts, caret } = readDraft(field);
		const end = caret ?? draftLength(parts);
		const inserted = insertMention(parts, anchor, end, person.id);
		closeCompletions();
		dismissedAutocomplete = undefined;
		active = 0;
		field.focus();
		draw(field, inserted.parts, inserted.caret);
		commit(field, inserted.parts, true);
	}

	function pickRoom(room: RoomSuggestion): void {
		if (!field || !roomFound) return;
		const { parts } = readDraft(field);
		const inserted = insertMention(parts, roomFound.start, roomFound.end, room.id, true);
		closeCompletions();
		dismissedAutocomplete = undefined;
		active = 0;
		field.focus();
		draw(field, inserted.parts, inserted.caret);
		commit(field, inserted.parts, true);
	}

	function pickEmoji(item: EmojiSuggestion): void {
		if (!field || !emojiFound) return;
		const { parts } = readDraft(field);
		const inserted = insertText(parts, emojiFound.start, emojiFound.end, item.native);
		closeCompletions();
		dismissedAutocomplete = undefined;
		active = 0;
		field.focus();
		draw(field, inserted.parts, inserted.caret);
		commit(field, inserted.parts, true);
	}

	function input(event: Event): void {
		if (!field) return;
		if ((event as InputEvent).isComposing) {
			commit(field, readDraft(field).parts, true);
			return;
		}
		collapse(false);
		refreshQuery();
	}

	/** Leaving the field (for the emoji button, say) remembers the selection, since the picker takes focus. */
	function blur(): void {
		closeCompletions();
		dismissedAutocomplete = undefined;
		if (!field) return;
		const { caret, anchor } = readDraft(field);
		lastSelection = caret === undefined ? undefined : { start: Math.min(caret, anchor ?? caret), end: Math.max(caret, anchor ?? caret) };
	}

	/** The emoji button: the full picker, whose pick lands where the caret was. Emoji are text, so no capability gates it. */
	function openEmoji(): void {
		if (emojiButton) emojiPicker.toggle({ anchor: emojiButton, onpick: insertEmoji });
	}

	/** Puts a picked emoji at the caret, over any selection, and the caret after it, as typing it would. */
	function insertEmoji(emoji: string): void {
		if (!field || disabled) return;
		const { parts } = readDraft(field);
		const end = draftLength(parts);
		const inserted = insertText(parts, lastSelection?.start ?? end, lastSelection?.end ?? end, emoji);
		lastSelection = undefined;
		field.focus();
		draw(field, inserted.parts, inserted.caret);
		collapse(false);
		refreshQuery();
	}

	/** Drops a link's preview from this draft; typing carries on in the field. */
	function dismissPreview(url: string): void {
		dismissed = [...dismissed, url];
		focus();
	}

	/**
	 * A pasted image (or file) is attached like a picked one. Pasted text wins
	 * when there is some: office apps put a picture of the selection beside it.
	 */
	function paste(event: ClipboardEvent): void {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		const files = [...(event.clipboardData?.items ?? [])].flatMap((item) => (item.kind === 'file' ? [item.getAsFile()].filter((file): file is File => file !== null) : []));
		if (canUpload && !disabled && !recording && files.length && !text.trim()) {
			event.preventDefault();
			onfiles(files);
			return;
		}
		void linkPreviews.prefetch(text);
	}

	function attach(input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length) onfiles(files);
	}

	/** Microphone: record, then hand the clip over as an audio file. */
	async function startRecording(): Promise<void> {
		if (disabled || !canRecord || recorder) return;
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			return;
		}
		const chunks: Blob[] = [];
		const current = new MediaRecorder(stream);
		recorder = current;
		recordSeconds = 0;
		recordTimer = setInterval(() => (recordSeconds = (recordSeconds ?? 0) + 1), 1000);
		current.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
		current.onstop = () => {
			for (const track of stream.getTracks()) track.stop();
			if (recorder !== current) return;
			const seconds = recordSeconds ?? 0;
			clearRecording();
			if (chunks.length === 0 || seconds < 1) return;
			const type = current.mimeType || chunks[0].type || 'audio/webm';
			onfiles([new File(chunks, `voice-message.${type.includes('ogg') ? 'ogg' : 'webm'}`, { type })]);
		};
		current.start();
	}

	function stopRecording(send = true): void {
		const current = recorder;
		if (!current) return;
		if (!send) clearRecording();
		current.stop();
	}

	function clearRecording(): void {
		recorder = undefined;
		if (recordTimer) clearInterval(recordTimer);
		recordTimer = undefined;
		recordSeconds = undefined;
	}
</script>

{#if reply}
	<div class="reply-draft" data-testid="reply-draft" role="status">
		<span>Replying to {#if reply.name}{reply.name}: <MentionText text={reply.text} />{:else}{reply.text}{/if}</span>
		<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Cancel reply" onclick={oncancelreply}>Cancel reply</button>
	</div>
{/if}
{#if previews.length > 0}
	<div class="previews" data-testid="link-previews" aria-label="Link previews to send">
		{#each previews as embed (embed.url)}
			<div class="embed-slot">
				<Embed {embed} />
				<EmbedRemove label="Remove preview" onremove={() => dismissPreview(embed.url ?? '')} />
			</div>
		{/each}
	</div>
{/if}
<div class="wrap">
	{#if pickerOpen}
		<AutocompletePicker
			id={pickerId}
			items={matches}
			active={activeIndex}
			label="Mention someone"
			testid="mention-picker"
			emptyText={query ? `No one here matches “${query}”` : 'People in this room'}
			getKey={(person) => person.id}
			onpick={pick}
			onhover={(index) => (active = index)}
		>
			{#snippet row(person)}
				{@const label = person.name?.trim() || person.id}
				{@const name = mark(label)}
				{@const id = mark(person.id)}
				<Avatar name={label} id={person.id} src={person.avatar} size="sm" />
				<span class="ap-mpick-name">{name.before}{#if name.hit}<mark class="ap-mpick-hit">{name.hit}</mark>{/if}{name.after}</span>
				{#if person.id !== label}
					<span class="ap-mpick-id">@{id.before}{#if id.hit}<mark class="ap-mpick-hit">{id.hit}</mark>{/if}{id.after}</span>
				{/if}
			{/snippet}
		</AutocompletePicker>
	{:else if roomPickerOpen}
		<AutocompletePicker
			id={pickerId}
			items={roomMatches}
			active={activeIndex}
			label="Room suggestions"
			testid="room-autocomplete"
			emptyText={`No room matches “${roomFound?.query ?? ''}”`}
			getKey={(room) => room.id}
			onpick={pickRoom}
			onhover={(index) => (active = index)}
		>
			{#snippet row(room)}
				<span class="ap-mpick-name">{room.title}</span>
				<span class="ap-mpick-id">#{room.id}</span>
			{/snippet}
		</AutocompletePicker>
	{:else if emojiPickerOpen}
		<AutocompletePicker
			id={pickerId}
			items={emojiMatches}
			active={activeIndex}
			label="Emoji suggestions"
			testid="emoji-autocomplete"
			emptyText={`No emoji match “${emojiFound?.query ?? ''}”`}
			getKey={(item) => item.id}
			onpick={pickEmoji}
			onhover={(index) => (active = index)}
		>
			{#snippet row(item)}
				<span class="ap-mpick-emoji-glyph" aria-hidden="true">{item.native}</span>
				<span class="ap-mpick-name">:{item.id}:</span>
				<span class="ap-mpick-id">{item.name}</span>
			{/snippet}
		</AutocompletePicker>
	{/if}
	<form class="ap-composer" class:ap-composer-disabled={disabled} class:ap-composer-cmd={command} aria-label="Send a message" onsubmit={(event) => { event.preventDefault(); send(); }}>
		{#if canUpload}
			<span class="ap-composer-tools">
				<button class="ap-iconbtn" type="button" aria-label="Attach a file" title="Attach a file" disabled={disabled || recording} onclick={() => attachInput?.click()}>
					<Paperclip size={18} aria-hidden="true" />
				</button>
				{#if canRecord}
					<button class="ap-iconbtn" class:ap-iconbtn-rec={recording} type="button" aria-label={recording ? 'Stop recording' : 'Record a voice message'} aria-pressed={recording} title={recording ? 'Stop recording' : 'Record a voice message'} {disabled} onclick={() => (recording ? stopRecording() : startRecording())}>
						{#if recording}
							<Square size={12} fill="currentColor" stroke="currentColor" strokeWidth={0} aria-hidden="true" />
						{:else}
							<Mic size={18} aria-hidden="true" />
						{/if}
					</button>
				{/if}
			</span>
			<input class="sr" type="file" multiple tabindex="-1" aria-hidden="true" data-testid="attach-input" bind:this={attachInput} onchange={(event) => attach(event.currentTarget)} />
		{/if}
		{#if recordSeconds !== undefined}
			<span class="ap-composer-recording" role="status"><span class="ap-composer-recdot" aria-hidden="true"></span>Recording <span class="ap-composer-rectime">{clockLabel(recordSeconds)}</span></span>
		{:else}
			{#if command}<span class="ap-composer-cmdtag" data-testid="command-tag" title="Sent to the server, not posted">Command</span>{/if}
			<div
				class="ap-composer-field field"
				class:field-empty={empty}
				id="message-input"
				data-testid="message-input"
				role="textbox"
				aria-label="Message"
				aria-multiline="true"
				aria-placeholder={placeholder}
				aria-disabled={disabled}
				aria-autocomplete="list"
				aria-controls={completion ? pickerId : undefined}
				aria-activedescendant={completion?.count ? `${pickerId}-${activeIndex}` : undefined}
				data-placeholder={placeholder}
				tabindex={disabled ? -1 : 0}
				contenteditable={disabled ? 'false' : 'plaintext-only'}
				spellcheck="true"
				bind:this={field}
				onbeforeinput={beforeinput}
				oninput={input}
				oncompositionend={() => collapse(false)}
				onkeydown={keydown}
				onkeyup={refreshQuery}
				onclick={refreshQuery}
				onblur={blur}
				onpaste={paste}
			></div>
		{/if}
		<span class="ap-composer-tools">
			<button
				class="ap-iconbtn emoji"
				type="button"
				data-testid="emoji-button"
				aria-label="Insert emoji"
				title="Insert emoji"
				aria-haspopup="dialog"
				aria-expanded={emojiOpen}
				disabled={disabled || recording}
				bind:this={emojiButton}
				use:emojiAnchor
				onclick={openEmoji}
			>
				<Smile size={18} aria-hidden="true" />
			</button>
		</span>
		<button class="ap-btn ap-btn-primary ap-btn-sm" data-testid="send-button" type="submit" aria-label={command ? 'Run command' : 'Send message'} disabled={disabled || recording || !value.trim()}>{command ? 'Run' : 'Send'}</button>
	</form>
</div>

<style>
	/* The autocomplete picker anchors to the composer and grows upward. */
	.wrap { position: relative; }
	.reply-draft { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-4); font-size: 13px; line-height: 18px; color: var(--ink-muted); }
	/* Previews of the draft's links, above the field; each can be removed before sending. */
	.previews { display: flex; gap: var(--space-3); overflow-x: auto; padding: var(--space-3) var(--space-4) var(--space-2); }
	.embed-slot { position: relative; flex: 0 1 320px; min-width: 0; }
	.embed-slot :global(.ap-embed) { width: 100%; min-width: 0; }
	.reply-draft span { min-width: 0; overflow-wrap: anywhere; }
	/* The field is an editable div so mentions can be chips; it sizes like the design system's textarea. */
	.field { height: auto; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; }
	.field-empty::before { content: attr(data-placeholder); color: var(--ink-muted); pointer-events: none; }
	.field :global(.ap-mention) { white-space: nowrap; cursor: default; user-select: all; }
	/* The emoji button reads as pressed while its picker is open. */
	.emoji[aria-expanded='true'] { background: var(--bg-300); color: var(--ink); }
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
