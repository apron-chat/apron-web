import type { UploadFile } from '$lib/protocol/client';
import { writtenRoles } from '$lib/protocol/markdown';
import type { SavedDraft } from './storage';

/**
 * A file attached to a draft but not sent yet (capability `embed:upload`,
 * §4.8.4): it goes out as an `upload` embed with the draft's text.
 */
export interface StagedFile {
	/** Local to this page, for removing it before sending. */
	id: string;
	/** The file as picked, pasted or recorded; what the composer previews. */
	file: File;
	/** The file as it will be written: images shrunk and stripped of metadata. */
	prepared: Promise<UploadFile>;
	/** A name given before sending: the embed's `title`, in place of the file's name. */
	title?: string;
}

/** Where drafts are kept between visits (`DraftKeeper`): what a pane first opened this visit starts from. */
export interface DraftStore {
	/** Whether drafts are kept now: when not, a reload loses them. */
	keeps(): boolean;
	/** Whether it is known whose `key`'s draft is: until it is, what was kept of it isn't read. */
	knows(key: string): boolean;
	/** The draft kept for `key` from before, if any. */
	load(key: string): SavedDraft | undefined;
	/** `key`'s draft changed: the store reads it with `read` when it writes, so a change costs no more than saying so. */
	changed(key: string, read: (key: string) => SavedDraft): void;
	/** Every key with a draft here, and how to read each: for the store to write them all again, as keeping resumes. */
	attach?(keys: () => Iterable<string>, read: (key: string) => SavedDraft): void;
}

/**
 * The composer's text, reply target, staged files and removed link previews, kept per destination:
 * each room, and each thread, since a thread is a room of its own. Keys are
 * opaque to this class; the page keys by server and `room_id`. With a `store`,
 * all but the files outlast the visit: a pane opened empty starts from what it
 * kept, and each change goes back to it, however it is made (typed, set from
 * outside, a preview removed).
 */
export class PaneDrafts {
	#text = $state('');
	/**
	 * The roles the open pane's draft names as written (`writtenRoles`), and whether it starts with `/` (it may be a
	 * command): kept as the text is set, each replaced only when it changes, so what reads them reruns only then, not on
	 * each key typed.
	 */
	roles = $state.raw<readonly string[]>([]);
	slashed = $state(false);
	#rolesKey = '';
	/** The open pane's draft, bound to the composer. */
	get text(): string {
		return this.#text;
	}
	set text(text: string) {
		this.#text = text;
		if (this.key !== undefined) this.store?.changed(this.key, this.read);
		// The roles as written, and what can put one in code or a link (backticks, `](`, `<`, an indented line): when
		// any of these change, whether the draft names a role outside code may have too.
		const roles = writtenRoles(text);
		const key = roles.length ? `${roles.join(' ')}|${text.split('`').length}|${text.split('](').length}|${text.split('<').length}|${text.split(/\n(?: {4}|\t)/).length}` : '';
		if (key !== this.#rolesKey) {
			this.#rolesKey = key;
			this.roles = roles;
		}
		const slashed = text.startsWith('/');
		if (slashed !== this.slashed) this.slashed = slashed;
	}
	#reply = $state<string | undefined>();
	/** The `message_id` the open pane's draft replies to. */
	get reply(): string | undefined {
		return this.#reply;
	}
	set reply(messageId: string | undefined) {
		this.#reply = messageId;
		if (this.key !== undefined) this.store?.changed(this.key, this.read);
	}
	/** The files the open pane's draft will be sent with, in order. */
	files = $state.raw<StagedFile[]>([]);
	#dismissed = $state.raw<string[]>([]);
	/** The link previews removed from the open pane's draft, by URL: it goes out without them. */
	get dismissed(): string[] {
		return this.#dismissed;
	}
	set dismissed(urls: string[]) {
		this.#dismissed = urls;
		if (this.key !== undefined) this.store?.changed(this.key, this.read);
	}
	private key: string | undefined;
	private readonly texts = new Map<string, string>();
	private readonly replies = new Map<string, string | undefined>();
	private readonly staged = new Map<string, StagedFile[]>();
	private readonly dismissals = new Map<string, string[]>();
	/** The keys looked up in the store for whose they are now: each is, once, as it is opened, given back or claimed. */
	private readonly recalled = new Set<string>();

