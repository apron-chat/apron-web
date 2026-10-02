import type { UploadFile } from '$lib/protocol/client';

/**
 * A file attached to a draft but not sent yet (capability `embed:upload`,
 * §4.6.4): it goes out as an `upload` embed with the draft's text.
 */
export interface StagedFile {
	/** Local to this page, for removing it before sending. */
	id: string;
	/** The file as picked, pasted or recorded; what the composer previews. */
	file: File;
	/** The file as it will be written: images shrunk and stripped of metadata. */
	prepared: Promise<UploadFile>;
}

/**
 * The composer's text, reply target and staged files, kept per destination:
 * each room, and each thread, since a thread is a room of its own. Keys are
 * opaque to this class; the page keys by server and `room_id`.
 */
export class PaneDrafts {
	/** The open pane's draft, bound to the composer. */
	text = $state('');
	/** The `message_id` the open pane's draft replies to. */
	reply = $state<string | undefined>();
	/** The files the open pane's draft will be sent with, in order. */
	files = $state.raw<StagedFile[]>([]);
	private key: string | undefined;
	private readonly texts = new Map<string, string>();
	private readonly replies = new Map<string, string | undefined>();
	private readonly staged = new Map<string, StagedFile[]>();

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
	}

	/** Keeps the open pane's draft and reply. */
	save(): void {
		if (this.key === undefined) return;
		this.texts.set(this.key, this.text);
		this.replies.set(this.key, this.reply);
		this.staged.set(this.key, this.files);
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

	/** Empties the composer and `key`'s kept draft, once it has been sent. */
	clear(key: string): void {
		this.text = '';
		this.reply = undefined;
		this.files = [];
		this.texts.set(key, '');
		this.replies.set(key, undefined);
		this.staged.set(key, []);
	}

	/**
	 * A failed send gives `key`'s draft back, unless something else has been
	 * typed or attached there since; the composer shows it again when `key`
	 * is still open and empty. Returns whether it did.
	 */
	restore(key: string, text: string, reply: string | undefined, files: StagedFile[] = []): boolean {
		const open = this.key === key;
		if (!this.texts.get(key) && !this.replies.get(key) && !this.staged.get(key)?.length && !(open && this.busy())) {
			this.texts.set(key, text);
			this.replies.set(key, reply);
			this.staged.set(key, files);
		}
		if (!open || this.busy()) return false;
		this.text = this.texts.get(key) ?? '';
		this.reply = this.replies.get(key);
		this.files = this.staged.get(key) ?? [];
		return true;
	}

	/** The open pane's draft has something in it. */
	private busy(): boolean {
		return Boolean(this.text || this.reply || this.files.length);
	}
}
