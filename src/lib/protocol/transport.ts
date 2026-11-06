/**
 * The client's connection to its server as sockets come and go (PROTOCOL.md §1): opening each one, watching that it
 * still answers, and making the next. `ChatClient` reads every frame, signs in, and keeps the session; this keeps
 * only the sockets, through `TransportHooks`.
 *
 * A socket opens (`openingUntil`), within `openingWait`, until its `server` frame greets the client (`greeted`), which
 * signs it in; signed in and up for `STABLE_CONNECTION_MS` (`stayUp`), the backoff starts over. From the greeting on,
 * pings watch it, and a page shown again or the network back probes it (`probe`), with a standby beside it after a
 * long absence, which takes over at once should it greet first (`replaceQuietSocket`). Between sockets a reconnect
 * waits out its backoff (`scheduleReconnect`), the server's hold or wait (`held`, `retryAfter`), or the page's
 * absence (`waitForPresence`).
 */
import {
	MAX_UNANSWERED_PINGS,
	OPENING_MS,
	PING_FRAME,
	PROBE_AFTER_HIDDEN_MS,
	PROBE_MS,
	PROBE_PATIENT_FOR_MS,
	PROBE_PATIENT_MS,
	RETRY_AFTER_MAX_MS,
	STABLE_CONNECTION_MS,
	STANDBY_AFTER_HIDDEN_MS,
	STANDBY_AFTER_MS,
	absent,
	pageHidden,
	reconnectDelay
} from './client-internals';
import type { ChatClientOptions, WebSocketFactory } from './client-types';
import type { EarlyConnection } from './early-connection';
import { isJsonObject } from './types';

/** What the transport needs of its client. */
export interface TransportHooks {
	/** The server's address, to connect to. */
	url: () => string;
	/** The server holds reconnecting (`denied`, or a sign-in that waits for the user): nothing reconnects on its own. */
	held: () => boolean;
	/** What is left of a wait the server asked for (`retry_after`, §1.1), if one is on. */
	retryAfter: () => number | undefined;
	/** The server's ping interval in seconds (§3.1), where it pings. */
	ping: () => number | undefined;
	/** The next connection starts, its id taken; `reconnecting`: the backoff has run since it last started over. */
	connecting: (reconnecting: boolean) => void;
	/** The current socket has opened. */
	opened: () => void;
	/** A frame on the current socket. */
	frame: (data: unknown) => void;
	/** A socket reported an error; `current`: the current one. */
	errored: (current: boolean) => void;
	/** The current socket closed, or was dropped as if it had: its connection ends. A reconnect and `emit` follow. */
	closed: () => void;
	/** The next socket couldn't be made, for `message`. A reconnect and `emit` follow. */
	failed: (message: string) => void;
	/** The server said why a handshake failed (EXT.md §5): `message`, and how long to wait, `until`. */
	refused: (message: string, until: number | undefined) => void;
	/** The page was shown or hidden. */
	visibilityChanged: () => void;
	emit: () => void;
}

