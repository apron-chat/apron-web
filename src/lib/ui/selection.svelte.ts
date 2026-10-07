import type { ChatClient } from '$lib/protocol/client';
import { rangeBetween, spanOf } from './messages';

/** Bulk select: the messages picked in one pane (a room or a thread, itself a room), and the move they are waiting on. */
export interface Selection {
	room: string;
	ids: string[];
	/** The last message picked, so a shift-click can fill the range to it. */
	last?: string;
	saving: boolean;
	/** Set after a move the server partly denied: the messages still picked. */
	denied?: { failed: number; total: number };
}

export type MoveResult = { moved: true; room: string } | { moved: false; error: unknown };

/** What a new thread from a selection is created with: its parent room and title (from the earliest message). */
export interface NewThreadOptions {
	parentRoomId: string;
	title: (firstMessageId: string) => string;
	/** Checks the thread once it exists, before anything moves into it: an error stops the move. */
	check?: (roomId: string) => Error | undefined;
	/** Whether a picked message is yours; see MessageSelection.move. */
	own: (id: string) => boolean;
	/**
	 * Whether you may move each picked message, checked before the thread is
	 * created: the probe in `move` can only run once a thread exists, and a
	 * refused one would leave it empty.
	 */
	movable: (id: string) => boolean;
}

/** Why a new thread was not created for a selection holding a message you may not move. */
export const NOT_MOVABLE = 'You can only move your own messages, so none were moved';

/**
 * Select mode: entered with one message picked, grown by clicks and ranges,
 * and ended by a move or Cancel. Only IDs the caller offers can be picked.
 * The server decides each move, and a move is all or nothing as far as
 * permission goes: a picked message that isn't yours is tried first, alone,
 * and if the server refuses it nothing else is sent, so a conversation is
 * never split between rooms. Messages refused later (say, over a posting
 * limit) stay picked for a retry.
 */
export class MessageSelection {
	current = $state<Selection | undefined>();
	menuOpen = $state(false);
	readonly ids = $derived(this.current?.ids ?? []);
	readonly active = $derived(this.current !== undefined);

	has(id: string): boolean {
		return this.ids.includes(id);
	}

	begin(room: string, id: string): void {
		this.current = { room, ids: [id], last: id, saving: false };
	}

	/** Toggles one message, or with `range` fills from the last pick to it along `order`. */
	toggle(id: string, order: string[], range = false): void {
		const current = this.current;
		if (!current || current.saving) return;
		if (range && current.last) {
			this.current = { ...current, ids: rangeBetween(order, current.last, id), last: id, denied: undefined };
			return;
		}
		const picked = current.ids.includes(id);
		const ids = picked ? current.ids.filter((other) => other !== id) : [...current.ids, id];
		if (ids.length === 0) {
			this.cancel();
			return;
		}
		this.current = { ...current, ids, last: picked ? current.last : id, denied: undefined };
	}

	/** "Select between": fills the gap between the outermost messages already picked. */
	fillBetween(order: string[]): void {
		const current = this.current;
		if (!current || current.saving || current.ids.length < 2) return;
		this.current = { ...current, ids: spanOf(order, current.ids), denied: undefined };
	}

	cancel(): void {
		if (this.current?.saving) return;
		this.current = undefined;
		this.menuOpen = false;
	}

	/**
	 * One `message` save per picked message, each moving it to `room` (a
	 * thread, or a thread's parent room). When a picked message isn't yours
	 * (`own`), it goes first, alone: you may move someone else's message only
	 * with a role that lets you move anyone's, so if the server refuses it,
	 * nothing else is sent and the selection stays as it was. Otherwise the
	 * rest go together, and any refused stay selected.
	 */
	async move(client: ChatClient, room: string, own: (id: string) => boolean): Promise<MoveResult> {
		const current = this.current;
		if (!current || current.saving || current.ids.length === 0) return { moved: false, error: undefined };
		const ids = current.ids;
		this.current = { ...current, saving: true, denied: undefined };
		this.menuOpen = false;
		const probe = ids.find((id) => !own(id));
		if (probe !== undefined) {
			try {
				await client.moveMessage(probe, room).promise;
			} catch (error) {
				this.current = { ...current, saving: false };
				const reason = error instanceof Error ? error.message : undefined;
				return { moved: false, error: new Error(reason ? `No messages were moved: ${reason}` : 'No messages were moved') };
			}
		}
		const rest = ids.filter((id) => id !== probe);
		const settled = await Promise.allSettled(rest.map((id) => client.moveMessage(id, room).promise));
		const results = ids.map((id): PromiseSettledResult<unknown> => id === probe ? { status: 'fulfilled', value: undefined } : settled[rest.indexOf(id)]);
		const failed = ids.filter((_, index) => results[index].status === 'rejected');
		if (failed.length === 0) {
			this.current = undefined;
			return { moved: true, room };
		}
		const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		this.current = { ...current, ids: failed, last: failed[failed.length - 1], saving: false, denied: { failed: failed.length, total: ids.length } };
		return { moved: false, error: first?.reason };
	}

	/**
	 * "New thread": one fresh thread for the whole selection, titled after its
	 * earliest message in `order`. The thread is created first; the moves go
	 * out once the server has named it. The messages themselves say what it is
	 * about, so it gets no `description`.
	 */
	async moveToNewThread(client: ChatClient, order: string[], options: NewThreadOptions): Promise<MoveResult> {
		const current = this.current;
		if (!current || current.saving || current.ids.length === 0) return { moved: false, error: undefined };
		const first = [...current.ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
		// Checked before the thread exists, so a refused move leaves no empty thread behind.
		if (!current.ids.every(options.movable)) return { moved: false, error: new Error(NOT_MOVABLE) };
		this.current = { ...current, saving: true, denied: undefined };
		this.menuOpen = false;
		try {
			const result = await client.createRoom({ parentRoomId: options.parentRoomId, title: options.title(first) }).promise;
			if (typeof result.room_id !== 'string') throw new Error('Invalid room response');
			const refused = options.check?.(result.room_id);
			if (refused) throw refused;
			this.current = { ...current, saving: false };
			return await this.move(client, result.room_id, options.own);
		} catch (error) {
			this.current = { ...current, saving: false };
			return { moved: false, error };
		}
	}
}
