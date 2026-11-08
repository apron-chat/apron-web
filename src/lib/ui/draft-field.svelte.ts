import { untrack } from 'svelte';
import { mentionClass, mentionLabel, type Mention, type MentionPerson } from '$lib/protocol/markdown';
import { chipTasks, chipText, collapseMentions, deleteAtTask, draftLength, draftMentions, draftText, insertMention, insertText, mentionQuery, normalizeDraft, partLength, unchip, type DraftChip, type DraftPart } from './draft';
import { continueList, expandTask } from './list-continue';
import { roomRoles, searchRoles, type RoleSuggestion } from './role-mentions';
import { isAutocompleteDismissed, type DismissedAutocomplete } from './autocomplete-dismiss';
import { emojiQuery as findEmojiQuery, searchEmoji, withCustomEmoji, type EmojiQuery, type EmojiSuggestion } from './emoji-autocomplete';
import { customEmoji } from './custom-emoji.svelte';
import { roomQuery as findRoomQuery, searchRooms, type RoomQuery, type RoomSuggestion } from './room-autocomplete';
import type { EmojiMartData } from '@emoji-mart/data';
import { loadEmojiData } from './emoji-picker.svelte';
import { directory } from './directory.svelte';
import { enterAction, handheld } from './handheld';
import type { TextEdit } from './text-edit';

/**
 * Where a message is written, the composer's and the message editor's
 * alike: a plain-text editable (`ComposerEditable`) whose mentions are
 * non-editable name chips, `@user_id` in the text (Appendix A.3), or `@&role`
 * for everyone here with a role, and the autocomplete for `@` people and
 * roles, `#` rooms and `:` emoji. One of these per
 * field, made as its component (`MessageField`) starts, which draws the
 * field and the picker from it.
 */

const MENTION_MATCHES_MAX = 8;
/** At most this many of the `@` picker's places go to roles, after anyone named exactly. */
const ROLE_MATCHES_MAX = 3;

/** A suggestion in the `@` picker: a person, or a role (`@&role`). */
export type MentionMatch = MentionPerson | RoleSuggestion;

/** The draft as the field holds it, and the caret in it: what one read of the field gives. */
type Read = { parts: DraftPart[]; caret: number | undefined };

/** How far back an `@` can start a mention query: `mentionQuery` takes up to 64 characters after it. */
const MENTION_REACH = 65;

/**
 * Whether the line before the caret, as far back as a query can start, holds an `@`, `#` or `:`: else no mention,
 * room or emoji query can be open at it (`mentionQuery`, `roomQuery`, `emojiQuery`). `text` has one character per caret
 * position (`positionText`), a chip as its `@id`.
 */
function nearTrigger(text: string, caret: number): boolean {
	const from = Math.max(text.lastIndexOf('\n', caret - 1) + 1, caret - MENTION_REACH);
	for (let at = caret - 1; at >= from; at--) {
		const char = text[at];
		if (char === '@' || char === '#' || char === ':') return true;
	}
	return false;
}

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
	/** More `user_id`s that are people, beyond `people` and the directory: an `@` of one is a mention. */
	readonly known?: readonly string[];
	readonly disabled: boolean;
	/** Enter where it sends (or saves): `enterAction`, with no picker taking it. */
	submit(): void;
	/**
	 * A key no picker took that types no character (Escape, an arrow, Enter), before Enter's: the caller's own, such as
	 * ↑ in an empty composer. True when it took it. Typing doesn't ask.
	 */
	key?(event: KeyboardEvent): boolean;
	/**
	 * Enter starts a new line, and Ctrl+Enter or ⌘+Enter sends: for writing at length (the composer's full panel),
	 * where a message has many lines. Unset, Enter sends (`enterAction`).
	 */
	readonly newlineOnEnter?: boolean;
	/** The draft changed by typing or a pick, not set from outside. */
	oninput?(): void;
	/** The draft was emptied from outside, as sending it does: not by typing. */
	oncleared?(): void;
	/** The mention picker opened: a moment to refresh who can be named. */
	onmention?(): void;
	/**
	 * Whether the picker can show, read only once one would open: false while its code is still on its way (it loads
	 * on demand), when the keys stay the field's, as what shows says. Unset, it always can.
	 */
	readonly pickerShown?: boolean;
}

