import { untrack } from 'svelte';
import { mentionClass, mentionLabel, type Mention, type MentionPerson } from '$lib/protocol/markdown';
import { chipText, collapseMentions, draftLength, draftMentions, draftText, insertMention, insertText, mentionQuery, normalizeDraft, partLength, unchip, type DraftChip, type DraftPart } from './draft';
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
	 * A key no picker took that types no character (Escape, an arrow, Enter) or holds Ctrl or ⌘ (Ctrl+B), before
	 * Enter's: the caller's own, such as ↑ in an empty composer. True when it took it. Typing doesn't ask.
	 */
	key?(event: KeyboardEvent): boolean;
	/**
	 * Enter starts a new line, and Ctrl+Enter or ⌘+Enter sends: for writing at length (the composer's full panel),
	 * where a message has many lines. Unset, Enter sends (`enterAction`).
	 */
	readonly newlineOnEnter?: boolean;
	/** The draft changed by typing or a pick, not set from outside. */
	oninput?(): void;
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
	/**
	 * Formatting changes the field was drawn anew for (`apply`, where a chip stood in the browser's way), which the
	 * browser's own Undo can't take back: Ctrl+Z (⌘Z) takes the last one back while the draft is as it left it, and
	 * Ctrl+Shift+Z or Ctrl+Y makes it again. Once the draft is otherwise changed, Undo is the browser's again.
	 */
	private undoable: DrawnChange[] = [];
	private redoable: DrawnChange[] = [];

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
		$effect(() => {
			const current = this.element;
			const text = this.host.value;
			if (!current || (this.shown?.field === current && this.shown.text === text)) return;
			untrack(() => {
				this.lastSelection = undefined;
				// Nobody typed it: its `@user_id`s become chips, the last one too, and a name in plain text stays text.
				const collapsed = collapseMentions([text], this.host.people, { caret: text.length, final: true, names: false, isUser: this.isUser, rooms: this.roomIds, roles: this.roleIds });
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

	/**
	 * Makes a formatting change (`markdown-format.ts`) to the draft and its selection, as typing it would: the stretch of
	 * text it changes goes through the browser's own editing, so its Undo takes it back, then the change's selection is
	 * set. A stretch with a chip in it can't (the browser writes text only, and the chip drawn back would cut its Undo
	 * off), so the field is drawn anew and Undo is this field's own (`undoable`). Out of the field (a toolbar button
	 * reached with Tab), it reads the selection the field had as it lost focus. False when the change has nothing to do.
	 */
	apply(change: (edit: TextEdit) => TextEdit | undefined): boolean {
		const field = this.element;
		if (!field || this.host.disabled) return false;
		const { parts, caret, anchor } = readDraft(field);
		const text = positionText(parts);
		const kept = caret === undefined ? this.lastSelection : undefined;
		const focus = caret ?? kept?.end ?? text.length;
		const other = anchor ?? kept?.start ?? focus;
		const changed = change({ text, start: Math.min(focus, other), end: Math.max(focus, other) });
		if (!changed) return false;
		this.closeCompletions();
		this.lastSelection = undefined;
		field.focus();
		// The one stretch that changed, between what stayed as it was at either end.
		let head = 0;
		while (head < text.length && head < changed.text.length && text[head] === changed.text[head]) head++;
		let tail = 0;
		while (tail < text.length - head && tail < changed.text.length - head && text[text.length - 1 - tail] === changed.text[changed.text.length - 1 - tail]) tail++;
		const insert = changed.text.slice(head, changed.text.length - tail);
		const to = text.length - tail;
		if (head < to || insert) {
			selectRange(field, head, to);
			// The browser's editing: its `input` publishes the draft, as typing does. Not over a chip, nor without it (a test's DOM).
			const typed = !chipWithin(parts, head, to) && typeof document.execCommand === 'function' && document.execCommand(insert ? 'insertText' : 'delete', false, insert);
			if (!typed) {
				const next = insertText(parts, head, to, insert);
				this.draw(field, next.parts, undefined);
				// Any `@user_id` it wrote becomes a chip again, and the draft is published.
				this.collapse(false);
				const before = { parts, start: Math.min(focus, other), end: Math.max(focus, other) };
				this.undoable = [...this.undoable.slice(-(UNDO_MAX - 1)), { before, after: { parts: readDraft(field).parts, start: changed.start, end: changed.end } }];
				this.redoable = [];
			}
		}
		selectRange(field, changed.start, changed.end);
		return true;
	}

	/** Ctrl+Z or Ctrl+Shift+Z (Ctrl+Y) for a change `apply` drew anew, while the draft is as that change left it (`undoable`). */
	private undoDrawn(event: KeyboardEvent): boolean {
		const field = this.element;
		const key = event.key.toLowerCase();
		const undo = key === 'z' && !event.shiftKey;
		const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.shiftKey);
		if (!field || event.altKey || (!undo && !redo)) return false;
		const from = undo ? this.undoable : this.redoable;
		const last = from.at(-1);
		if (!last) return false;
		const [shown, wanted] = undo ? [last.after, last.before] : [last.before, last.after];
		if (positionText(readDraft(field).parts) !== positionText(shown.parts)) {
			// Changed since, by typing: those changes are the browser's to undo, and these no longer apply.
			this.undoable = [];
			this.redoable = [];
			return false;
		}
		from.pop();
		(undo ? this.redoable : this.undoable).push(last);
		this.draw(field, wanted.parts, undefined);
		this.commit(field, wanted.parts, true);
		selectRange(field, wanted.start, wanted.end);
		return true;
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
		if (!composing && (event.ctrlKey || event.metaKey) && this.undoDrawn(event)) {
			event.preventDefault();
			return;
		}
		if (composing || ((event.key.length > 1 || event.ctrlKey || event.metaKey) && this.host.key?.(event))) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			const send = this.host.newlineOnEnter ? event.ctrlKey || event.metaKey : enterAction(event, this.onHandheld) === 'send';
			if (send) this.host.submit();
			else document.execCommand('insertText', false, '\n');
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
		// A role's chip goes back to what it's written as, `@&role`, so it can become a chip again.
		const reverted = unchip(parts, caret, (part) => (part.role ? chipText(part) : mentionLabel(this.chipMention(part))));
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
		const collapsed = collapseMentions(parts, this.host.people, { caret: caret ?? draftLength(parts), final, isUser: this.isUser, rooms: this.roomIds, roles: this.roleIds });
		if (collapsed.changed) this.draw(field, collapsed.parts, caret === undefined ? undefined : collapsed.caret);
		this.commit(field, collapsed.parts, collapsed.changed || draftText(collapsed.parts) !== this.host.value);
	}

	/** Publishes what the field shows as the draft. */
	private commit(root: HTMLElement, parts: DraftPart[], typed: boolean): void {
		const text = draftText(parts);
		this.shown = { field: root, text };
		this.empty = parts.length === 0;
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
	const { userId, roomId, role } = element.dataset;
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

/** How many formatting changes drawn anew Undo can take back (`DraftField.undoable`). */
const UNDO_MAX = 50;

/** A draft and its selection, before or after a change. */
interface DraftState {
	parts: DraftPart[];
	start: number;
	end: number;
}

/** A formatting change the field was drawn anew for, which Undo takes back. */
interface DrawnChange {
	before: DraftState;
	after: DraftState;
}

/** Whether a chip lies in the draft text from `start` to `end`, or a position between cuts into one. */
function chipWithin(parts: DraftPart[], start: number, end: number): boolean {
	let offset = 0;
	for (const part of parts) {
		const next = offset + partLength(part);
		if (typeof part !== 'string' && next > start && offset < end) return true;
		offset = next;
	}
	return false;
}

/** The draft's text with each chip as it is written (`chipText`) and nothing added: one character per caret position. */
function positionText(parts: DraftPart[]): string {
	return parts.map((part) => (typeof part === 'string' ? part : chipText(part))).join('');
}

/**
 * The point in the field at a caret position, counted as `readDraft` counts: a chip as its text, a line break or a
 * line's block (as the browser writes a typed line) as one; a position inside a chip lands after it.
 */
function pointAt(root: HTMLElement, position: number): { node: Node; offset: number } {
	let length = 0;
	let lastChar = '';
	let found: { node: Node; offset: number } | undefined;
	const walk = (node: Node): void => {
		for (const [index, child] of [...node.childNodes].entries()) {
			if (found) return;
			if (child.nodeType === Node.TEXT_NODE) {
				const text = child.textContent ?? '';
				if (position <= length + text.length) {
					found = { node: child, offset: position - length };
					return;
				}
				length += text.length;
				if (text) lastChar = text.slice(-1);
				continue;
			}
			if (!(child instanceof HTMLElement)) continue;
			if (position <= length) {
				found = { node, offset: index };
				return;
			}
			const chip = chipOf(child);
			if (chip) {
				length += partLength(chip);
				lastChar = 'x';
				if (position < length) found = { node, offset: index + 1 };
			} else if (child.tagName === 'BR') {
				if (index < node.childNodes.length - 1) {
					length += 1;
					lastChar = '\n';
				}
			} else {
				const block = /^(DIV|P)$/.test(child.tagName);
				// The line break `readDraft` counts before a block: a position up to it was found before the block.
				if (block && length > 0 && lastChar !== '\n') {
					length += 1;
					lastChar = '\n';
				}
				const start = length;
				walk(child);
				if (!found && block && length === start && index < node.childNodes.length - 1) {
					length += 1;
					lastChar = '\n';
				}
			}
		}
	};
	walk(root);
	if (found) return found;
	const last = root.lastChild;
	return { node: root, offset: last instanceof HTMLBRElement ? root.childNodes.length - 1 : root.childNodes.length };
}

/** Selects the draft text from `start` to `end`, as `readDraft` counts it; equal, a bare caret. */
function selectRange(root: HTMLElement, start: number, end: number): void {
	const selection = document.getSelection();
	if (!selection) return;
	const from = pointAt(root, start);
	const to = start === end ? from : pointAt(root, end);
	selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/** Puts the caret at a draft-text position; a position inside a chip lands after it. */
function placeCaret(root: HTMLElement, caret: number): void {
	const selection = document.getSelection();
	if (!selection) return;
	const range = document.createRange();
	let offset = 0;
	let placed = false;
	for (const [index, node] of [...root.childNodes].entries()) {
		const chip = node instanceof HTMLElement ? chipOf(node) : undefined;
		const length = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : chip ? partLength(chip) : 0;
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
