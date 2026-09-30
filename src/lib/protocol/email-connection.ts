import { CLIENT_NAME, PING_FRAME, REQUEST_TIMEOUT_MS, makeRequestId, userFacingRpcError } from './client-internals';
import type { WebSocketFactory } from './client-types';
import { isJsonObject, type JsonObject, type RpcError, type WireFrame } from './types';

/**
 * The longest a proposal connection stays open waiting for its code. A
 * proposal expires within minutes (PROTOCOL.md §4.10), so one still open past
 * this has nothing left to approve.
 */
export const EMAIL_PROPOSAL_MS = 15 * 60_000;

/** An error with the JSON-RPC `code` the server gave, if any. */
export type RpcFailure = Error & { code?: number };

/**
 * A connection of its own for an email sign-in (§4.10), never signed in
 * until the approval: it waits for the `server` frame, proposes signing in
 * with an address, and stays open while the user types the code, because a
 * short code works only on the connection that made the proposal. The
 * approval (`request` with the token) signs it in; `detach` then hands the
 * open socket, its `server` frame, and whatever arrived after the approval to
 * the client, which carries on with it as its main connection.
 *
 * It sends nothing but these `auth` requests and, when the server asks for
 * them, pings. Anything else the server sends before the approval, such as a
 * `~private` notice, is for this throwaway connection and is dropped.
 */
export class EmailConnection {
	/** The `server` frame's params, once greeted. */
	server?: JsonObject;
	/** Why it closed, once it has. */
	closed?: Error;
	/** Called once, when it closes or is closed (not when detached). */
	onClose?: () => void;
	private readonly pending = new Map<string, { resolve: (result: JsonObject) => void; reject: (cause: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private greeted?: { resolve: () => void; reject: (cause: Error) => void };
	/** Frames after a signing-in result, for the client to process once it takes over. */
	private buffered?: unknown[];
	private pingTimer?: ReturnType<typeof setInterval>;
	private lifetime: ReturnType<typeof setTimeout>;
	private detached = false;

	/** Resolves once the `server` frame has arrived; rejects if the connection closes first, or it takes too long. */
	readonly ready: Promise<void>;

	private constructor(readonly url: string, private readonly socket: WebSocket) {
		this.lifetime = setTimeout(() => this.close(new Error('The code has expired; send a new one')), EMAIL_PROPOSAL_MS);
		this.ready = new Promise((resolve, reject) => {
			const timer = setTimeout(() => this.close(new Error('The server didn’t answer; try again')), REQUEST_TIMEOUT_MS);
			this.greeted = {
				resolve: () => {
					clearTimeout(timer);
					resolve();
				},
				reject: (cause) => {
					clearTimeout(timer);
					reject(cause);
				}
			};
		});
		// Nobody may be waiting on it by the time it fails.
		this.ready.catch(() => undefined);
		socket.onmessage = (event: MessageEvent) => this.receive(event.data);
		socket.onclose = () => this.finish(new Error('The connection to the server closed; try again'));
		socket.onerror = () => this.finish(new Error('Unable to reach the server'));
	}

	/**
	 * Opens a connection to `url`; its `ready` resolves once the `server`
	 * frame arrives. Throws if the socket can't be made at all.
	 */
	static open(factory: WebSocketFactory, url: string): EmailConnection {
		return new EmailConnection(url, factory(url));
	}

	/** Whether the server offers `scheme` to sign in (`auth`) or to sign up (`signup`, §3.1). */
	offers(scheme: string): boolean {
		const listed = (key: string) => Array.isArray(this.server?.[key]) && (this.server![key] as unknown[]).includes(scheme);
		return listed('auth') || listed('signup');
	}

	/**
	 * Sends an `auth` and resolves with its result, or rejects with the
	 * server's error (its `code` attached), a timeout, or the connection
	 * closing. A result carrying `you` signed this connection in: from then on
	 * its frames are kept for `detach`.
	 */
	auth(params: JsonObject): Promise<JsonObject> {
		if (this.closed) return Promise.reject(this.closed);
		const id = makeRequestId('auth');
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error('The server didn’t answer; try again'));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			this.socket.send(JSON.stringify({ method: 'auth', id, params: { ...params, client: CLIENT_NAME } }));
		});
	}

	/**
	 * Hands over the open, signed-in socket, its `server` frame, and the
	 * frames that arrived since the sign-in, in order. The connection lets go
	 * of the socket's handlers; the caller sets its own.
	 */
	detach(): { socket: WebSocket; server: JsonObject; frames: unknown[] } {
		this.detached = true;
		this.stop();
		const frames = this.buffered ?? [];
		this.buffered = undefined;
		return { socket: this.socket, server: this.server ?? {}, frames };
	}

	/** Closes it, failing anything still waiting with `cause`. */
	close(cause: Error = new Error('Cancelled')): void {
		if (this.closed || this.detached) return;
		const socket = this.socket;
		this.finish(cause);
		if (socket.readyState !== 3 /* CLOSED */) socket.close(1000, 'done');
	}

	private receive(data: unknown): void {
		if (this.buffered) {
			this.buffered.push(data);
			return;
		}
		let frame: WireFrame;
		try {
			frame = JSON.parse(String(data)) as WireFrame;
		} catch {
			return;
		}
		if (!isJsonObject(frame)) return;
		if (frame.method === 'server' && isJsonObject(frame.params) && Array.isArray(frame.params.auth)) {
			this.server = frame.params;
			this.startPing();
			this.greeted?.resolve();
			this.greeted = undefined;
			return;
		}
		if (frame.method !== undefined || typeof frame.id !== 'string') return;
		const request = this.pending.get(frame.id);
		if (!request) return;
		this.pending.delete(frame.id);
		clearTimeout(request.timer);
		if (isJsonObject(frame.error)) {
			const failure: RpcFailure = new Error(userFacingRpcError(frame.error as RpcError));
			failure.code = (frame.error as RpcError).code;
			request.reject(failure);
			return;
		}
		const result = isJsonObject(frame.result) ? frame.result : {};
		// Signed in: what follows belongs to the client that takes this connection over.
		if (isJsonObject(result.you)) this.buffered = [];
		request.resolve(result);
	}

	private startPing(): void {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = undefined;
		const seconds = this.server?.ping;
		if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return;
		this.pingTimer = setInterval(() => {
			if (this.socket.readyState === 1 /* OPEN */) this.socket.send(PING_FRAME);
		}, Math.max(1, seconds) * 1_000);
	}

	private stop(): void {
		clearTimeout(this.lifetime);
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = undefined;
		this.socket.onmessage = null;
		this.socket.onclose = null;
		this.socket.onerror = null;
	}

	private finish(cause: Error): void {
		if (this.closed || this.detached) return;
		this.closed = cause;
		this.stop();
		this.greeted?.reject(cause);
		this.greeted = undefined;
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(cause);
		}
		this.pending.clear();
		this.onClose?.();
	}
}
