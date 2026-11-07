import { loadDrafts, saveDrafts, type SavedDraft } from './storage';

/**
 * Keeps unsent drafts on this device, so a reload, or a closed tab, gives them back: each room's text and the message
 * it replies to (not staged files), for an account whose session is kept here (`webPushAccount`). Written as the tab
 * hides or goes, and as a draft is sent, rather than as it is typed, so typing costs nothing more. Only what changed
 * since this tab last read or wrote it is written, so drafts another tab keeps in other rooms stay.
 */
export class DraftKeeper {
	private account: string | undefined;
	/** Each room's draft as kept now, as this tab last read or wrote it: `''` for none. */
	private kept = new Map<string, string>();

	/** Keeping for this account, if one. */
	get active(): boolean {
		return this.account !== undefined;
	}

	/** Keeps `account`'s drafts from now on: returns those kept for it, by `room_id`, to give back. */
	start(account: string): Array<[string, SavedDraft]> {
		this.account = account;
		const saved = Object.entries(loadDrafts(account));
		this.kept = new Map(saved.map(([room, draft]) => [room, serialize(draft)]));
		return saved;
	}

	/** Keeps nothing more (signed out, or keeping history turned off). What is kept stays, or is deleted with history. */
	stop(): void {
		this.account = undefined;
		this.kept.clear();
	}

	/** Writes the drafts, by `room_id`, that changed since they were last read or written. */
	keep(drafts: Iterable<[string, SavedDraft]>): void {
		if (this.account === undefined) return;
		const changed: Record<string, SavedDraft | undefined> = {};
		let any = false;
		for (const [room, draft] of drafts) {
			const value = serialize(draft);
			if ((this.kept.get(room) ?? '') === value) continue;
			this.kept.set(room, value);
			changed[room] = value ? { text: draft.text, ...(draft.reply ? { reply: draft.reply } : {}) } : undefined;
			any = true;
		}
		if (any) saveDrafts(this.account, changed);
	}
}

/** A draft as compared and kept: `''` for one with no text and no reply. */
function serialize(draft: SavedDraft): string {
	return draft.text.trim() || draft.reply ? JSON.stringify([draft.text, draft.reply ?? null]) : '';
}