export class DraftField {
	private readonly host: DraftHost;
	/** The open picker's ID, which the field names in `aria-controls`. */
	readonly pickerId: string;
	/** The field; `bind:element` on its `ComposerEditable`. */
	element = $state<HTMLDivElement | undefined>();
	/** Nothing is in the field: its placeholder shows. */
	empty = $state(true);
	/**
	 * The draft has more than one line: set only as that changes, so what reads it (the composer's Expand) isn't asked
	 * again on every key, as it would be reading the draft itself.
	 */
	multiline = $state(false);
	private wasMultiline = false;
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

	matches: MentionMatch[];
	/** The roles someone else here holds, which an `@` can name. */
	roles: RoleSuggestion[];
	private roleIds: string[];
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
		this.roles = $derived(roomRoles(host.people));
		this.roleIds = $derived(this.roles.map((suggestion) => suggestion.role));
		this.matches = $derived(this.query === undefined ? [] : this.matching(this.query));
		this.emojiMatches = $derived(this.emojiFound && this.emojiData ? withCustomEmoji(customEmoji.catalog, this.emojiFound.query, searchEmoji(this.emojiData, this.emojiFound.query), (emoji) => directory.mediaGate.src(customEmoji.image(emoji).src)) : []);
		this.roomIds = $derived(host.rooms.map((room) => room.id));
		this.roomMatches = $derived(this.roomFound ? searchRooms(host.rooms, this.roomFound.query) : []);
		this.pickerOpen = $derived(this.query !== undefined && !host.disabled);
		this.roomPickerOpen = $derived(this.roomFound !== undefined && !host.disabled);
		this.emojiPickerOpen = $derived(this.emojiFound !== undefined && this.emojiData !== undefined && !host.disabled);
		this.completion = $derived.by(() => {
			if (!this.pickerOpen && !this.roomPickerOpen && !this.emojiPickerOpen) return undefined;
			// A picker that isn't drawn yet takes no keys, and the field names none: Enter sends, as nothing on screen says otherwise.
			if (host.pickerShown === false) return undefined;
			if (this.pickerOpen) return { count: this.matches.length, take: (index: number) => this.pick(this.matches[index]), enter: true };
			if (this.roomPickerOpen) return { count: this.roomMatches.length, take: (index: number) => this.pickRoom(this.roomMatches[index]), enter: this.roomFound?.query !== '' };
			return { count: this.emojiMatches.length, take: (index: number) => this.pickEmoji(this.emojiMatches[index]), enter: true };
		});
		this.activeIndex = $derived(Math.min(this.active, Math.max(0, (this.completion?.count ?? 0) - 1)));
		this.aria = $derived({
			'aria-autocomplete': 'list' as const,
			'aria-controls': this.completion ? pickerId : undefined,
			'aria-activedescendant': this.completion?.count ? `${pickerId}-${this.activeIndex}` : undefined
		});
		// Copy and cut are listened for once per field, not passed as its props, which are applied again on every key.
		$effect(() => {
			const field = this.element;
			if (!field) return;
			field.addEventListener('copy', this.copy);
			field.addEventListener('cut', this.cut);
			return () => {
				field.removeEventListener('copy', this.copy);
				field.removeEventListener('cut', this.cut);
			};
		});
		$effect(() => {
			const current = this.element;
			const text = this.host.value;
			if (!current || (this.shown?.field === current && this.shown.text === text)) return;
			untrack(() => {
				const cleared = !text && Boolean(this.shown?.text);
				this.lastSelection = undefined;
				// Nobody typed it: its `@user_id`s become chips, the last one too, and a name in plain text stays text.
				const collapsed = collapseMentions([text], this.host.people, { caret: text.length, final: true, names: false, isUser: this.isUser, rooms: this.roomIds, roles: this.roleIds });
				const parts = chipTasks(collapsed.parts);
				this.draw(current, parts, document.activeElement === current ? collapsed.caret : undefined);
				this.commit(current, parts, false);
				if (cleared) this.host.oncleared?.();
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
		this.refresh(this.collapse(false));
	}

	/**
	 * Makes a formatting change (`markdown-format.ts`) to the draft and its selection: the field is drawn anew from the
	 * changed draft, its `@user_id`s, `#room_id`s and `@&role`s as chips, as a draft set from outside is, and the
	 * change's selection is set. The browser's Undo doesn't take it back (as it doesn't a picked mention); pressing the
	 * format again does. Out of the field (a toolbar button reached with Tab), it reads the selection the field had as it
	 * lost focus. False when the change has nothing to do.
	 */
	apply(change: (edit: TextEdit) => TextEdit | undefined): boolean {
		const field = this.element;
		if (!field || this.host.disabled) return false;
		const { parts, caret, anchor } = readDraft(field);
		const kept = caret === undefined ? this.lastSelection : undefined;
		const focus = caret ?? kept?.end ?? draftLength(parts);
		const other = anchor ?? kept?.start ?? focus;
		const changed = change({ text: positionText(parts), start: Math.min(focus, other), end: Math.max(focus, other) });
		if (!changed) return false;
		this.closeCompletions();
		this.lastSelection = undefined;
		const next = chipTasks(collapseMentions([changed.text], this.host.people, { caret: changed.end, final: true, names: false, isUser: this.isUser, rooms: this.roomIds, roles: this.roleIds }).parts);
		field.focus();
		this.draw(field, next, undefined);
		placeSelection(field, changed.start, changed.end);
		this.commit(field, next, true);
		return true;
	}

	/**
	 * Makes a change at a bare caret (`continueList`, `expandTask`) as typing it would: the text it replaces is selected
	 * and the new text typed over it, so the browser's Undo takes it back and the chips around it stay as they are. The
	 * change keeps everything after the caret; false when it makes none.
	 */
	private typeChange(change: (edit: TextEdit) => TextEdit | undefined): boolean {
		const field = this.element;
		if (!field || this.host.disabled) return false;
		const { parts, caret, anchor } = readDraft(field);
		if (caret === undefined || (anchor !== undefined && anchor !== caret)) return false;
		const before = positionText(parts);
		const changed = change({ text: before, start: caret, end: caret });
		if (!changed) return false;
		const kept = before.length - caret;
		let from = 0;
		while (from < caret && before[from] === changed.text[from]) from++;
		// A selection is placed among the field's own text and chips: lines the browser wrapped in blocks (Chrome's
		// `<div>` for Enter) are drawn flat first.
		if (!isFlat(field)) this.draw(field, parts, caret);
		placeSelection(field, from, caret);
		return document.execCommand('insertText', false, changed.text.slice(from, changed.text.length - kept));
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
		// A key the input method takes, as part of a composition. Safari sends the Enter that commits one after
		// `compositionend`, so `isComposing` is false then, but its `keyCode` is 229, as during one: it sends nothing.
		const composing = event.isComposing || event.keyCode === 229;
		if (completion && !composing) {
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
		if (composing || (event.key.length > 1 && this.host.key?.(event))) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			const send = this.host.newlineOnEnter ? event.ctrlKey || event.metaKey : enterAction(event, this.onHandheld) === 'send';
			if (send) this.host.submit();
			// A new line on a list item carries the list on (a task unticked), or ends it on an empty one.
			else if (!this.typeChange(continueList)) document.execCommand('insertText', false, '\n');
		}
	};

	/**
	 * Backspace against a chip turns it back into the text it showed, to edit.
	 * Handled as the delete it asks for rather than the key, since phone
	 * keyboards often send no Backspace keydown.
	 */
	beforeinput = (event: InputEvent): void => {
		if (event.isComposing) return;
		const forward = event.inputType === 'deleteContentForward';
		if ((forward || event.inputType === 'deleteContentBackward') && this.deleteTask(forward)) event.preventDefault();
		else if (event.inputType === 'deleteContentBackward' && this.backspaceChip()) event.preventDefault();
	};

	/**
	 * Copying a selection with a checkbox in it copies its Markdown (`- [ ] `), which the browser would leave out (the
	 * checkbox draws no text); mentions copy as they show. Any other selection is the browser's to copy.
	 */
	copy = (event: ClipboardEvent): void => {
		const text = this.selectedMarkdown();
		if (text === undefined || !event.clipboardData) return;
		event.preventDefault();
		event.clipboardData.setData('text/plain', text);
	};

	/** Cutting copies as `copy` does, then deletes the selection, as the browser would. */
	cut = (event: ClipboardEvent): void => {
		this.copy(event);
		if (event.defaultPrevented) document.execCommand('delete');
	};

	/** The selected text, each checkbox as its Markdown and each mention as it shows; undefined without a checkbox in it. */
	private selectedMarkdown(): string | undefined {
		const field = this.element;
		if (!field || !field.querySelector('[data-task]')) return undefined;
		const { parts, caret, anchor } = readDraft(field);
		if (caret === undefined || anchor === undefined || caret === anchor) return undefined;
		const [start, end] = caret < anchor ? [caret, anchor] : [anchor, caret];
		let text = '';
		let tasks = false;
		let offset = 0;
		for (const part of parts) {
			const length = partLength(part);
			if (offset + length > start && offset < end) {
				if (typeof part === 'string') text += part.slice(Math.max(0, start - offset), end - offset);
				else if (part.task) {
					text += chipText(part);
					tasks = true;
				} else text += part.role ? chipText(part) : mentionLabel(this.chipMention(part));
			}
			offset += length;
		}
		return tasks ? text : undefined;
	}

	/** A delete against a checkbox at its line's start (`deleteAtTask`), done here: the browser would take the checkbox. */
	private deleteTask(forward: boolean): boolean {
		const field = this.element;
		if (!field || !field.querySelector('[data-task]')) return false;
		const { parts, caret, anchor } = readDraft(field);
		if (caret === undefined || (anchor !== undefined && anchor !== caret)) return false;
		const done = deleteAtTask(parts, caret, forward);
		if (!done) return false;
		this.draw(field, done.parts, done.caret);
		this.commit(field, done.parts, true);
		return true;
	}

	input = (event: Event): void => {
		const field = this.element;
		if (!field) return;
		if ((event as InputEvent).isComposing) {
			this.commit(field, readDraft(field).parts, true);
			return;
		}
		const read = this.collapse(false);
		// A space after `[]` at a line's start may finish a checklist item typed short (`-[] `): only then is it looked at.
		if ((event as InputEvent).data === ' ' && read?.caret !== undefined && positionText(read.parts).slice(read.caret - 2, read.caret) === '] ' && this.typeChange(expandTask)) return;
		this.refresh(read);
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
	refreshQuery = (): void => this.refresh();

	/** A click: on a checkbox, ticks or unticks it in the draft, the caret where it was; anywhere, reads the query again. */
	click = (event: MouseEvent): void => {
		const box = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-task]');
		const field = this.element;
		if (box && field && field.contains(box) && !this.host.disabled) {
			event.preventDefault();
			const { parts, caret } = readDraft(field);
			// The draft reads its checkboxes in document order, as the field holds them.
			const index = [...field.querySelectorAll('[data-task]')].indexOf(box);
			let seen = -1;
			const toggled = parts.map((part): DraftPart => {
				if (typeof part === 'string' || !part.task) return part;
				seen += 1;
				return seen === index ? { ...part, task: part.task === 'x' ? ' ' : 'x' } : part;
			});
			this.draw(field, toggled, caret);
			this.commit(field, toggled, true);
			return;
		}
		this.refresh();
	};

	/**
	 * A key let go: the caret may have moved (arrows, Home, End), so the query is read again. A key that typed a
	 * character was read at its `input`, so it isn't read twice.
	 */
	keyup = (event: KeyboardEvent): void => {
		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return;
		this.refresh();
	};

	/** `refreshQuery`, with the draft `collapse` just read, where it has, rather than read the field again. */
	private refresh(read?: Read): void {
		const field = this.element;
		if (!field || this.host.disabled || document.activeElement !== field) {
			this.closeCompletions();
			this.dismissedAutocomplete = undefined;
			return;
		}
		const { parts, caret } = read ?? readDraft(field);
		const text = draftText(parts);
		const position = caret ?? draftLength(parts);
		// Most keys are far from any `@`, `#` or `:`: with nothing open or dismissed, there's nothing to look for.
		if (!this.query && !this.emojiFound && !this.roomFound && !this.dismissedAutocomplete && !nearTrigger(parts.length > 1 ? positionText(parts) : text, position)) return;
		if (isAutocompleteDismissed(this.dismissedAutocomplete, text, position)) {
			this.closeCompletions();
			return;
		}
		if (this.dismissedAutocomplete) this.dismissedAutocomplete = undefined;
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
	}

	/** Swaps the typed `@…` for a chip: the person's name on screen, `@user_id` on the wire (Appendix A.3); a role's, `@&role`. */
	pick(item: MentionMatch): void {
		const field = this.element;
		if (!field) return;
		const { parts, caret } = readDraft(field);
		const end = caret ?? draftLength(parts);
		this.picked(field, 'role' in item ? insertMention(parts, this.anchor, end, item.role, 'role') : insertMention(parts, this.anchor, end, item.id));
	}

	pickRoom(room: RoomSuggestion): void {
		const field = this.element;
		if (!field || !this.roomFound) return;
		this.picked(field, insertMention(readDraft(field).parts, this.roomFound.start, this.roomFound.end, room.id, 'room'));
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

	private isUser = (id: string): boolean => this.host.people.some((person) => person.id === id) || (this.host.known?.includes(id) ?? false) || directory.resolve(id)?.kind === 'user';

	/**
	 * People whose name or ID starts with the query, and roles whose name
	 * does: whoever or whatever it names exactly first, then people, then
	 * roles, which keep up to `ROLE_MATCHES_MAX` places when the people fill
	 * the list and take whatever room is left otherwise. `@&` asks for roles alone.
	 */
	private matching(text: string): MentionMatch[] {
		const roles = searchRoles(this.roles, text);
		if (text.startsWith('&')) return roles.slice(0, MENTION_MATCHES_MAX);
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
		const people = scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.person);
		const exactRoles = roles.filter((suggestion) => exact && suggestion.role.toLowerCase() === exact);
		const otherRoles = roles.filter((suggestion) => !exactRoles.includes(suggestion));
		const named = people.filter((_, index) => scored[index].rank === 0);
		const rest = people.slice(named.length);
		const free = MENTION_MATCHES_MAX - named.length - exactRoles.length - rest.length;
		const roleCount = Math.min(otherRoles.length, Math.max(ROLE_MATCHES_MAX, free));
		return [...named, ...exactRoles, ...rest.slice(0, Math.max(0, MENTION_MATCHES_MAX - named.length - exactRoles.length - roleCount)), ...otherRoles.slice(0, roleCount)].slice(0, MENTION_MATCHES_MAX);
	}

	/** Closes whichever picker is open. */
	private closeCompletions(): void {
		if (this.query !== undefined) this.query = undefined;
		if (this.emojiFound !== undefined) this.emojiFound = undefined;
		if (this.roomFound !== undefined) this.roomFound = undefined;
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
		// A role's chip goes back to what it's written as, `@&role`, so it can become a chip again.
		// A checkbox goes back to its Markdown less the space after it, to edit: whole, it would be drawn again at once.
		const reverted = unchip(parts, caret, (part) => (part.task ? chipText(part).trimEnd() : part.role ? chipText(part) : mentionLabel(this.chipMention(part))));
		if (!reverted) return false;
		this.draw(field, reverted.parts, reverted.caret);
		this.commit(field, reverted.parts, true);
		this.refreshQuery();
		return true;
	}

	/** Chips finished mentions; `final` when sending, so one at the very end counts too. */
	private collapse(final: boolean): Read | undefined {
		const field = this.element;
		if (!field) return undefined;
		const { parts, caret } = readDraft(field);
		const collapsed = collapseMentions(parts, this.host.people, { caret: caret ?? draftLength(parts), final, isUser: this.isUser, rooms: this.roomIds, roles: this.roleIds });
		// A checklist item's `- [ ] ` is drawn as its checkbox; its length is its Markdown's, so the caret stays put.
		const tasked = chipTasks(collapsed.parts);
		const changed = collapsed.changed || tasked !== collapsed.parts;
		if (changed) this.draw(field, tasked, caret === undefined ? undefined : collapsed.caret);
		this.commit(field, tasked, changed || draftText(tasked) !== this.host.value);
		return { parts: tasked, caret: caret === undefined ? undefined : collapsed.caret };
	}

	/** Publishes what the field shows as the draft. */
	private commit(root: HTMLElement, parts: DraftPart[], typed: boolean): void {
		const text = draftText(parts);
		this.shown = { field: root, text };
		this.empty = parts.length === 0;
		// Compared with a plain copy: reading the state itself would cost each key what this is here to save.
		const multiline = text.includes('\n');
		if (multiline !== this.wasMultiline) this.multiline = this.wasMultiline = multiline;
		const mentioned = draftMentions(parts, this.roleMembers);
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

	/** Who a role's chip mentions: everyone else here who holds it, as the room lists them. */
	private roleMembers = (role: string): string[] => this.roles.find((suggestion) => suggestion.role === role)?.members ?? [];

	/** What a chip names, as the Mention component every rendered mention uses. */
	private chipMention(part: DraftChip): Mention {
		if (part.role) return { target: { kind: 'role', id: part.id }, hash: false };
		if (part.room) return { target: directory.resolveRoom(part.id) ?? { kind: 'room', id: part.id, title: part.id }, hash: true };
		const person = this.host.people.find((entry) => entry.id === part.id) ?? directory.person({ user_id: part.id });
		const target: Mention['target'] = { kind: 'user', id: part.id, name: person?.name?.trim() || part.id, me: directory.isMe(part.id) };
		if (directory.sharesName({ user_id: part.id })) target.shared = true;
		return { target, hash: false };
	}

	/** A chip: the Mention component as a non-editable span, its ID on hover. */
	private chip(part: DraftChip): HTMLSpanElement {
		if (part.task) {
			const box = document.createElement('span');
			box.className = part.task === 'x' ? 'ap-task-chip ap-task-chip-done' : 'ap-task-chip';
			box.contentEditable = 'false';
			box.dataset.task = part.task;
			// Named for what it is; the keyboard can't tick it, so it doesn't claim to be a checkbox.
			box.setAttribute('role', 'img');
			box.setAttribute('aria-label', part.task === 'x' ? 'Checklist item, done' : 'Checklist item');
			box.title = part.task === 'x' ? 'Done: click to untick' : 'Click to tick';
			return box;
		}
		const mention = this.chipMention(part);
		const label = mentionLabel(mention);
		const element = document.createElement('span');
		element.className = mentionClass(mention);
		element.contentEditable = 'false';
		if (part.room) element.dataset.roomId = part.id;
		else if (part.role) element.dataset.role = part.id;
		else element.dataset.userId = part.id;
		if (part.role) element.title = roleChipTip(this.roleMembers(part.id).length, part.id);
		else if (label !== draftText([part])) element.title = draftText([part]);
		element.textContent = label;
		return element;
	}
}

/** The chip a field's element draws, if it is one. */
function chipOf(element: HTMLElement): DraftChip | undefined {
	const { userId, roomId, role, task } = element.dataset;
	if (task === ' ' || task === 'x') return { id: '', task };
	if (userId) return { id: userId };
	if (roomId) return { id: roomId, room: true };
	if (role) return { id: role, role: true };
	return undefined;
}

/** A role chip's tooltip in the field: who sending it mentions. */
function roleChipTip(count: number, role: string): string {
	if (count === 0) return `No one else here has the role ${role}`;
	return `Mentions ${count === 1 ? 'the 1 person' : `all ${count} people`} here with the role ${role}`;
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
				const chip = chipOf(child);
				if (chip) {
					parts.push(chip);
					length += partLength(chip);
				} else if (child.tagName === 'BR') {
					// A break that ends its block is the browser's placeholder for an empty line, not a line.
					if (index < node.childNodes.length - 1) text('\n');
				} else {
					const block = /^(DIV|P)$/.test(child.tagName);
					if (block && length > 0 && !draftText(parts).endsWith('\n')) text('\n');
					const start = length;
					walk(child);
					// A block holding only its placeholder break is an empty line (Chrome draws a blank line typed between
					// two as `<div><br></div>`): with more after it, it ends its own line, so the next block doesn't take its
					// line break for its own. Ending the field, it is the line the caret sits on, which the break before it made.
					if (block && length === start && index < node.childNodes.length - 1) text('\n');
				}
			}
		});
		if (node === focusNode && focusOffset >= node.childNodes.length && caret === undefined) caret = length;
		if (node === anchorNode && anchorOffset >= node.childNodes.length && anchor === undefined) anchor = length;
	};
	walk(root);
	return { parts: normalizeDraft(parts), caret, anchor };
}