export class Transport {
	#current?: WebSocket;
	/** Where the first connection may come from, opened before the client was made (`ChatClientOptions.earlyConnection`); asked once. */
	#earlyConnection?: ChatClientOptions['earlyConnection'];
	#reconnectTimer?: ReturnType<typeof setTimeout>;
	#pingTimer?: ReturnType<typeof setInterval>;
	/** Resets the reconnect backoff once the current connection has stayed up. */
	#stableTimer?: ReturnType<typeof setTimeout>;
	/** Resumes connecting when the page is shown or the network returns; set while waiting for either. */
	#presenceWaiter?: () => void;
	/** Pings sent on the current socket since its last `pong`. */
	#unansweredPings = 0;
	/** A probe's ping waits for an answer (`patientOr(PROBE_MS)`): without one, the socket is dropped. */
	#probeTimer?: ReturnType<typeof setTimeout>;
	/** When a socket was last replaced for staying quiet: a probe it didn't answer, or an opening that ran out. */
	#quietDroppedAt?: number;
	/** The current socket has `openingWait` to open and bring its `server` frame (§3.1), or it is replaced. */
	#openingTimer?: ReturnType<typeof setTimeout>;
	/** Until when the current socket may take to open (`openingWait` from its start), until its `server` frame came. */
	#openingUntil?: number;
	/**
	 * A socket opened beside the one a probe checks after a long absence (`probe`), sending nothing, as the app's
	 * early connection does: `probed` answering first closes it, and its `server` frame coming first, a whole
	 * handshake before one ping's answer, means `probed` is gone: it takes over at once, the handshake done.
	 * It touches nothing of the client's but this until it takes over, through `connectNow` as a new connection.
	 */
	#standby?: { socket: WebSocket; probed: WebSocket; frames: unknown[] };
	/** The probe's wait (`STANDBY_AFTER_MS`) before it opens the standby. */
	#standbyTimer?: ReturnType<typeof setTimeout>;
	/** When the page was last hidden, while it still is. */
	#hiddenAt?: number;
	/** Drops the current socket as if it had closed: for one that stopped answering, `reason` its close's. */
	#abandonSocket?: (reason: string) => void;
	#connectionId = 0;
	#reconnectAttempt = 0;
	#isRunning = false;
	#connectionProbe?: AbortController;
	/**
	 * The page shown or hidden, for as long as the client runs: a page shown again checks that its socket still
	 * answers, and the client hears of it (`visibilityChanged`).
	 */
	readonly #visibilityChanged = (): void => {
		if (pageHidden()) {
			this.#hiddenAt ??= this.#now();
		} else {
			const away = this.#hiddenAt === undefined ? 0 : this.#now() - this.#hiddenAt;
			this.#hiddenAt = undefined;
			// One still opening may have outrun its wait while hidden pages' timers were held back: the next goes now,
			// as it would have once shown, had its timer run.
			if (this.#openingUntil !== undefined && this.#now() >= this.#openingUntil) this.#replaceOpening('opening timed out', false);
			else if (away >= PROBE_AFTER_HIDDEN_MS) this.#probe(away >= STANDBY_AFTER_HIDDEN_MS);
		}
		this.#hooks.visibilityChanged();
	};
	/**
	 * The network back: the socket may not have survived it, and an open one is probed, with a standby. What failed
	 * or is still opening did so on the network that went (nothing opens while the browser is offline): the next
	 * connection goes now, its backoff from the start.
	 */
	readonly #networkReturned = (): void => {
		if (this.#current && this.#openingUntil === undefined) this.#probe(true);
		else this.#replaceOpening('network changed', true);
	};

	readonly #hooks: TransportHooks;
	readonly #webSocketFactory: WebSocketFactory;
	readonly #now: () => number;

	constructor(hooks: TransportHooks, webSocketFactory: WebSocketFactory, now: () => number, earlyConnection?: ChatClientOptions['earlyConnection']) {
		this.#hooks = hooks;
		this.#webSocketFactory = webSocketFactory;
		this.#now = now;
		this.#earlyConnection = earlyConnection;
	}

	/** The current connection's socket, from its start until it ends (`drop`). */
	get socket(): WebSocket | undefined {
		return this.#current;
	}

	/** The current connection's number: each connection, and each that a `retire` ends, takes the next. */
	get id(): number {
		return this.#connectionId;
	}

	/** Between `run` and `stop`: the client connects, and reconnects. */
	get running(): boolean {
		return this.#isRunning;
	}

	/** The backoff has run since it last started over: the next connection is a reconnect. */
	get retrying(): boolean {
		return this.#reconnectAttempt > 0;
	}