	/** What the store reads a changed draft with, as it writes it. */
	private readonly read = (key: string): SavedDraft => this.draftOf(key);

	constructor(private readonly store?: DraftStore) {
		store?.attach?.(() => new Set([...this.texts.keys(), ...this.replies.keys(), ...(this.key === undefined ? [] : [this.key])]), this.read);
	}

	/** The open pane's key, if a pane is open. */
	get current(): string | undefined {
		return this.key;
	}

	/** Keeps the open pane's draft and shows `key`'s, or an empty one when there's no pane. */
	open(key: string | undefined): void {
		this.save();
		if (key !== undefined) this.recall(key);
		this.key = key;
		this.text = key !== undefined ? this.texts.get(key) ?? '' : '';
		this.reply = key !== undefined ? this.replies.get(key) : undefined;
		this.files = key !== undefined ? this.staged.get(key) ?? [] : [];
		this.dismissed = key !== undefined ? this.dismissals.get(key) ?? [] : [];
	}

	/** Keeps the open pane's draft and reply. */
	save(): void {
		if (this.key === undefined) return;
		this.texts.set(this.key, this.text);
		this.replies.set(this.key, this.reply);
		this.staged.set(this.key, this.files);
		this.dismissals.set(this.key, this.dismissed);
		this.persist(this.key);
	}

	/** Keeps the open pane's text as it is typed. */
	saveText(): void {
		if (this.key !== undefined) this.texts.set(this.key, this.text);
	}

	setReply(messageId: string | undefined): void {
		this.reply = messageId;
		this.save();
	}

	/** Adds files to the open pane's draft, after any already there. */
	stage(files: StagedFile[]): void {
		if (this.key === undefined || files.length === 0) return;
		this.files = [...this.files, ...files];
		this.staged.set(this.key, this.files);
	}

	/** Takes a staged file off whichever draft holds it. */
	unstage(id: string): void {
		for (const [key, files] of this.staged) {
			if (files.some((staged) => staged.id === id)) this.staged.set(key, files.filter((staged) => staged.id !== id));
		}
		if (this.files.some((staged) => staged.id === id)) this.files = this.files.filter((staged) => staged.id !== id);
	}

	/** Renames a staged file on whichever draft holds it: it is sent with `title`. */
	rename(id: string, title: string): void {
		const renamed = (files: StagedFile[]) => files.map((staged) => (staged.id === id ? { ...staged, title } : staged));
		for (const [key, files] of this.staged) {
			if (files.some((staged) => staged.id === id)) this.staged.set(key, renamed(files));
		}
		if (this.files.some((staged) => staged.id === id)) this.files = renamed(this.files);
	}

	/** Empties the composer and `key`'s kept draft, once it has been sent. */
	clear(key: string): void {
		this.text = '';
		this.reply = undefined;
		this.files = [];
		this.dismissed = [];
		this.texts.set(key, '');
		this.replies.set(key, undefined);
		this.staged.set(key, []);
		this.dismissals.set(key, []);
		this.persist(key);
	}

	/**
	 * Empties `key`'s kept text and reply, and the composer's when `key` is open: they went out some other way, as a
	 * live message. Staged files stay.
	 */
	forget(key: string): void {
		this.texts.set(key, '');
		this.replies.set(key, undefined);
		this.dismissals.set(key, []);
		this.persist(key);
		if (this.key !== key) return;
		this.text = '';
		this.reply = undefined;
		this.dismissed = [];
	}

