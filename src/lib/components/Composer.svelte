<script lang="ts">
	import { untrack } from 'svelte';
	import { mentionClass, mentionLabel, type Mention, type MentionPerson } from '$lib/protocol/markdown';
	import { collapseMentions, draftLength, draftMentions, draftText, insertMention, insertText, mentionQuery, normalizeDraft, unchip, type DraftChip, type DraftPart } from '$lib/ui/draft';
	import { isAutocompleteDismissed, type DismissedAutocomplete } from '$lib/ui/autocomplete-dismiss';
	import { emojiQuery as findEmojiQuery, searchEmoji, type EmojiQuery, type EmojiSuggestion } from '$lib/ui/emoji-autocomplete';
	import { roomQuery as findRoomQuery, searchRooms, type RoomQuery, type RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { EmojiMartData } from '@emoji-mart/data';
	import { emojiAnchor, emojiPicker, loadEmojiData } from '$lib/ui/emoji-picker.svelte';
	import { isCommand } from '$lib/ui/commands';
	import { mediaLimit, type MediaTypes } from '$lib/protocol/client';
	import { directory } from '$lib/ui/directory.svelte';
	import { linkPreviews } from '$lib/ui/link-previews';
	import { pastedFiles } from '$lib/ui/file-transfer';
	import { clockLabel } from '$lib/ui/time';
	import { enterAction, handheld } from '$lib/ui/handheld';
	import type { StagedFile as Staged } from '$lib/ui/pane-drafts.svelte';
	import AutocompletePicker from './AutocompletePicker.svelte';
	import MentionText from './MentionText.svelte';
	import Embed from './embeds/Embed.svelte';
	import StagedFile from './StagedFile.svelte';
	import DesignComposer from '$lib/design/components/Composer.svelte';
	import ComposerEditable from '$lib/design/components/ComposerEditable.svelte';
	import type { ComposerField } from '$lib/design/components/types';

	const MENTION_MATCHES_MAX = 8;
	/** How long typing pauses before the draft's links are looked up; a paste looks them up at once. */
	const PREVIEW_TYPING_PAUSE_MS = 800;
	/** Plenty for speech, in Opus or AAC: about 240 KB a minute, so a 5 MB upload holds 20 minutes. */
	const VOICE_BITS_PER_SECOND = 32_000;
	/** What a clip may be recorded as where the server states the types it takes, by preference. */
	const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'];
	/** A clip stops by itself at this share of the server's `max_bytes` for its type, the rest left for its last second. */
	const VOICE_LIMIT_SHARE = 0.95;

	/** The file extension for a recorded clip's type: Safari records MP4, Firefox Ogg, Chrome WebM. */
	function voiceExtension(type: string): string {
		if (type.includes('mp4')) return 'm4a';
		if (type.includes('ogg')) return 'ogg';
		return 'webm';
	}

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
		oncancelreply: () => void;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
		/** Sending waits until then, as the server asked (`retry_after`, epoch milliseconds): Send counts down, and the draft stays. */
		waitUntil?: number;
	}
	let { value = $bindable(), mentions = $bindable([]), dismissed = $bindable([]), placeholder, disabled, holdSend = false, canUpload, files = [], uploadLimits, canCommand = false, people, rooms = [], reply, oninput, onsend, onfiles, onunstage, onrename, oncancelreply, onmention, waitUntil }: Props = $props();

	/** Unique per composer, for the open picker's ID. */
	const uid = $props.id();
	const pickerId = `${uid}-suggestions`;
	let field = $state<HTMLDivElement | undefined>();
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
	let shown: { field: HTMLElement; text: string } | undefined;
	let recordSeconds = $state<number | undefined>();
	let recorder: MediaRecorder | undefined;
	let recordTimer: ReturnType<typeof setInterval> | undefined;

	let recording = $derived(recordSeconds !== undefined);
	/** The file picker's `accept`: the patterns the server takes, unless one is any type. */
	let accept = $derived(uploadLimits && !Object.hasOwn(uploadLimits, '*/*') ? Object.keys(uploadLimits).join(',') : undefined);
	/**
	 * What a voice clip is recorded as, and its `max_bytes`: the browser's own
	 * type without stated limits, else the first of `VOICE_TYPES` that the
	 * browser records and the server takes. Undefined: no voice clips.
	 */
	let voice = $derived.by((): { type?: string; maxBytes?: number } | undefined => {
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
		if (command || disabled || linkPreviews.links(text).length === 0) return;
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


	const isUser = (id: string): boolean => directory.resolve(id)?.kind === 'user';

	export function focus(): void {
		if (!field) return;
		field.focus();
		const selection = document.getSelection();
		if (!selection || !field.contains(selection.anchorNode)) placeCaret(field, draftLength(readDraft(field).parts));
	}

	/** Puts a mention chip for this user where the caret was (else at the end), as picking them would, and focuses the field. */
	export function mention(userId: string): void {
		if (!field || disabled) return;
		const { parts } = readDraft(field);
		const end = draftLength(parts);
		const inserted = insertMention(parts, lastSelection?.start ?? end, lastSelection?.end ?? end, userId);
		lastSelection = undefined;
		closeCompletions();
		field.focus();
		draw(field, inserted.parts, inserted.caret);
		commit(field, inserted.parts, true);
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
	// The emoji picker lets go of its button when the button goes (`emojiAnchor`, as on a message's React).
	$effect(() => (emojiButton ? emojiAnchor(emojiButton) : undefined));

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
		if (part.room) return { target: directory.resolveRoom(part.id) ?? { kind: 'room', id: part.id, title: part.id }, hash: true };
		const person = people.find((entry) => entry.id === part.id) ?? directory.person({ user_id: part.id });
		const target: Mention['target'] = { kind: 'user', id: part.id, name: person?.name?.trim() || part.id, me: directory.isMe(part.id) };
		if (directory.sharesName({ user_id: part.id })) target.shared = true;
		return { target, hash: false };
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
	function commit(root: HTMLElement, parts: DraftPart[], typed: boolean): void {
		const text = draftText(parts);
		shown = { field: root, text };
		empty = parts.length === 0;
		const mentioned = draftMentions(parts);
		if (mentioned.join('\u0000') !== mentions.join('\u0000')) mentions = mentioned;
		if (empty && root.childNodes.length > 0) root.replaceChildren();
		if (value !== text) value = text;
		if (typed) oninput();
	}

	/** A named handler, not an arrow in the field's markup: the field keeps one listener as its attributes change while typing. */
	function compositionEnd(): void {
		collapse(false);
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

	/** A phone or tablet, where Enter starts a new line and Send is the button (`enterAction`). */
	const onHandheld = handheld();

	function send(): void {
		// Enter while sending waits: the draft stays as it is.
		if (holdSend || (waitUntil !== undefined && waitUntil > Date.now())) return;
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
			if (enterAction(event, onHandheld) === 'newline') document.execCommand('insertText', false, '\n');
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
	async function startRecording(): Promise<void> {
		if (disabled || !canRecord || recorder) return;
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			return;
		}
		const chunks: Blob[] = [];
		const { type: mimeType, maxBytes } = voice ?? {};
		const current = new MediaRecorder(stream, { audioBitsPerSecond: VOICE_BITS_PER_SECOND, ...(mimeType ? { mimeType } : {}) });
		recorder = current;
		recordSeconds = 0;
		recordTimer = setInterval(() => (recordSeconds = (recordSeconds ?? 0) + 1), 1000);
		let recorded = 0;
		current.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
			recorded += event.data.size;
			// Under a stated limit, the clip comes in a slice a second, and stops itself short of the limit.
			if (maxBytes !== undefined && recorded >= maxBytes * VOICE_LIMIT_SHARE && current.state === 'recording') current.stop();
		};
		current.onstop = () => {
			for (const track of stream.getTracks()) track.stop();
			if (recorder !== current) return;
			const seconds = recordSeconds ?? 0;
			clearRecording();
			if (chunks.length === 0 || seconds < 1) return;
			const type = current.mimeType || chunks[0].type || 'audio/webm';
			onfiles([new File(chunks, `voice-message.${voiceExtension(type)}`, { type })]);
		};
		current.start(maxBytes === undefined ? undefined : 1000);
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

<!-- The design system's Composer draws the field and what sits above it; this fills in the editing: chips, autocomplete, recording, files and previews. -->
<DesignComposer
	{placeholder}
	{value}
	{disabled}
	canSend={holdSend ? false : undefined}
	{canCommand}
	{canUpload}
	{canRecord}
	{onfiles}
	{accept}
	onrecord={startRecording}
	onstoprecording={() => stopRecording()}
	{recording}
	recordingTime={clockLabel(recordSeconds ?? 0)}
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
	{previews}
	{preview}
	onremovepreview={(index) => dismissPreview(previews[index]?.url ?? '')}
	{picker}
	replyTestid="reply-draft"
	attachmentsTestid="staged-files"
	previewsTestid="link-previews"
	fileInputTestid="attach-input"
	commandTestid="command-tag"
	emojiTestid="emoji-button"
	sendTestid="send-button"
/>

{#snippet editable({ placeholder, disabled }: ComposerField)}
	<ComposerEditable
		{placeholder}
		{disabled}
		{empty}
		bind:element={field}
		id="message-input"
		data-testid="message-input"
		aria-autocomplete="list"
		aria-controls={completion ? pickerId : undefined}
		aria-activedescendant={completion?.count ? `${pickerId}-${activeIndex}` : undefined}
		onbeforeinput={beforeinput}
		oninput={input}
		oncompositionend={compositionEnd}
		onkeydown={keydown}
		onkeyup={refreshQuery}
		onclick={refreshQuery}
		onblur={blur}
		onpaste={paste}
	/>
{/snippet}
{#snippet replyText()}<MentionText text={reply?.text ?? ''} />{/snippet}
{#snippet staged()}
	{#each files as staged (staged.id)}
		<StagedFile {staged} onrename={(title) => onrename(staged.id, title)} onremove={() => { onunstage(staged.id); focus(); }} />
	{/each}
{/snippet}
{#snippet preview(index: number)}<Embed embed={previews[index]} />{/snippet}
{#snippet picker()}
	{#if pickerOpen}
		<AutocompletePicker id={pickerId} query={query ?? ''} people={matches} active={activeIndex} testid="mention-picker" onpick={(index) => pick(matches[index])} onhover={(index) => (active = index)} />
	{:else if roomPickerOpen}
		<AutocompletePicker id={pickerId} query={roomFound?.query ?? ''} rooms={roomMatches} active={activeIndex} onpick={(index) => pickRoom(roomMatches[index])} onhover={(index) => (active = index)} />
	{:else if emojiPickerOpen}
		<AutocompletePicker id={pickerId} query={emojiFound?.query ?? ''} emoji={emojiMatches} active={activeIndex} onpick={(index) => pickEmoji(emojiMatches[index])} onhover={(index) => (active = index)} />
	{/if}
{/snippet}
