import { untrack } from 'svelte';
import { mentionClass, mentionLabel, type Mention, type MentionPerson } from '$lib/protocol/markdown';
import { collapseMentions, draftLength, draftMentions, draftText, insertMention, insertText, mentionQuery, normalizeDraft, unchip, type DraftChip, type DraftPart } from './draft';
import { isAutocompleteDismissed, type DismissedAutocomplete } from './autocomplete-dismiss';
import { emojiQuery as findEmojiQuery, searchEmoji, withCustomEmoji, type EmojiQuery, type EmojiSuggestion } from './emoji-autocomplete';
import { customEmoji } from './custom-emoji.svelte';
import { roomQuery as findRoomQuery, searchRooms, type RoomQuery, type RoomSuggestion } from './room-autocomplete';
import type { EmojiMartData } from '@emoji-mart/data';
import { loadEmojiData } from './emoji-picker.svelte';
import { directory } from './directory.svelte';
import { enterAction, handheld } from './handheld';

/**
 * Where a message is written, the composer's and the message editor's
 * alike: a plain-text editable (`ComposerEditable`) whose mentions are
 * non-editable name chips, `@user_id` in the text (Appendix A.3), and the
 * autocomplete for `@` people, `#` rooms and `:` emoji. One of these per
 * field, made as its component starts; `DraftEditable` and `DraftPicker`
 * draw the field and the picker from it.
 */

const MENTION_MATCHES_MAX = 8;

/** How the field's component takes part. */
export interface DraftHost {
	/** The draft as sent; set as it is typed, and drawn with its mentions as chips when set from outside. */
	value: string;
	/** The `user_id`s the draft mentions, for `body.mentions` (§3.5): one per chip. */
	mentions: string[];
	/** Who an `@` can name. */
	readonly people: MentionPerson[];
	/** Rooms and threads a `#` can name. */
	readonly rooms: RoomSuggestion[];
	readonly disabled: boolean;
	/** Enter where it sends (or saves): `enterAction`, with no picker taking it. */
	submit(): void;
	/** The draft changed by typing or a pick, not set from outside. */
	oninput?(): void;
	/** The mention picker opened: a moment to refresh who can be named. */
	onmention?(): void;
}

export class DraftField {
	private readonly host: DraftHost;
	/** The open picker's ID, which the field names in `aria-controls`; `DraftPicker` gives it to the picker. */
	readonly pickerId: string;
	/** The field; `bind:element` on its `ComposerEditable`. */
	element = $state<HTMLDivElement | undefined>();
	/** Nothing is in the field: its placeholder shows. */
	empty = $state(true);
	/** The text after `@` at the caret, or undefined when the picker is closed. */
	query = $state<string | undefined>();
	/** The `:shortcode` or `#room` at the caret, while its picker is open. */
	emojiFound = $state<EmojiQuery | undefined>();
	roomFound = $state<RoomQuery | undefined>();
	private dismissedAutocomplete = $state<DismissedAutocomplete | undefined>();
	private emojiData = $state.raw<EmojiMartData | undefined>();
	private active = $state(0);
	/** Where the `@` being completed starts, in the draft text. */
	private anchor = 0;
	/** The draft text the field shows, and the field showing it. */
	private shown: { field: HTMLElement; text: string } | undefined;
	/** The selection in the draft text when the field last lost focus: where a picked emoji or a mention goes. */
	private lastSelection: { start: number; end: number } | undefined;
	/** A phone or tablet, where Enter starts a new line (`enterAction`). */
	private readonly onHandheld = handheld();

	matches: MentionPerson[];
	/** The server's custom emoji first (`ext:emoji`, once their catalog has arrived), then the standard ones. */
	emojiMatches: EmojiSuggestion[];
	/** The IDs a typed `#room_id` collapses into a chip for. */
	private roomIds: string[];
	roomMatches: RoomSuggestion[];
	pickerOpen: boolean;
	roomPickerOpen: boolean;
	/** Opens once the emoji data has loaded, rather than showing "no match" meanwhile. */
	emojiPickerOpen: boolean;
	/**
	 * The open picker (at most one is): how many suggestions it has, how to
	 * take one, and whether Enter does (Tab always does). A bare `#` lists
	 * rooms to browse, but Enter there still sends or breaks the line.
	 */
	private completion: { count: number; take: (index: number) => void; enter: boolean } | undefined;
	activeIndex: number;
	/** The field's autocomplete attributes, naming the open picker. */
	aria: { 'aria-autocomplete': 'list'; 'aria-controls': string | undefined; 'aria-activedescendant': string | undefined };

