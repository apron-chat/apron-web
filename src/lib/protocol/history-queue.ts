/**
 * A connection's one queue of `history` requests (PROTOCOL.md §4.3): what
 * the reader is waiting for goes first, a few at a time, and nothing while a
 * history wait (`retry_after`, §1.1) is on.
 */
import { makeRequestId } from './client-internals';
import { RateLimitError, type OperationHandle } from './client-types';
import type { JsonObject } from './types';

/** How many `history` requests a connection has out at a time: servers may take only one, refusing the rest for a moment. */
export const HISTORY_CONCURRENCY = 1;

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
	resolve: (result: JsonObject) => void;
	reject: (error: Error) => void;
}

/** What the queue needs of its connection. */
export interface HistoryQueueHooks {
	/** Sends a `history` request now. */
	send: (params: JsonObject, allowBeforeAuth: boolean) => OperationHandle;
	/** Takes back a sent request: it rejects with `reason`, and an answer to it is ignored. */
	abort: (requestId: string, reason: string) => void;
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
 * back to) or the open room's, then the other rooms', in the order asked. A
 * server may take only one at a time from a connection, and refuse the rest.
 * While a history wait is on, nothing goes until it is over (`pump` again):
 * the server would only refuse it, and each refusal still costs it a frame.
 */
export class HistoryQueue {
	private readonly jobs = new Map<string, HistoryJob>();
	private readonly concurrency: number;

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

	/** Takes back a request, sent or held: it rejects with `reason`, and an answer to it is ignored. */
	cancel(id: string, reason: string): void {
		const job = this.jobs.get(id);
		if (!job) return;
		this.jobs.delete(id);
		if (job.requestId !== undefined) this.hooks.abort(job.requestId, reason);
		job.reject(new Error(reason));
		if (job.requestId !== undefined) this.pump();
	}

	/** Every held request fails with `reason`: the connection it was for is gone. Sent ones fail with their requests. */
	dropHeld(reason: string): void {
		for (const job of [...this.jobs.values()]) if (job.requestId === undefined) this.cancel(job.id, reason);
	}

	private send(job: HistoryJob): void {
		const request = this.hooks.send(job.params, job.allowBeforeAuth);
		job.requestId = request.id;
		request.promise.then((result) => {
			if (this.jobs.get(job.id) !== job) return;
			this.jobs.delete(job.id);
			job.resolve(result);
			this.pump();
		}, (cause: Error) => {
			if (this.jobs.get(job.id) !== job) return;
			job.requestId = undefined;
			if (job.retry && cause instanceof RateLimitError && this.hooks.limited()) {
				// Held, in its place in the queue, until the wait is over, then sent again.
				this.hooks.emit();
				return;
			}
			this.jobs.delete(job.id);
			job.reject(cause);
			this.pump();
		});
	}
}