	/** Runs, without connecting yet: the page's visibility and the network are watched from here. */
	run(): void {
		this.#isRunning = true;
		globalThis.document?.addEventListener('visibilitychange', this.#visibilityChanged);
		globalThis.addEventListener?.('online', this.#networkReturned);
		this.#hiddenAt = pageHidden() ? this.#now() : undefined;
	}

	/** Stops: no reconnect is due, nothing waits for the page, and nothing is watched. */
	stop(): void {
		this.#isRunning = false;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#stopWaitingForPresence();
		globalThis.document?.removeEventListener('visibilitychange', this.#visibilityChanged);
		globalThis.removeEventListener?.('online', this.#networkReturned);
	}

	/** Connects, now or once the page is shown and the browser online (`waitForPresence`). */
	connect(): void {
		if (this.#waitForPresence()) return;
		this.#connectNow();
	}

	/** Connects again at once, rather than after the backoff, which restarts from its shortest delay. */
	retryNow(): void {
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#reconnectAttempt = 0;
		this.#connectNow();
	}

	/** Nothing the current connection does reaches the client from here, and no reconnect is due. */
	retire(): void {
		this.#connectionId += 1;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
	}

	/**
	 * Goes on with `socket`, open and signed in on a connection of its own, as the next connection, with no
	 * reconnect due and the backoff from the start. Returns its id.
	 */
	adopt(socket: WebSocket): number {
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#reconnectAttempt = 0;
		const id = ++this.#connectionId;
		this.#attachSocket(socket, id, true);
		return id;
	}

	/**
	 * Lets go of the current socket as its connection ends (`ChatClient.endConnection`): nothing it does reaches the
	 * client any more, and its pings, probe, opening wait, standby and stable timer go, as does a diagnosis under way.
	 * Returns it, to close.
	 */
	drop(): WebSocket | undefined {
		const socket = this.#current;
		this.#connectionProbe?.abort();
		this.#abandonSocket = undefined;
		this.#current = undefined;
		this.#stopPing();
		this.#clearOpening();
		this.#dropStandby();
		this.#clearStableTimer();
		return socket;
	}

	/**
	 * The current socket brought its `server` frame (§3.1): it has opened, in time. Liveness starts before
	 * authentication (§1); a replacing frame may change the interval (`pingChanged`).
	 */
	greeted(pingChanged: boolean): void {
		this.#clearOpening();
		if (!this.#pingTimer || pingChanged) this.#startPing();
	}

	/** The server answered a ping. */
	pong(): void {
		this.#unansweredPings = 0;
		if (this.#probeTimer) clearTimeout(this.#probeTimer);
		this.#probeTimer = undefined;
	}

	/** The current connection signed in: the backoff starts over only once it has stayed up, still `signedIn`. */
	stayUp(signedIn: () => boolean): void {
		this.#clearStableTimer();
		const stableSocket = this.#current;
		this.#stableTimer = setTimeout(() => {
			this.#stableTimer = undefined;
			if (this.#current === stableSocket && signedIn()) this.#reconnectAttempt = 0;
		}, STABLE_CONNECTION_MS);
	}

	/** Opens the next connection, or goes on with `handover`, one opened already (a probe's standby). */
	#connectNow(handover?: EarlyConnection): void {
		if (!this.#isRunning || this.#current) return;
		this.#stopWaitingForPresence();
		this.#connectionProbe?.abort();
		const id = ++this.#connectionId;
		this.#hooks.connecting(this.#reconnectAttempt > 0);
		// The first connection may be open already, or opening, made as the app started: it goes on from there.
		const takeEarly = this.#earlyConnection;
		this.#earlyConnection = undefined;
		const taken = takeEarly?.(this.#hooks.url());
		// Handed one: the app's early connection, if still unasked, is nobody's.
		if (handover && taken) closeUnused(taken.socket);
		const early = handover ?? taken;
		if (early) {
			this.#attachSocket(early.socket, id, early.open);
			if (early.open) this.#hooks.opened();
			// What arrived while it waited (its `server` frame, a welcome), in order, as if it arrived now.
			for (const data of early.frames) if (this.#isCurrentSocket(id, early.socket)) early.socket.onmessage?.({ data } as MessageEvent);
			return;
		}
		let socket: WebSocket;
		try {
			socket = this.#webSocketFactory(this.#hooks.url());
		} catch (cause) {
			this.#handleConnectionFailure(id, cause instanceof Error ? cause.message : 'Unable to open WebSocket');
			return;
		}
		this.#attachSocket(socket, id, false);
	}

	/** Makes `socket` this client's connection number `id`; `opened`: it is open already. */
	#attachSocket(socket: WebSocket, id: number, opened: boolean): void {
		this.#current = socket;
		socket.onopen = () => {
			if (!this.#isCurrentSocket(id, socket)) return;
			opened = true;
			this.#hooks.opened();
		};
		socket.onmessage = (event) => {
			if (!this.#isCurrentSocket(id, socket)) return;
			// Anything heard answers a probe: the socket is alive, and needs no standby.
			if (this.#probeTimer) clearTimeout(this.#probeTimer);
			this.#probeTimer = undefined;
			this.#dropStandby();
			this.#hooks.frame(event.data);
		};
		socket.onerror = () => {
			this.#hooks.errored(this.#isCurrentSocket(id, socket));
		};
		const closed = (): void => {
			if (!this.#isCurrentSocket(id, socket)) return;
			this.#hooks.closed();
			if (this.#isRunning) {
				if (opened) this.scheduleReconnect();
				else void this.#diagnoseConnection(id);
			}
			this.#hooks.emit();
		};
		socket.onclose = closed;
		// A socket whose peer vanished can stay OPEN here indefinitely, and one
		// whose handshake went into a vanished network CONNECTING; close it and
		// carry on as if the close had arrived, without waiting for it.
		this.#abandonSocket = (reason) => {
			try { socket.close(4000, reason); } catch { /* already closed */ }
			closed();
		};
		this.#watchOpening(socket);
	}

	/** Gives `socket`, the current one, `openingWait` to open and bring its `server` frame, else replaces it. */
	#watchOpening(socket: WebSocket): void {
		this.#clearOpening();
		const wait = this.#openingWait();
		this.#openingUntil = this.#now() + wait;
		this.#openingTimer = setTimeout(() => {
			this.#openingTimer = undefined;
			if (socket !== this.#current) return;
			this.#quietDroppedAt = this.#now();
			this.#abandonSocket?.('opening timed out');
		}, wait);
	}

	/**
	 * Drops the socket still opening, if any, as if it had failed, and connects again now rather than after the
	 * backoff (`fresh`: starting the backoff over), unless the server asked for a wait or holds reconnecting.
	 */
	#replaceOpening(reason: string, fresh: boolean): void {
		if (this.#openingUntil !== undefined) this.#abandonSocket?.(reason);
		if (!this.#isRunning || this.#current || this.#hooks.held()) return;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		if (fresh) this.#reconnectAttempt = 0;
		// The server's wait, or the page's return and the network's, go first: through the usual reconnect.
		if (this.#hooks.retryAfter() || absent()) {
			this.scheduleReconnect(0);
			return;
		}
		this.#reconnectAttempt += 1;
		this.#connectNow();
	}

	#clearOpening(): void {
		if (this.#openingTimer) clearTimeout(this.#openingTimer);
		this.#openingTimer = undefined;
		this.#openingUntil = undefined;
	}

	/** How long a socket may take to open: `OPENING_MS`, or longer just after one was replaced for staying quiet (`patientOr`). */
	#openingWait(): number {
		return this.#patientOr(OPENING_MS);
	}

	/**
	 * After a handshake that failed, asks the server why (EXT.md §5): `GET`
	 * its URL over HTTP with `?apron_connection_status=1`. A reply marked
	 * `Apron-Connection-Status: 1`, with status 403, 429 or 503 and a JSON
	 * `{error}`, shows as the error and holds reconnects for its
	 * `Retry-After`. Any other reply is ignored.
	 */
	async #diagnoseConnection(id: number): Promise<void> {
		const controller = new AbortController();
		this.#connectionProbe = controller;
		const timeout = setTimeout(() => controller.abort(), 4_000);
		try {
			const url = new URL(this.#hooks.url());
			url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
			url.searchParams.set('apron_connection_status', '1');
			const response = await fetch(url, {
				credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
			});
			// Any server answers the GET; only the marker says the reply is a connection status.
			if (response.headers.get('Apron-Connection-Status') !== '1') return;
			if (![403, 429, 503].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) return;
			const body: unknown = await response.json();
			if (!this.#isRunning || id !== this.#connectionId || controller.signal.aborted) return;
			if (!isJsonObject(body) || typeof body.error !== 'string' || !body.error.trim()) return;
			let until: number | undefined;
			const retry = response.headers.get('Retry-After');
			if (retry) {
				const delay = /^\d+$/.test(retry) ? Number(retry) * 1_000 : Date.parse(retry) - Date.now();
				if (Number.isFinite(delay) && delay > 0) until = Date.now() + Math.min(delay, RETRY_AFTER_MAX_MS);
			}
			this.#hooks.refused(body.error.slice(0, 300), until);
		} catch {
			// Servers without the status probe and network failures expose no HTTP diagnostics.
		} finally {
			clearTimeout(timeout);
			if (this.#connectionProbe === controller) this.#connectionProbe = undefined;
			if (this.#isRunning && id === this.#connectionId) {
				this.scheduleReconnect();
				this.#hooks.emit();
			}
		}
	}

	/**
	 * Sends `{"method":"ping"}` every `server.ping` seconds for as long as this
	 * socket is current (§1), before authentication too; the server answers
	 * `pong`. When a ping has gone a whole interval without an answer, the
	 * socket is presumed dead and replaced. Counting pings rather than time
	 * means a tab whose timers were frozen probes again after it wakes instead
	 * of dropping a socket that may still work.
	 */
	#startPing(): void {
		this.#stopPing();
		const seconds = this.#hooks.ping();
		const socket = this.#current;
		if (!socket || seconds === undefined) return;
		const interval = Math.max(1, seconds) * 1_000;
		this.#unansweredPings = 0;
		const timer = setInterval(() => {
			if (socket === this.#current && socket.readyState === WebSocket.OPEN) {
				if (this.#unansweredPings < MAX_UNANSWERED_PINGS) {
					socket.send(PING_FRAME);
					this.#unansweredPings += 1;
					return;
				}
				this.#abandonSocket?.('ping unanswered');
			}
			clearInterval(timer);
			if (this.#pingTimer === timer) this.#pingTimer = undefined;
		}, interval);
		this.#pingTimer = timer;
	}

	#stopPing(): void {
		if (this.#pingTimer) clearInterval(this.#pingTimer);
		this.#pingTimer = undefined;
		if (this.#probeTimer) clearTimeout(this.#probeTimer);
		this.#probeTimer = undefined;
	}

	/**
	 * Checks at once that an open socket still answers, on a page someone can see: one ping, and the socket is
	 * replaced through the usual reconnect if nothing comes back within `PROBE_MS` (`patientOr`). Only where the
	 * server pings (§1); the regular pings carry on as they were. With `standby` (after a long absence, or the
	 * network back), a second socket opens alongside if no answer comes within `STANDBY_AFTER_MS`, so a dead one
	 * is replaced by a connection already made; not while a recent replacement makes the probe patient.
	 */
	#probe(standby = false): void {
		const socket = this.#current;
		if (!this.#isRunning || !socket || socket.readyState !== WebSocket.OPEN || this.#hooks.ping() === undefined || this.#probeTimer || absent()) return;
		socket.send(PING_FRAME);
		// Not while the server holds reconnecting (`denied`, a sign-in) or asked for a wait: a standby would get around it.
		if (standby && !this.#patient() && !this.#hooks.held() && !this.#hooks.retryAfter()) {
			this.#standbyTimer = setTimeout(() => {
				this.#standbyTimer = undefined;
				if (socket === this.#current && this.#probeTimer && !absent()) this.#openStandby(socket);
			}, STANDBY_AFTER_MS);
		}
		this.#probeTimer = setTimeout(() => {
			this.#probeTimer = undefined;
			if (socket !== this.#current) return;
			this.#quietDroppedAt = this.#now();
			this.#replaceQuietSocket();
		}, this.#patientOr(PROBE_MS));
	}

	/**
	 * Opens the standby beside `probed`, sending nothing. Its first frame (the `server` frame, after a whole
	 * handshake) coming while `probed` has yet to answer one ping replaces `probed` with it at once.
	 */
	#openStandby(probed: WebSocket): void {
		this.#dropStandby();
		let socket: WebSocket;
		try {
			socket = this.#webSocketFactory(this.#hooks.url());
		} catch {
			return;
		}
		const standby = { socket, probed, frames: [] as unknown[] };
		this.#standby = standby;
		socket.onmessage = (event: MessageEvent) => {
			standby.frames.push(event.data);
			// Its greeting, a whole handshake done: anything else (an error before a close) proves nothing.
			if (this.#standby === standby && this.#current === probed && this.#probeTimer && isServerFrame(event.data)) this.#replaceQuietSocket();
		};
		socket.onclose = socket.onerror = () => {
			if (this.#standby === standby) this.#standby = undefined;
		};
	}

	/** Closes the standby, if any, or stops it opening: the probed socket answered, or it ended. */
	#dropStandby(): void {
		if (this.#standbyTimer) clearTimeout(this.#standbyTimer);
		this.#standbyTimer = undefined;
		const standby = this.#standby;
		this.#standby = undefined;
		if (standby) closeUnused(standby.socket);
	}

	/**
	 * Drops the current socket, gone quiet, as if it had closed. With a standby still open or opening, connects
	 * again on it at once, taking it as the app's early connection is taken; otherwise through the usual backoff.
	 */
	#replaceQuietSocket(): void {
		const standby = this.#standby;
		this.#standby = undefined;
		// Ending the probed connection (`endConnection`) drops a standby still waiting to open.
		this.#abandonSocket?.('ping unanswered');
		if (!standby) return;
		const { socket, frames } = standby;
		const usable = socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN;
		// Taken only where connecting now is: the client running with no other connection, the page shown and online,
		// and no hold or wait from the server since it opened.
		if (!usable || !this.#isRunning || this.#current || this.#hooks.held() || this.#hooks.retryAfter() || absent()) {
			closeUnused(socket);
			return;
		}
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#connectNow({ socket, open: socket.readyState === WebSocket.OPEN, frames });
	}

	/**
	 * `wait`, or `PROBE_PATIENT_MS` while a socket was replaced for staying quiet within `PROBE_PATIENT_FOR_MS`, so
	 * a slow network isn't met with one new socket after another.
	 */
	#patientOr(wait: number): number {
		return this.#patient() ? PROBE_PATIENT_MS : wait;
	}

	/** A socket was replaced for staying quiet within `PROBE_PATIENT_FOR_MS`: the network may be slow or flaky. */
	#patient(): boolean {
		const dropped = this.#quietDroppedAt;
		return dropped !== undefined && this.#now() - dropped < PROBE_PATIENT_FOR_MS;
	}

	#handleConnectionFailure(id: number, message: string): void {
		if (id !== this.#connectionId) return;
		this.#hooks.failed(message);
		if (this.#isRunning) this.scheduleReconnect();
		this.#hooks.emit();
	}

	/** The next connection, after the backoff (`delayOverride` in its place), and never before the server's wait is over. */
	scheduleReconnect(delayOverride?: number): void {
		if (!this.#isRunning || this.#reconnectTimer || this.#hooks.held()) return;
		this.#reconnectAttempt += 1;
		const retryAfter = this.#hooks.retryAfter();
		const delay = delayOverride !== undefined
			? Math.max(delayOverride, retryAfter ?? 0)
			: reconnectDelay(this.#reconnectAttempt, Math.random(), retryAfter);
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			if (this.#waitForPresence()) return;
			this.#connectNow();
		}, delay);
	}

	/**
	 * Connecting waits while the page is hidden or the browser is offline: a
	 * background tab needs no socket until it is looked at, and every new
	 * connection costs the server a session and its history. An open socket is
	 * kept. Returns whether it is waiting; it connects once both clear.
	 */
	#waitForPresence(): boolean {
		if (!absent()) return false;
		if (this.#presenceWaiter) return true;
		const resume = (): void => {
			if (absent()) return;
			this.#stopWaitingForPresence();
			if (this.#isRunning && !this.#current && !this.#reconnectTimer) this.#connectNow();
		};
		this.#presenceWaiter = resume;
		globalThis.document?.addEventListener('visibilitychange', resume);
		globalThis.addEventListener?.('online', resume);
		return true;
	}

	#stopWaitingForPresence(): void {
		const resume = this.#presenceWaiter;
		if (!resume) return;
		this.#presenceWaiter = undefined;
		globalThis.document?.removeEventListener('visibilitychange', resume);
		globalThis.removeEventListener?.('online', resume);
	}

	#clearStableTimer(): void {
		if (this.#stableTimer) clearTimeout(this.#stableTimer);
		this.#stableTimer = undefined;
	}

	#isCurrentSocket(id: number, socket: WebSocket): boolean {
		return id === this.#connectionId && this.#current === socket;
	}
}

/** Closes a socket nobody took (a probe's standby), its handlers first, so nothing it does after reaches the client. */
function closeUnused(socket: WebSocket): void {
	socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
	try {
		if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000, 'not used');
	} catch {
		// Closed already.
	}
}

/** Whether a frame is the server's greeting (§3.1), cheaply: a standby's first frame, before anything reads it. */
function isServerFrame(data: unknown): boolean {
	if (typeof data !== 'string') return false;
	try {
		const frame: unknown = JSON.parse(data);
		return isJsonObject(frame) && frame.method === 'server';
	} catch {
		return false;
	}
}