	/** Made as the field's component starts: it draws a draft set from outside (a saved draft, a cleared field) with its mentions as chips. */
	constructor(host: DraftHost, pickerId: string) {
		this.host = host;
		this.pickerId = pickerId;
		this.matches = $derived(this.query === undefined ? [] : this.matching(this.query));
		this.emojiMatches = $derived(this.emojiFound && this.emojiData ? withCustomEmoji(customEmoji.catalog, this.emojiFound.query, searchEmoji(this.emojiData, this.emojiFound.query), (emoji) => customEmoji.image(emoji).src) : []);
		this.roomIds = $derived(host.rooms.map((room) => room.id));
		this.roomMatches = $derived(this.roomFound ? searchRooms(host.rooms, this.roomFound.query) : []);
		this.pickerOpen = $derived(this.query !== undefined && !host.disabled);
		this.roomPickerOpen = $derived(this.roomFound !== undefined && !host.disabled);
		this.emojiPickerOpen = $derived(this.emojiFound !== undefined && this.emojiData !== undefined && !host.disabled);
		this.completion = $derived.by(() => {
			if (this.pickerOpen) return { count: this.matches.length, take: (index: number) => this.pick(this.matches[index]), enter: true };
			if (this.roomPickerOpen) return { count: this.roomMatches.length, take: (index: number) => this.pickRoom(this.roomMatches[index]), enter: this.roomFound?.query !== '' };
			if (this.emojiPickerOpen) return { count: this.emojiMatches.length, take: (index: number) => this.pickEmoji(this.emojiMatches[index]), enter: true };
			return undefined;
		});
		this.activeIndex = $derived(Math.min(this.active, Math.max(0, (this.completion?.count ?? 0) - 1)));
		this.aria = $derived({
			'aria-autocomplete': 'list' as const,
			'aria-controls': this.completion ? pickerId : undefined,
			'aria-activedescendant': this.completion?.count ? `${pickerId}-${this.activeIndex}` : undefined
		});
		$effect(() => {
			const current = this.element;
			const text = this.host.value;
			if (!current || (this.shown?.field === current && this.shown.text === text)) return;
			untrack(() => {
				this.lastSelection = undefined;
				const collapsed = collapseMentions([text], this.host.people, { caret: text.length, isUser, rooms: this.roomIds });
				this.draw(current, collapsed.parts, document.activeElement === current ? collapsed.caret : undefined);
				this.commit(current, collapsed.parts, false);
			});
		});
	}

	/** Hovering a suggestion makes it the active one. */
	hover(index: number): void {
		this.active = index;
	}

	/** Focuses the field, the caret at the end unless it is already in there (or, with `end`, wherever it is). */
	focus(end = false): void {
		const field = this.element;
		if (!field) return;
		field.focus();
		const selection = document.getSelection();
		if (end || !selection || !field.contains(selection.anchorNode)) placeCaret(field, draftLength(readDraft(field).parts));
	}

	/** Puts a mention chip for this user where the caret was (else at the end), as picking them would, and focuses the field. */
	mention(userId: string): void {
		const field = this.element;
		if (!field || this.host.disabled) return;
		const { parts } = readDraft(field);
		const end = draftLength(parts);
		const inserted = insertMention(parts, this.lastSelection?.start ?? end, this.lastSelection?.end ?? end, userId);
		this.lastSelection = undefined;
		this.closeCompletions();
		field.focus();
		this.draw(field, inserted.parts, inserted.caret);
		this.commit(field, inserted.parts, true);
	}

	/** Puts text (a picked emoji) where the caret was, over any selection, and the caret after it, as typing it would. */
	insert(text: string): void {
		const field = this.element;
		if (!field || this.host.disabled) return;
		const { parts } = readDraft(field);
		const end = draftLength(parts);
		const inserted = insertText(parts, this.lastSelection?.start ?? end, this.lastSelection?.end ?? end, text);
		this.lastSelection = undefined;
		field.focus();
		this.draw(field, inserted.parts, inserted.caret);
		this.collapse(false);
		this.refreshQuery();
	}

	/** Closes the picker and forgets where the caret was: the field is changing under it. */
	reset(): void {
		this.closeCompletions();
		this.dismissedAutocomplete = undefined;
		this.lastSelection = undefined;
	}

