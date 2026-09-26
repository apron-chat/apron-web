/**
 * The composer's text and reply target, kept per destination: each room, and
 * each thread, since a thread is a room of its own. Keys are opaque to this
 * class; the page keys by server and `room_id`.
 */
export class PaneDrafts {
	/** The open pane's draft, bound to the composer. */
	text = $state('');
	/** The `message_id` the open pane's draft replies to. */
	reply = $state<string | undefined>();
	private key: string | undefined;
	private readonly texts = new Map<string, string>();
	private readonly replies = new Map<string, string | undefined>();

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
	}

	/** Keeps the open pane's draft and reply. */
	save(): void {
		if (this.key === undefined) return;
		this.texts.set(this.key, this.text);
		this.replies.set(this.key, this.reply);
	}

	/** Keeps the open pane's text as it is typed. */
	saveText(): void {
		if (this.key !== undefined) this.texts.set(this.key, this.text);
	}

	setReply(messageId: string | undefined): void {
		this.reply = messageId;
		this.save();
	}

	/** Empties the composer and `key`'s kept draft, once it has been sent. */
	clear(key: string): void {
		this.text = '';
		this.reply = undefined;
		this.texts.set(key, '');
		this.replies.set(key, undefined);
	}

	/**
	 * A failed send gives `key`'s draft back, unless something else has been
	 * typed there since; the composer shows it again when `key` is still open
	 * and empty. Returns whether it did.
	 */
	restore(key: string, text: string, reply: string | undefined): boolean {
		const open = this.key === key;
		if (!this.texts.get(key) && !this.replies.get(key) && !(open && (this.text || this.reply))) {
			this.texts.set(key, text);
			this.replies.set(key, reply);
		}
		if (!open || this.text || this.reply) return false;
		this.text = this.texts.get(key) ?? '';
		this.reply = this.replies.get(key);
		return true;
	}
}