/** The draft's text with each chip as it is written (`chipText`) and nothing added: one character per caret position. */
function positionText(parts: DraftPart[]): string {
	return parts.map((part) => (typeof part === 'string' ? part : chipText(part))).join('');
}

/** Puts the caret at a draft-text position; a position inside a chip lands after it. */
function placeCaret(root: HTMLElement, caret: number): void {
	placeSelection(root, caret, caret);
}

/** Selects the draft text from `start` to `end` in a field drawn from its parts (`draw`); equal, a bare caret. */
function placeSelection(root: HTMLElement, start: number, end: number): void {
	const selection = document.getSelection();
	if (!selection) return;
	const from = pointIn(root, start);
	const to = start === end ? from : pointIn(root, end);
	selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/** The point at a draft-text position among the field's text and chips; a position inside a chip lands after it. */
function pointIn(root: HTMLElement, position: number): { node: Node; offset: number } {
	let offset = 0;
	for (const [index, node] of [...root.childNodes].entries()) {
		const chip = node instanceof HTMLElement ? chipOf(node) : undefined;
		const length = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : chip ? partLength(chip) : 0;
		if (node.nodeType === Node.TEXT_NODE && position <= offset + length) return { node, offset: position - offset };
		if (position < offset + length) return { node: root, offset: index + 1 };
		offset += length;
	}
	const last = root.lastChild;
	return { node: root, offset: last instanceof HTMLBRElement ? root.childNodes.length - 1 : root.childNodes.length };
}

/** Whether the field holds only text, line breaks and chips, as `draw` leaves it, with no blocks the browser added. */
function isFlat(field: HTMLElement): boolean {
	for (const node of field.childNodes) {
		if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement) continue;
		if (!(node instanceof HTMLElement) || !chipOf(node)) return false;
	}
	return true;
}