	/** Before the draft goes (sent or saved): the picker closes and finished mentions become chips, one at the very end too. */
	finish(): void {
		this.closeCompletions();
		this.dismissedAutocomplete = undefined;
		this.collapse(true);
	}

	// --- The field's handlers, named rather than arrows in its markup: the field keeps one listener as its attributes change while typing ---

	keydown = (event: KeyboardEvent): void => {
		const completion = this.completion;
		if (completion && !event.isComposing) {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.dismissAutocomplete();
				return;
			}
			if (completion.count > 0) {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					const step = event.key === 'ArrowDown' ? 1 : completion.count - 1;
					this.active = (this.activeIndex + step) % completion.count;
					return;
				}
				if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && completion.enter)) {
					event.preventDefault();
					completion.take(this.activeIndex);
					return;
				}
			}
		}
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			if (enterAction(event, this.onHandheld) === 'newline') document.execCommand('insertText', false, '\n');
			else this.host.submit();
		}
	};

	/**
	 * Backspace against a chip turns it back into the text it showed, to edit.
	 * Handled as the delete it asks for rather than the key, since phone
	 * keyboards often send no Backspace keydown.
	 */
	beforeinput = (event: InputEvent): void => {
		if (event.inputType === 'deleteContentBackward' && !event.isComposing && this.backspaceChip()) event.preventDefault();
	};

	input = (event: Event): void => {
		const field = this.element;
		if (!field) return;
		if ((event as InputEvent).isComposing) {
			this.commit(field, readDraft(field).parts, true);
			return;
		}
		this.collapse(false);
		this.refreshQuery();
	};

	compositionend = (): void => {
		this.collapse(false);
	};

	/** Leaving the field (for the emoji button, say) remembers the selection, since the picker takes focus. */
	blur = (): void => {
		this.closeCompletions();
		this.dismissedAutocomplete = undefined;
		const field = this.element;
		if (!field) return;
		const { caret, anchor } = readDraft(field);
		this.lastSelection = caret === undefined ? undefined : { start: Math.min(caret, anchor ?? caret), end: Math.max(caret, anchor ?? caret) };
	};

	/** Reads the `@`, `#`, or `:` token at the caret; anything else closes its picker. */
	refreshQuery = (): void => {
		const field = this.element;
		if (!field || this.host.disabled || document.activeElement !== field) {
			this.closeCompletions();
			this.dismissedAutocomplete = undefined;
			return;
		}
		const { parts, caret } = readDraft(field);
		const text = draftText(parts);
		const position = caret ?? draftLength(parts);
		if (isAutocompleteDismissed(this.dismissedAutocomplete, text, position)) {
			this.closeCompletions();
			return;
		}
		this.dismissedAutocomplete = undefined;
		const foundEmoji = caret === undefined ? undefined : findEmojiQuery(parts, caret);
		if (foundEmoji) {
			if (this.emojiFound?.start !== foundEmoji.start) this.active = 0;
			this.closeCompletions();
			this.emojiFound = foundEmoji;
			customEmoji.need();
			void loadEmojiData().then((data) => { this.emojiData = data; }).catch(() => { this.emojiFound = undefined; });
			return;
		}
		this.emojiFound = undefined;
		const foundRoom = caret === undefined ? undefined : findRoomQuery(parts, caret);
		if (foundRoom) {
			if (this.roomFound?.start !== foundRoom.start) this.active = 0;
			this.closeCompletions();
			this.roomFound = foundRoom;
			return;
		}
		this.roomFound = undefined;
		const found = caret === undefined ? undefined : mentionQuery(parts, caret);
		// A query with a space stays open only while it still names someone.
		if (!found || (/\s/.test(found.query) && this.matching(found.query).length === 0)) {
			this.query = undefined;
			return;
		}
		if (this.query === undefined) {
			this.active = 0;
			this.host.onmention?.();
		}
		this.anchor = found.start;
		this.query = found.query;
	};

	/** Swaps the typed `@…` for a chip: the person's name on screen, `@user_id` on the wire (Appendix A.3). */
	pick(person: MentionPerson): void {
		const field = this.element;
		if (!field) return;
		const { parts, caret } = readDraft(field);
		this.picked(field, insertMention(parts, this.anchor, caret ?? draftLength(parts), person.id));
	}

	pickRoom(room: RoomSuggestion): void {
		const field = this.element;
		if (!field || !this.roomFound) return;
		this.picked(field, insertMention(readDraft(field).parts, this.roomFound.start, this.roomFound.end, room.id, true));
	}

	pickEmoji(item: EmojiSuggestion): void {
		const field = this.element;
		if (!field || !this.emojiFound) return;
		this.picked(field, insertText(readDraft(field).parts, this.emojiFound.start, this.emojiFound.end, item.native));
	}

	private picked(field: HTMLElement, inserted: { parts: DraftPart[]; caret: number }): void {
		this.closeCompletions();
		this.dismissedAutocomplete = undefined;
		this.active = 0;
		field.focus();
		this.draw(field, inserted.parts, inserted.caret);
		this.commit(field, inserted.parts, true);
	}

	/** People whose name or ID starts with the query; someone it names exactly comes first. */
	private matching(text: string): MentionPerson[] {
		const lower = text.toLowerCase();
		const exact = lower.trimEnd();
		const scored = this.host.people
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

	/** Closes whichever picker is open. */
	private closeCompletions(): void {
		this.query = undefined;
		this.emojiFound = undefined;
		this.roomFound = undefined;
	}

	private dismissAutocomplete(): void {
		const field = this.element;
		if (field) {
			const { parts, caret } = readDraft(field);
			this.dismissedAutocomplete = { text: draftText(parts), caret: caret ?? draftLength(parts) };
		}
		this.closeCompletions();
	}

	/** Reverts the chip right before a bare caret; false when there's none. */
	private backspaceChip(): boolean {
		const field = this.element;
		if (!field) return false;
		const { parts, caret, anchor } = readDraft(field);
		if (caret === undefined || (anchor !== undefined && anchor !== caret)) return false;
		const reverted = unchip(parts, caret, (part) => mentionLabel(this.chipMention(part)));
		if (!reverted) return false;
		this.draw(field, reverted.parts, reverted.caret);
		this.commit(field, reverted.parts, true);
		this.refreshQuery();
		return true;
	}

	/** Chips finished mentions; `final` when sending, so one at the very end counts too. */
	private collapse(final: boolean): void {
		const field = this.element;
		if (!field) return;
		const { parts, caret } = readDraft(field);
		const collapsed = collapseMentions(parts, this.host.people, { caret: caret ?? draftLength(parts), final, isUser, rooms: this.roomIds });
		if (collapsed.changed) this.draw(field, collapsed.parts, caret === undefined ? undefined : collapsed.caret);
		this.commit(field, collapsed.parts, collapsed.changed || draftText(collapsed.parts) !== this.host.value);
	}

	/** Publishes what the field shows as the draft. */
	private commit(root: HTMLElement, parts: DraftPart[], typed: boolean): void {
		const text = draftText(parts);
		this.shown = { field: root, text };
		this.empty = parts.length === 0;
		const mentioned = draftMentions(parts);
		if (mentioned.join('\u0000') !== this.host.mentions.join('\u0000')) this.host.mentions = mentioned;
		if (this.empty && root.childNodes.length > 0) root.replaceChildren();
		if (this.host.value !== text) this.host.value = text;
		if (typed) this.host.oninput?.();
	}

	/** Redraws the field from draft parts; with a caret, puts the selection there. */
	private draw(root: HTMLElement, parts: DraftPart[], caret: number | undefined): void {
		const nodes: Node[] = parts.map((part) => (typeof part === 'string' ? document.createTextNode(part) : this.chip(part)));
		// A trailing line break needs a placeholder to show the empty line.
		if (draftText(parts).endsWith('\n')) nodes.push(document.createElement('br'));
		root.replaceChildren(...nodes);
		if (caret !== undefined) placeCaret(root, caret);
	}

	/** What a chip names, as the Mention component every rendered mention uses. */
	private chipMention(part: DraftChip): Mention {
		if (part.room) return { target: directory.resolveRoom(part.id) ?? { kind: 'room', id: part.id, title: part.id }, hash: true };
		const person = this.host.people.find((entry) => entry.id === part.id) ?? directory.person({ user_id: part.id });
		const target: Mention['target'] = { kind: 'user', id: part.id, name: person?.name?.trim() || part.id, me: directory.isMe(part.id) };
		if (directory.sharesName({ user_id: part.id })) target.shared = true;
		return { target, hash: false };
	}

	/** A chip: the Mention component as a non-editable span, its ID on hover. */
	private chip(part: DraftChip): HTMLSpanElement {
		const mention = this.chipMention(part);
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
}

const isUser = (id: string): boolean => directory.resolve(id)?.kind === 'user';

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
