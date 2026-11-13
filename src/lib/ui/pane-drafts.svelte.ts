import type { UploadFile } from '$lib/protocol/client';
import { writtenRoles } from '$lib/protocol/markdown';

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

/**
 * The composer's text, reply target, staged files and removed link previews, kept per destination:
 * each room, and each thread, since a thread is a room of its own. Keys are
 * opaque to this class; the page keys by server and `room_id`.
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
	/** The `message_id` the open pane's draft replies to. */
	reply = $state<string | undefined>();
	/** The files the open pane's draft will be sent with, in order. */
	files = $state.raw<StagedFile[]>([]);
	/** The link previews removed from the open pane's draft, by URL: it goes out without them. */
	dismissed = $state.raw<string[]>([]);
	private key: string | undefined;
	private readonly texts = new Map<string, string>();
	private readonly replies = new Map<string, string | undefined>();
	private readonly staged = new Map<string, StagedFile[]>();
	private readonly dismissals = new Map<string, string[]>();

	/** The open pane's key, if a pane is open. */
	get current(): string | undefined {
		return this.key;
	}

	/** Keeps the open pane's draft and shows `key`'s, or an empty one when there's no pane. */
	open(key: string | undefined): void {
		this.save();
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
	}

	/**
	 * Empties `key`'s kept text and reply, and the composer's when `key` is open: they went out some other way, as a
	 * live message. Staged files stay.
	 */
	forget(key: string): void {
		this.texts.set(key, '');
		this.replies.set(key, undefined);
		this.dismissals.set(key, []);
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
		if (!this.texts.get(key) && !this.replies.get(key) && !this.staged.get(key)?.length && !(open && this.busy())) {
			this.texts.set(key, text);
			this.replies.set(key, reply);
			this.staged.set(key, files);
			this.dismissals.set(key, dismissed);
		}
		if (!open || this.busy()) return false;
		this.text = this.texts.get(key) ?? '';
		this.reply = this.replies.get(key);
		this.files = this.staged.get(key) ?? [];
		this.dismissed = this.dismissals.get(key) ?? [];
		return true;
	}

	/**
	 * Some draft has text or files that reloading would lose: the open pane's,
	 * or one kept for another. Reactive through the open pane's, which every
	 * kept draft passes through.
	 */
	get unsent(): boolean {
		if (this.text.trim() || this.files.length) return true;
		for (const [key, text] of this.texts) if (key !== this.key && text.trim()) return true;
		for (const [key, files] of this.staged) if (key !== this.key && files.length) return true;
		return false;
	}

	/** The open pane's draft has something in it. */
	private busy(): boolean {
		return Boolean(this.text || this.reply || this.files.length);
	}
}

/** The page's drafts, for what sits outside the page: the update notice says when reloading would lose one. */
export const pageDrafts = $state<{ current?: PaneDrafts }>({});
