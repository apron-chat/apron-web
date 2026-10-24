/**
 * A connection's one queue of `history` requests (PROTOCOL.md §4.3): what
 * the reader is waiting for goes first, a few at a time, and nothing while a
 * history wait (`retry_after`, §1.1) is on.
 */
import { makeRequestId, RequestTimeout } from './client-internals';
import { RateLimitError, type OperationHandle } from './client-types';
import type { JsonObject } from './types';

/**
 * How many `history` requests a connection has out at a time: one, a client
 * choice. Servers may answer in any order (§1) and may rate-limit any request
 * (§1.1), so paging one at a time keeps a recovery's requests few and in
 * order, what the reader waits for first.
 */
export const HISTORY_CONCURRENCY = 1;
/**
 * How long a `history` request that timed out still counts as out, unless
 * its answer comes first: the server may be working on it yet, and the next
 * would only pile on. After that its answer is presumed lost.
 */
export const LATE_ANSWER_MS = 10_000;

/**
 * A `history` request (§4.3): sent when its turn comes and no history wait
 * is on (`requestId` while in flight), held until then. One with `retry`
 * refused for a wait waits it out and goes again instead of failing.
 */
export interface HistoryJob {
	id: string;
	roomId: string;
	params: JsonObject;
	allowBeforeAuth: boolean;
	retry: boolean;
	requestId?: string;
	/** Its caller has its answer already (taken back, or timed out): sent, it still counts as out until the server answers. */
	settled?: boolean;
	/** Timed out: out until its late answer (`answered`) or LATE_ANSWER_MS. */
	late?: ReturnType<typeof setTimeout>;
	resolve: (result: JsonObject) => void;
	reject: (error: Error) => void;
}

/** What the queue needs of its connection. */
export interface HistoryQueueHooks {
	/** Sends a `history` request now. */
	send: (params: JsonObject, allowBeforeAuth: boolean) => OperationHandle;
	/** Whether a history wait is on. */
	limited: () => boolean;
	/** The room the reader has open, whose history goes first. */
	activeRoomId: () => string | undefined;
	/** A job is held for a wait: nothing answered, but the state changed. */
	emit: () => void;
}

/**
 * Every `history` request not yet answered, by its handle's id, in the order
 * asked. `concurrency` are out at a time, what the reader is waiting for
 * first: a load asked for (`retry`: a thread opened, older pages scrolled
 * back to) or the open room's, then the other rooms', in the order asked.
 * One sent stays out until the server answers it, even once taken back or
 * timed out (for a while), so the pace holds. While a history wait is on
 * (a `history` refused with `retry_after`, §1.1), nothing goes until it is
 * over (`pump` again): the server asked for the wait.
 */
export class HistoryQueue {
	private readonly jobs = new Map<string, HistoryJob>();
	private readonly concurrency: number;
	/** Pumps again when a wait that held a job back is over but no longer the connection's (`limited`). */
	private wake?: ReturnType<typeof setTimeout>;

	constructor(private readonly hooks: HistoryQueueHooks, concurrency = HISTORY_CONCURRENCY) {
		this.concurrency = Math.max(1, concurrency);
	}

	/** Queues a `history` request for a room. With `retry`, one refused for a wait waits it out and goes again rather than failing. */
	request(roomId: string, params: JsonObject, options: { allowBeforeAuth?: boolean; retry?: boolean } = {}): OperationHandle {
		const id = makeRequestId('history');
		let resolve!: (result: JsonObject) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<JsonObject>((onResult, onError) => {
			resolve = onResult;
			reject = onError;
		});
		const job: HistoryJob = { id, roomId, params, allowBeforeAuth: options.allowBeforeAuth ?? false, retry: options.retry ?? false, resolve, reject };
		this.jobs.set(id, job);
		this.pump();
		return { id, promise };
	}

	/** The job for a handle's id while it waits its turn, not yet sent: its `params` may still change. */
	queued(id: string): HistoryJob | undefined {
		const job = this.jobs.get(id);
		return job && job.requestId === undefined ? job : undefined;
	}

