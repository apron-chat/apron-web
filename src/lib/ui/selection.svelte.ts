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

/**
 * `room`, on a failure: the new thread, which exists although nothing (or not
 * everything) moved into it. `unadded`: the authors of moved messages the
 * server didn't add to the thread, and the first reason.
 */
export type MoveResult = ({ moved: true; room: string } | { moved: false; error: unknown; room?: string }) & { unadded?: { failed: number; total: number; error: unknown } };

/**
 * Adding the authors of messages moved into a thread to it (`room_join` with
 * their `user_id`, §4.2.2), so they still see their messages there: a thread
 * delivers to its members only.
 */
export interface MoveAuthors {
	/** The `user_id` of a picked message's author, when known. */
	of: (id: string) => string | undefined;
	/** Whether a user needn't be added to `room`: yourself, or someone already in it. */
	skip: (userId: string, room: string) => boolean;
}

/** What a new thread from a selection is created with: its parent room, and the title and description asked for. */
export interface NewThreadOptions {
	parentRoomId: string;
	title: string;
	description?: string;
	/** Checks the thread once it exists, before anything moves into it: an error stops the move. */
	check?: (roomId: string) => Error | undefined;
	/** Whether a picked message is yours; see MessageSelection.move. */
	own: (id: string) => boolean;
	/** Who wrote the picked messages, to add them to the thread once their messages are in it. */
	authors?: MoveAuthors;
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
	current = $state.raw<Selection | undefined>();
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

	/**
	 * Shift+↑ or Shift+↓ from the keyboard: the picked messages become those from `anchor` (where the run of keys
	 * began) to `id`, both included, so stepping back the other way gives them up again.
	 */
	extend(anchor: string, id: string, order: string[]): void {
		const current = this.current;
		if (!current || current.saving) return;
		this.current = { ...current, ids: rangeBetween(order, anchor, id), last: id, denied: undefined };
	}

	/** "Select between": fills the gap between the outermost messages already picked. */
	fillBetween(order: string[]): void {
		const current = this.current;
		if (!current || current.saving || current.ids.length < 2) return;
		this.current = { ...current, ids: spanOf(order, current.ids), denied: undefined };
	}

	/** Cancel: ends select mode, unless a move is under way, which ends it itself. */
	cancel(): void {
		if (this.current?.saving) return;
		this.leave();
	}

	/**
	 * Ends select mode whatever it is doing, for when what it picked from goes: another pane, another server,
	 * a role that no longer moves messages. A move under way goes on at the server, and changes nothing here
	 * when it settles (`settle`).
	 */
	leave(): void {
		this.current = undefined;
		this.menuOpen = false;
	}

	/**
	 * Saving `saving` is over: select mode becomes `next`, if it is still the selection that was saving. Anything
	 * since (`leave`, a new `begin`) stands, so a move's late reply never brings back a selection that went.
	 */
	private settle(saving: Selection, next: Selection | undefined): void {
		if (this.current === saving) this.current = next;
	}

	/**
	 * One `message` save per picked message, each moving it to `room` (a
	 * thread, or a thread's parent room). When a picked message isn't yours
	 * (`own`), it goes first, alone: you may move someone else's message only
	 * with a role that lets you move anyone's, so if the server refuses it,
	 * nothing else is sent and the selection stays as it was. Otherwise the
	 * rest go together, and any refused stay selected. With `authors` (a move
	 * into a thread), the authors of the messages that moved who aren't in it
	 * yet are then added to it, so the conversation's people come with it.
	 */
	async move(client: ChatClient, room: string, own: (id: string) => boolean, authors?: MoveAuthors): Promise<MoveResult> {
		const current = this.current;
		if (!current || current.saving || current.ids.length === 0) return { moved: false, error: undefined };
		return this.#move(client, room, own, authors, current, true);
	}

