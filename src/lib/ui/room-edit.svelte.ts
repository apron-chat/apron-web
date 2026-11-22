import type { DraftStore } from './pane-drafts.svelte';
import { descriptionFingerprint, type SavedDraft } from './storage';
import { messageOf, Task } from './task.svelte';

/** A room or thread as its edit starts from and saves to: its title as written (`editableTitle`), and its description. */
export interface EditedRoom {
	id: string;
	title: string;
	description?: string;
}

/** What `room_set` (§4.2.4) is sent to save an edit: only what changed, an emptied field as `null`. */
export type RoomPatch = { title?: string | null; description?: string | null };

/**
 * An edit under way: the title and description as being written, and `base`, the fingerprint of the room as it read
 * when the edit began. `from` is that room's title and description, while this visit knows them: an edit that reads as
 * they do is no draft. One restored from an earlier visit doesn't know them, so it is a draft until saved or discarded.
 */
interface Edit {
	title: string;
	text: string;
	base: string;
	from?: { title: string; text: string };
}

/** The fingerprint of a room as it reads, title and description together: whether someone else changed it since. */
export function roomFingerprint(room: EditedRoom): string {
	return descriptionFingerprint(`${room.title}\u0000${room.description ?? ''}`);
}

/**
 * The open pane's description, shown over its conversation (DescriptionSheet), and its room's or thread's title and
 * description being edited there: one for the page, read by the header (Edit, or the title being edited and Save) and
 * by the sheet alike.
 *
 * An edit is a draft once it reads otherwise than the room did, kept as the composer's are (`DraftKeeper`, a `store`):
 * the title, the description and the fingerprint it began from, per room or thread (`keyOf`), so a reload, a closed tab
 * or a crash keeps it, and Edit takes it up again. Leaving the room keeps it too. Cancelling or closing it asks first
 * (`ask`, the browser's `confirm`) whether to discard it, and saving it over the room's title or description that someone
 * else has changed since asks whether to replace theirs.
 */
export class RoomEdit {
	/** The room or thread whose description shows over its pane, and whether it is being edited; none while it's shut. */
	shown = $state<{ id: string; editing: boolean }>();
	/** Saving the edit, and why it didn't save. */
	readonly task = new Task<'saving', string>();
	/** The edits, by key: replaced whole on each change, so what reads them updates (a plain map: `svelte/reactivity`'s SvelteMap would load with the app). */
	#edits = $state.raw<ReadonlyMap<string, Edit>>(new Map());
	readonly #store: DraftStore | undefined;
	readonly #keyOf: (roomId: string) => string;
	readonly #ask: (question: string) => boolean;