	/** Whether a request for `roomId` is held: waiting its turn, or for a wait to end. */
	holds(roomId: string): boolean {
		for (const job of this.jobs.values()) if (job.roomId === roomId && job.requestId === undefined) return true;
		return false;
	}

	/** Sends the next queued requests while there is room for them and no history wait is on. */
	pump(): void {
		if (this.hooks.limited()) return;
		const active = this.hooks.activeRoomId();
		const urgent = (job: HistoryJob) => job.retry || job.roomId === active;
		let out = 0;
		for (const job of this.jobs.values()) if (job.requestId !== undefined) out += 1;
		while (out < this.concurrency) {
			let next: HistoryJob | undefined;
			for (const job of this.jobs.values()) {
				if (job.requestId !== undefined) continue;
				if (urgent(job)) {
					next = job;
					break;
				}
				next ??= job;
			}
			if (!next) return;
			this.send(next);
			out += 1;
		}
	}

	/**
	 * Takes back a request: it rejects with `reason` now. One held never goes;
	 * one sent is out until the server answers it, and the answer is ignored.
	 */
	cancel(id: string, reason: string): void {
		const job = this.jobs.get(id);
		if (!job || job.settled) return;
		if (job.requestId === undefined) this.jobs.delete(id);
		else job.settled = true;
		job.reject(new Error(reason));
	}

	/** Takes back every request held for `roomId`: what they were for is gone (the room left, or rebuilt). */
	dropRoom(roomId: string, reason: string): void {
		for (const job of [...this.jobs.values()]) if (job.roomId === roomId && job.requestId === undefined) this.cancel(job.id, reason);
	}

	/**
	 * The connection is gone: every held request fails with `reason`, and one
	 * that timed out is out no longer. Sent ones fail with their requests.
	 */
	dropHeld(reason: string): void {
		clearTimeout(this.wake);
		this.wake = undefined;
		for (const job of [...this.jobs.values()]) {
			if (job.requestId === undefined) this.cancel(job.id, reason);
			else if (job.late !== undefined) {
				clearTimeout(job.late);
				this.jobs.delete(job.id);
			}
		}
	}

	/** The server answered a request after it timed out: its place is free. */
	answered(requestId: string): void {
		for (const job of this.jobs.values()) if (job.requestId === requestId && job.late !== undefined) return this.free(job);
	}

	private free(job: HistoryJob): void {
		clearTimeout(job.late);
		if (this.jobs.get(job.id) !== job) return;
		this.jobs.delete(job.id);
		this.pump();
	}

	private send(job: HistoryJob): void {
		const request = this.hooks.send(job.params, job.allowBeforeAuth);
		job.requestId = request.id;
		request.promise.then((result) => {
			if (this.jobs.get(job.id) !== job) return;
			this.jobs.delete(job.id);
			if (!job.settled) job.resolve(result);
			this.pump();
		}, (cause: Error) => {
			if (this.jobs.get(job.id) !== job) return;
			if (cause instanceof RequestTimeout) {
				// The server may be working on it still: out until it answers, or for a while.
				if (!job.settled) job.reject(cause);
				job.settled = true;
				job.late = setTimeout(() => this.free(job), LATE_ANSWER_MS);
				return;
			}
			if (!job.settled && job.retry && cause instanceof RateLimitError && cause.scope === 'history') {
				// Held, in its place in the queue, until the wait is over, then sent again: by the wait's
				// end (`pump`), or here when the refusal's wait isn't the connection's (none, or over already).
				job.requestId = undefined;
				if (!this.hooks.limited()) {
					clearTimeout(this.wake);
					this.wake = setTimeout(() => {
						this.wake = undefined;
						this.pump();
					}, Math.max(0, cause.retryAt - Date.now()));
				}
				this.hooks.emit();
				return;
			}
			this.jobs.delete(job.id);
			if (!job.settled) job.reject(cause);
			this.pump();
		});
	}
}