	/**
	 * The moves of `current`'s messages into `room`, as `move` says. Once asked for, they go on to the end at the
	 * server whatever happens here; select mode follows them only while it shows `current` (`shown`, `settle`).
	 */
	async #move(client: ChatClient, room: string, own: (id: string) => boolean, authors: MoveAuthors | undefined, current: Selection, shown: boolean): Promise<MoveResult> {
		const ids = current.ids;
		const saving: Selection = { ...current, saving: true, denied: undefined };
		if (shown) {
			this.current = saving;
			this.menuOpen = false;
		}
		const probe = ids.find((id) => !own(id));
		if (probe !== undefined) {
			try {
				await client.moveMessage(probe, room).promise;
			} catch (error) {
				this.settle(saving, { ...current, saving: false });
				const reason = error instanceof Error ? error.message : undefined;
				return { moved: false, error: new Error(reason ? `No messages were moved: ${reason}` : 'No messages were moved') };
			}
		}
		const rest = ids.filter((id) => id !== probe);
		const settled = await Promise.allSettled(rest.map((id) => client.moveMessage(id, room).promise));
		const results = ids.map((id): PromiseSettledResult<unknown> => id === probe ? { status: 'fulfilled', value: undefined } : settled[rest.indexOf(id)]);
		const failed = ids.filter((_, index) => results[index].status === 'rejected');
		const added = authors ? await addAuthors(client, room, ids.filter((id) => !failed.includes(id)), authors) : undefined;
		const unadded = added ? { unadded: added } : {};
		if (failed.length === 0) {
			this.settle(saving, undefined);
			return { moved: true, room, ...unadded };
		}
		const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		this.settle(saving, { ...current, ids: failed, last: failed[failed.length - 1], saving: false, denied: { failed: failed.length, total: ids.length } });
		return { moved: false, error: first?.reason, ...unadded };
	}

	/** The picked message that comes first along `order`, which a new thread's title is suggested from. */
	earliest(order: string[]): string | undefined {
		return [...this.ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
	}

	/**
	 * Whether every picked message may be moved: checked before a new thread is
	 * asked for or created, since the probe in `move` can only run once a thread
	 * exists, and a refused one would leave it empty.
	 */
	checkMovable(movable: (id: string) => boolean): Error | undefined {
		return this.ids.length > 0 && this.ids.every(movable) ? undefined : new Error(NOT_MOVABLE);
	}

	/**
	 * "New thread": one fresh thread for the whole selection, with the title
	 * and description asked for. The thread is created first; the moves go out
	 * once the server has named it. A failure after it exists names it in
	 * `room`.
	 */
	async moveToNewThread(client: ChatClient, options: NewThreadOptions): Promise<MoveResult> {
		const current = this.current;
		if (!current || current.saving || current.ids.length === 0) return { moved: false, error: undefined };
		// Checked before the thread exists, so a refused move leaves no empty thread behind.
		const unmovable = this.checkMovable(options.movable);
		if (unmovable) return { moved: false, error: unmovable };
		const saving: Selection = { ...current, saving: true, denied: undefined };
		this.current = saving;
		this.menuOpen = false;
		let room: string | undefined;
		try {
			const result = await client.createRoom({ parentRoomId: options.parentRoomId, title: options.title, ...(options.description ? { description: options.description } : {}) }).promise;
			if (typeof result.room_id !== 'string') throw new Error('Invalid room response');
			room = result.room_id;
			const refused = options.check?.(room);
			if (refused) throw refused;
			// Asked for, the moves go on into the thread even if select mode has gone meanwhile, rather than leave it empty.
			const moved = await this.#move(client, room, options.own, options.authors, current, this.current === saving);
			return moved.moved ? moved : { ...moved, room };
		} catch (error) {
			this.settle(saving, { ...current, saving: false });
			return { moved: false, error, ...(room !== undefined ? { room } : {}) };
		}
	}
}

/**
 * Adds the authors of the `moved` messages to `room` (`room_join` with each
 * `user_id`, §4.2.2), once each and leaving out those `skip` names. Who may
 * add whom is server policy (a guest can't be added at all), so a refusal
 * changes nothing else: what comes back is how many weren't added, or
 * nothing when everyone was.
 */
async function addAuthors(client: ChatClient, room: string, moved: string[], authors: MoveAuthors): Promise<{ failed: number; total: number; error: unknown } | undefined> {
	const users = [...new Set(moved.map(authors.of))].filter((user): user is string => user !== undefined && !user.startsWith('~') && !authors.skip(user, room));
	const settled = await Promise.allSettled(users.map((user) => client.joinRoom(room, user).promise));
	const refused = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
	return refused.length ? { failed: refused.length, total: users.length, error: refused[0].reason } : undefined;
}