	/** What the store reads a changed edit with, as it writes it: nothing once it is no draft, so the kept one goes. */
	readonly #read = (key: string): SavedDraft => {
		const edit = this.#edits.get(key);
		return edit && isDraft(edit) ? { text: edit.text, title: edit.title, base: edit.base } : { text: '' };
	};

	constructor(keyOf: (roomId: string) => string, store?: DraftStore, ask: (question: string) => boolean = (question) => confirm(question)) {
		this.#keyOf = keyOf;
		this.#store = store;
		this.#ask = ask;
		store?.attach?.(() => this.#edits.keys(), this.#read);
	}

	/** The edit of `roomId` under way, if any. */
	edit(roomId: string): Readonly<Edit> | undefined {
		return this.#edits.get(this.#keyOf(roomId));
	}

	/** Whether `roomId` has an edit that reads otherwise than the room did: a draft, kept until saved or discarded. */
	drafted(roomId: string): boolean {
		const edit = this.edit(roomId);
		return Boolean(edit && isDraft(edit));
	}

	/** The edit being written, if the shown description is being edited. */
	get editing(): Readonly<Edit> | undefined {
		return this.shown?.editing ? this.edit(this.shown.id) : undefined;
	}

	/**
	 * Reads what was kept of `room`'s edit from an earlier visit, unless this one has it already: so its draft shows as
	 * one before Edit takes it up. Once the store knows whose drafts these are; one that reads as the room now does is
	 * no draft, and goes.
	 */
	recall(room: EditedRoom): void {
		const key = this.#keyOf(room.id);
		if (this.#edits.has(key) || !this.#store?.knows(key)) return;
		const kept = this.#store.load(key);
		if (kept?.title === undefined || kept.base === undefined) return;
		if (kept.title === room.title && kept.text === (room.description ?? '')) {
			this.#store.changed(key, this.#read);
			return;
		}
		this.#set(key, { title: kept.title, text: kept.text, base: kept.base });
	}

	/** Shows `room`'s description over its pane, to read. */
	open(room: EditedRoom): void {
		this.task.reset();
		this.shown = { id: room.id, editing: false };
	}

	/** Shows `room`'s description over its pane, to edit: its draft, where there is one, else the room as it reads. */
	start(room: EditedRoom): void {
		this.recall(room);
		const key = this.#keyOf(room.id);
		if (!this.#edits.has(key)) {
			const from = { title: room.title, text: room.description ?? '' };
			this.#set(key, { ...from, base: roomFingerprint(room), from });
		}
		this.task.reset();
		this.shown = { id: room.id, editing: true };
	}

	/** The edit's title, as typed. */
	setTitle(roomId: string, title: string): void {
		this.#change(roomId, { title });
	}

	/** The edit's description, as typed. */
	setText(roomId: string, text: string): void {
		this.#change(roomId, { text });
	}

	/**
	 * Stops editing, back to reading the description (or shut, with none): a draft goes only once `ask` says to discard
	 * it. Returns whether it stopped.
	 */
	cancel(room: EditedRoom, thread: boolean): boolean {
		if (!this.#discard(room.id, thread)) return false;
		this.shown = room.description ? { id: room.id, editing: false } : undefined;
		return true;
	}

	/** Shuts the description; being edited, only once a draft's discard is asked and agreed. Returns whether it shut. */
	close(room: EditedRoom | undefined, thread: boolean): boolean {
		if (room && this.shown?.editing && !this.#discard(room.id, thread)) return false;
		this.shown = undefined;
		return true;
	}

	/** The pane moved on, or the page left its server: the description shuts, and a draft stays to come back to. */
	leave(): void {
		this.task.reset();
		this.shown = undefined;
	}

	/**
	 * Saves the edit with `update` (`room_set`): what changed from `room` as it now reads, an emptied field cleared.
	 * Changed by someone else since the edit began, it asks first whether to replace theirs. Saved, the draft goes and the
	 * description shows as saved (shut, emptied). Resolves with what it sent, if it saved anything.
	 */
	async save(room: EditedRoom, thread: boolean, update: (patch: RoomPatch) => Promise<unknown>): Promise<RoomPatch | undefined> {
		const key = this.#keyOf(room.id);
		const edit = this.#edits.get(key);
		if (!edit || this.task.busy) return undefined;
		const noun = thread ? 'thread' : 'room';
		if (edit.base !== roomFingerprint(room) && !this.#ask(`Someone changed this ${noun} since you started editing it. Replace their changes with yours?`)) return undefined;
		const title = edit.title.trim();
		const description = edit.text.trim();
		const patch: RoomPatch = {
			...(title !== room.title ? { title: title || null } : {}),
			...(description !== (room.description ?? '').trim() ? { description: description || null } : {})
		};
		const saved = !Object.keys(patch).length || await this.task.run('saving', () => update(patch), { failed: (cause) => messageOf(cause, `Unable to save ${noun}`) });
		if (!saved) return undefined;
		this.#forget(key);
		const shows = 'description' in patch ? Boolean(patch.description) : Boolean(room.description);
		if (this.shown?.id === room.id) this.shown = shows ? { id: room.id, editing: false } : undefined;
		return Object.keys(patch).length ? patch : undefined;
	}

	/** Writes the edits whose keys pass `goes` again, as the account they're kept for changes (a guest's, signing in). */
	keepWhere(goes: (key: string) => boolean): void {
		for (const key of this.#edits.keys()) if (goes(key)) this.#store?.changed(key, this.#read);
	}

	/** Forgets the edits whose keys pass `goes`, as the page drops another account's drafts. */
	forgetWhere(goes: (key: string) => boolean): void {
		if ([...this.#edits.keys()].some(goes)) this.#edits = new Map([...this.#edits].filter(([key]) => !goes(key)));
		if (this.shown?.editing && !this.#edits.has(this.#keyOf(this.shown.id))) this.shown = undefined;
	}

	#set(key: string, edit: Edit): void {
		this.#edits = new Map(this.#edits).set(key, edit);
	}

	#change(roomId: string, change: Partial<Pick<Edit, 'title' | 'text'>>): void {
		const key = this.#keyOf(roomId);
		const edit = this.#edits.get(key);
		if (!edit) return;
		this.#set(key, { ...edit, ...change });
		this.#store?.changed(key, this.#read);
	}

	/** Whether `roomId`'s edit may go: no draft, or one `ask` says to discard. Gone, if so. */
	#discard(roomId: string, thread: boolean): boolean {
		const key = this.#keyOf(roomId);
		const edit = this.#edits.get(key);
		if (this.task.busy) return false;
		if (edit && isDraft(edit) && !this.#ask(`Discard your changes to this ${thread ? 'thread' : 'room'}?`)) return false;
		this.#forget(key);
		return true;
	}

	#forget(key: string): void {
		if (!this.#edits.has(key)) return;
		const edits = new Map(this.#edits);
		edits.delete(key);
		this.#edits = edits;
		this.#store?.changed(key, this.#read);
	}
}

/** Whether an edit reads otherwise than the room it began from; one restored from an earlier visit always is. */
function isDraft(edit: Edit): boolean {
	return !edit.from || edit.title.trim() !== edit.from.title.trim() || edit.text.trim() !== edit.from.text.trim();
}