	/**
	 * A failed send gives `key`'s draft back, with the link previews that were
	 * removed from it, unless something else has been typed or attached there
	 * since; the composer shows it again when `key` is still open and empty.
	 * Returns whether it did.
	 */
	restore(key: string, text: string, reply: string | undefined, files: StagedFile[] = [], dismissed: string[] = []): boolean {
		const open = this.key === key;
		this.recall(key);
		if (!this.texts.get(key) && !this.replies.get(key) && !this.staged.get(key)?.length && !(open && this.busy())) {
			this.texts.set(key, text);
			this.replies.set(key, reply);
			this.staged.set(key, files);
			this.dismissals.set(key, dismissed);
			this.persist(key);
		}
		if (!open || this.busy()) return false;
		this.text = this.texts.get(key) ?? '';
		this.reply = this.replies.get(key);
		this.files = this.staged.get(key) ?? [];
		this.dismissed = this.dismissals.get(key) ?? [];
		return true;
	}

	/**
	 * Drops every draft here whose key passes `goes`, the open pane's too: the session they were written in signed
	 * out, or another account signed in. The store forgets its own (`DraftKeeper.forget`, `claim`).
	 */
	forgetWhere(goes: (key: string) => boolean): void {
		for (const map of [this.texts, this.replies, this.staged, this.dismissals]) {
			for (const key of [...map.keys()]) if (goes(key)) map.delete(key);
		}
		if (this.key === undefined || !goes(this.key)) return;
		this.text = '';
		this.reply = undefined;
		this.files = [];
		this.dismissed = [];
	}

	/**
	 * Looks again in the store for the drafts whose key passes `test`, now whose they are is known (`DraftKeeper.claim`):
	 * each kept one fills its pane where it is empty. With `again`, whose they are changed (a guest signed in): those
	 * looked up already are looked up for the new account, and every one is marked changed, to be kept as theirs.
	 */
	recallWhere(test: (key: string) => boolean, again: boolean): void {
		const keys = new Set([...this.texts.keys(), ...this.replies.keys(), ...this.recalled, ...(this.key === undefined ? [] : [this.key])]);
		for (const key of keys) {
			if (!test(key)) continue;
			if (again) this.recalled.delete(key);
			this.recall(key);
			if (again) this.persist(key);
		}
	}

	/**
	 * Some draft has what reloading would lose: files, which are never kept, or text, where the store doesn't keep
	 * it; the open pane's, or one kept for another. Reactive through the open pane's, which every kept draft passes
	 * through.
	 */
	get unsent(): boolean {
		if (this.files.length) return true;
		for (const [key, files] of this.staged) if (key !== this.key && files.length) return true;
		if (this.store?.keeps()) return false;
		if (this.text.trim()) return true;
		for (const [key, text] of this.texts) if (key !== this.key && text.trim()) return true;
		return false;
	}

	/** The open pane's draft has something in it. */
	private busy(): boolean {
		return Boolean(this.text || this.reply || this.files.length);
	}

	/**
	 * The first time `key` is asked for once whose it is is known, what the store kept of it, where this visit has
	 * nothing of its own there: the open pane shows it at once.
	 */
	private recall(key: string): void {
		if (!this.store || this.recalled.has(key) || !this.store.knows(key)) return;
		this.recalled.add(key);
		const open = key === this.key;
		if (open ? this.text.trim() || this.reply : this.texts.get(key)?.trim() || this.replies.get(key)) return;
		const kept = this.store.load(key);
		if (!kept) return;
		this.texts.set(key, kept.text);
		this.replies.set(key, kept.reply);
		this.dismissals.set(key, kept.dismissed ?? []);
		if (!open) return;
		this.text = kept.text;
		this.reply = kept.reply;
		this.dismissed = kept.dismissed ?? [];
	}

	/** Tells the store `key`'s draft changed. */
	private persist(key: string): void {
		this.store?.changed(key, this.read);
	}

	/** `key`'s draft as it now is: the open pane's as shown, which is ahead of what `save` last kept of it. */
	private draftOf(key: string): SavedDraft {
		if (key === this.key) return { text: this.text, reply: this.reply, dismissed: this.dismissed };
		return { text: this.texts.get(key) ?? '', reply: this.replies.get(key), dismissed: this.dismissals.get(key) ?? [] };
	}
}

/** The page's drafts, for what sits outside the page: the update notice says when reloading would lose one. */
export const pageDrafts = $state<{ current?: PaneDrafts }>({});
