/**
 * The client's connection to its server as sockets come and go (PROTOCOL.md §1): opening each one, watching that it
 * still answers, and making the next. `ChatClient` reads every frame, signs in, and keeps the session; this keeps
 * only the sockets, through `TransportHooks`.
 *
 * A socket opens until its `server` frame greets the client (`greeted`), which signs it in; signed in and up for
 * `STABLE_CONNECTION_MS` (`stayUp`), the backoff starts over. From the greeting on, pings watch it, and a page shown
 * again or the network back probes it (`probe`). Both times the client waits to hear from the socket, the greeting or
 * the probe's answer, the wait is one thing (`waitFor`): the socket has so long, and one that outlasts it goes as if
 * it had closed (`replaceQuiet`). Where the page has just come back (`raced`), a standby opens beside it meanwhile,
 * and takes over at once should it greet first (`standbyGreeted`). Between sockets a reconnect waits out its backoff
 * (`scheduleReconnect`), the server's hold or wait (`held`, `retryAfter`), or the page's absence (`waitForPresence`).
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
	STANDBY_AFTER_MS,
	STANDBY_OPENING_FOR_MS,
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
	/** The current connection signed in (`stayUp`): when, and whether it still is. */
	#signedIn?: { socket: WebSocket; at: number; still: () => boolean };
	/** Resumes connecting when the page is shown or the network returns; set while waiting for either. */
	#presenceWaiter?: () => void;
	/** Pings sent on the current socket since its last `pong`. */
	#unansweredPings = 0;
	/**
	 * The client waits to hear from the current socket (`waitFor`): its `server` frame (§3.1) while it is `opening`,
	 * else anything in answer to a probe's ping. `until` is when the wait runs out, by `timer`, and the socket goes;
	 * `race`, where it is raced, opens the standby beside it meanwhile.
	 */
	#waiting?: { socket: WebSocket; opening: boolean; until: number; timer: ReturnType<typeof setTimeout>; race?: ReturnType<typeof setTimeout> };
	/** When a socket was last replaced for outlasting its wait: a probe it didn't answer, or an opening that ran out. */
	#quietDroppedAt?: number;
	/**
	 * A socket opened beside the one waited on (`beside`), sending nothing, as the app's early connection does:
	 * `beside` heard from first closes it, and its own `server` frame coming first, a whole handshake before the
	 * other's greeting or one ping's answer, means `beside` is gone or going nowhere: it takes over at once, the
	 * handshake done (`standbyGreeted`). It touches nothing of the client's but this until it takes over.
	 */
	#standby?: { socket: WebSocket; beside: WebSocket; frames: unknown[] };
	/** When the page was last hidden, while it still is. */
	#hiddenAt?: number;
	/** When the page last came back: its start, being shown again, the network back (`raced`). */
	#backAt?: number;
	/**
	 * Drops the current socket as if it had closed: for one that stopped answering, `reason` its close's. With
	 * `handover`, no reconnect follows: its standby carries on.
	 */
	#abandonSocket?: (reason: string, handover?: boolean) => void;
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
			this.#backAt = this.#now();
			// One still opening may have outrun its wait while hidden pages' timers were held back: the next goes now,
			// as it would have once shown, had its timer run.
			if (this.#waiting?.opening && this.#now() >= this.#waiting.until) this.#replaceOpening('opening timed out', false);
			else if (away >= PROBE_AFTER_HIDDEN_MS) this.#probe();
		}
		this.#hooks.visibilityChanged();
	};
	/**
	 * The network back: the socket may not have survived it, and one that has greeted is probed. What failed or is
	 * still opening did so on the network that went (nothing opens while the browser is offline): the next connection
	 * goes now, its backoff from the start.
	 */
	readonly #networkReturned = (): void => {
		this.#backAt = this.#now();
		if (this.#current && !this.#waiting?.opening) this.#probe();
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
		this.#backAt = pageHidden() ? undefined : this.#now();
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
	 * client any more, and its pings, the wait to hear from it, its standby and stable timer go, as does a diagnosis
	 * under way. Returns it, to close.
	 */
	drop(): WebSocket | undefined {
		const socket = this.#current;
		this.#connectionProbe?.abort();
		this.#abandonSocket = undefined;
		this.#current = undefined;
		this.#stopPing();
		this.#heard();
		this.#clearStableTimer();
		return socket;
	}

	/**
	 * The current socket brought its `server` frame (§3.1): it has opened, in time. Liveness starts before
	 * authentication (§1); a replacing frame may change the interval (`pingChanged`).
	 */
	greeted(pingChanged: boolean): void {
		this.#heard();
		if (!this.#pingTimer || pingChanged) this.#startPing();
	}

	/** The server answered a ping. */
	pong(): void {
		this.#unansweredPings = 0;
	}

	/**
	 * The current connection signed in: the backoff starts over only once it has stayed up, still `signedIn`, for
	 * `STABLE_CONNECTION_MS`. That is by the clock, checked again as the connection closes (`stayedUp`): a page
	 * frozen in the background (a phone's, within seconds of being put away) runs no timer, and its socket is
	 * usually gone by its return. Counted by the timer alone, each short visit would be a failure for the next to
	 * back off from, until coming back waited a minute to connect.
	 */
	stayUp(signedIn: () => boolean): void {
		this.#clearStableTimer();
		const stableSocket = this.#current;
		if (!stableSocket) return;
		this.#signedIn = { socket: stableSocket, at: this.#now(), still: signedIn };
		this.#stableTimer = setTimeout(() => {
			this.#stableTimer = undefined;
			this.#stayedUp(stableSocket, true);
		}, STABLE_CONNECTION_MS);
	}

	/**
	 * Starts the backoff over if `socket`, the current one, has been signed in for `STABLE_CONNECTION_MS` and still
	 * is: its timer ran (`timed`), or the clock says so.
	 */
	#stayedUp(socket: WebSocket, timed = false): void {
		const signedIn = this.#signedIn;
		if (!signedIn || signedIn.socket !== socket || this.#current !== socket) return;
		if ((timed || this.#now() - signedIn.at >= STABLE_CONNECTION_MS) && signedIn.still()) this.#reconnectAttempt = 0;
	}

	/** Opens the next connection, or goes on with `handover`, one opened already (the standby of a socket waited on). */
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
			this.#goOnWith(early, id);
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

	/** Goes on with `early`, a socket opened before it was the client's (the app's early connection, a standby), as connection `id`. */
	#goOnWith(early: EarlyConnection, id: number): void {
		this.#attachSocket(early.socket, id, early.open);
		if (early.open) this.#hooks.opened();
		// What arrived while it waited (its `server` frame, a welcome), in order, as if it arrived now.
		for (const data of early.frames) if (this.#isCurrentSocket(id, early.socket)) early.socket.onmessage?.({ data } as MessageEvent);
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
			// Anything heard answers a probe: the socket is alive, and needs no standby. One still opening is waited
			// on for its greeting, which the client tells of (`greeted`).
			if (this.#waiting && !this.#waiting.opening) this.#heard();
			this.#hooks.frame(event.data);
		};
		socket.onerror = () => {
			this.#hooks.errored(this.#isCurrentSocket(id, socket));
		};
		/** `handover`: the standby carries on as the next connection (`replaceQuiet`), so no reconnect is due. */
		const closed = (handover = false): void => {
			if (!this.#isCurrentSocket(id, socket)) return;
			// Before the client ends the connection (`drop`), while it can still say it was signed in. Not with a
			// reconnect already due, which the client asked for as it closed the socket: that one is counted.
			if (!this.#reconnectTimer) this.#stayedUp(socket);
			this.#hooks.closed();
			if (this.#isRunning && !handover) {
				if (opened) this.scheduleReconnect();
				else void this.#diagnoseConnection(id);
			}
			this.#hooks.emit();
		};
		socket.onclose = () => closed();
		// A socket whose peer vanished can stay OPEN here indefinitely, and one
		// whose handshake went into a vanished network CONNECTING; close it and
		// carry on as if the close had arrived, without waiting for it.
		this.#abandonSocket = (reason, handover) => {
			try { socket.close(4000, reason); } catch { /* already closed */ }
			closed(handover);
		};
		// Until its `server` frame (§3.1): browsers put no limit on a handshake.
		this.#waitFor(socket, true);
	}

	/**
	 * Waits to hear from `socket`, the current one: its `server` frame while `opening`, else an answer to the ping
	 * just sent. It has `OPENING_MS` or `PROBE_MS`, and where the page has just come back (`raced`) a standby opens
	 * beside it after `STANDBY_AFTER_MS`, so one that is gone, or whose handshake went nowhere, is replaced by a
	 * connection already made rather than waited out. For `PROBE_PATIENT_FOR_MS` after a socket outlasted its wait
	 * (`patient`), the network may only be slow: the socket then has `PROBE_PATIENT_MS`, and its standby, where it is
	 * raced, opens once its usual wait is over, so a slow network is met with one more socket, not one after another.
	 *
	 * A probed socket that outlasts its wait leaves its standby, if still opening, to carry on: the socket died, and
	 * no handshake failed. A socket opening that does takes its standby with it: the handshake failed, and what
	 * follows is what follows any that does, the server asked why and the backoff, which a standby carrying on would
	 * get around, one hung socket after another.
	 */
	#waitFor(socket: WebSocket, opening: boolean): void {
		this.#stopWaiting();
		const usual = opening ? OPENING_MS : PROBE_MS;
		const patient = this.#patient();
		const wait = patient ? PROBE_PATIENT_MS : usual;
		const raceAfter = !this.#raced(opening) ? undefined : patient ? usual : STANDBY_AFTER_MS;
		const waiting = {
			socket, opening, until: this.#now() + wait,
			timer: setTimeout(() => {
				if (this.#waiting !== waiting || socket !== this.#current) return;
				this.#quietDroppedAt = this.#now();
				this.#replaceQuiet(!opening);
			}, wait),
			race: raceAfter === undefined ? undefined : setTimeout(() => {
				if (this.#waiting === waiting && socket === this.#current && this.#mayReplace()) this.#openStandby(socket);
			}, raceAfter)
		};
		this.#waiting = waiting;
	}

	/**
	 * Whether a socket waited on gets a standby (after `STANDBY_AFTER_MS`, or its usual wait while `patient`): where
	 * the page has just come back, which is when sockets die unnoticed and handshakes go nowhere (a phone's app away, its network not back yet). A
	 * probe always follows that. A socket opening does within `STANDBY_OPENING_FOR_MS` of the page's start, of its
	 * being shown again, or of the network's return; one opening at any other time (the server restarted, and every
	 * client is back at once) is slow because the server is, and a second handshake each would only add to it.
	 */
	#raced(opening: boolean): boolean {
		return !opening || (this.#backAt !== undefined && this.#now() - this.#backAt < STANDBY_OPENING_FOR_MS);
	}

	/** The wait to hear from the current socket is over, however it ended: its timers go. */
	#stopWaiting(): void {
		const waiting = this.#waiting;
		if (!waiting) return;
		this.#waiting = undefined;
		clearTimeout(waiting.timer);
		if (waiting.race) clearTimeout(waiting.race);
	}

	/** The current socket was heard from, or its connection ended: nothing waits on it, and its standby closes unused. */
	#heard(): void {
		this.#stopWaiting();
		const standby = this.#standby;
		this.#standby = undefined;
		if (standby) closeUnused(standby.socket);
	}

	/**
	 * Whether a connection may open, or be taken, in a quiet one's place now: the client running, the page shown and
	 * online, and no hold (`denied`, a sign-in) or wait from the server, which a second connection would get around.
	 */
	#mayReplace(): boolean {
		return this.#isRunning && !this.#hooks.held() && !this.#hooks.retryAfter() && !absent();
	}

	/**
	 * Drops the socket still opening, if any, as if it had failed, and connects again now rather than after the
	 * backoff (`fresh`: starting the backoff over), unless the server asked for a wait or holds reconnecting.
	 */
	#replaceOpening(reason: string, fresh: boolean): void {
		if (this.#waiting?.opening) this.#abandonSocket?.(reason);
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
	}

	/**
	 * Checks at once that an open socket still answers, on a page someone can see: one ping, and the socket is
	 * waited on for anything back (`waitFor`). Only where the server pings (§1); the regular pings carry on as
	 * they were.
	 */
	#probe(): void {
		const socket = this.#current;
		if (!this.#isRunning || !socket || socket.readyState !== WebSocket.OPEN || this.#hooks.ping() === undefined || this.#waiting || absent()) return;
		socket.send(PING_FRAME);
		this.#waitFor(socket, false);
	}

	/**
	 * Opens the standby beside `beside`, the socket waited on, sending nothing. Its first frame (the `server` frame,
	 * after a whole handshake) coming while `beside` has yet to be heard from replaces `beside` with it at once.
	 */
	#openStandby(beside: WebSocket): void {
		// One at a time: none is left from an earlier wait, which closes its own as it ends (`heard`).
		if (this.#standby) return;
		let socket: WebSocket;
		try {
			socket = this.#webSocketFactory(this.#hooks.url());
		} catch {
			return;
		}
		const standby = { socket, beside, frames: [] as unknown[] };
		this.#standby = standby;
		socket.onmessage = (event: MessageEvent) => {
			standby.frames.push(event.data);
			// Its greeting, a whole handshake done: anything else (an error before a close) proves nothing.
			if (this.#standby === standby && this.#current === beside && this.#waiting?.socket === beside && isServerFrame(event.data)) this.#standbyGreeted();
		};
		socket.onclose = socket.onerror = () => {
			if (this.#standby === standby) this.#standby = undefined;
		};
	}

	/**
	 * The standby's greeting came before anything from the socket waited on. Where a connection may not be taken now
	 * (`mayReplace`: the page hidden since, a hold or wait from the server), it proves nothing worth acting on: it
	 * closes unused, and the wait goes on. Otherwise it takes over. From a socket that has yet to open, as the same
	 * connection, the client hearing of no close (`takeOverOpening`). From any other (a probed one, or one that
	 * opened and was never greeted, on which the client may have spoken: a sign-in started before the greeting), as
	 * from one that closed, so that what was said on it is failed rather than left waiting (`replaceQuiet`).
	 */
	#standbyGreeted(): void {
		const standby = this.#standby;
		if (!standby) return;
		if (!this.#mayReplace()) {
			this.#standby = undefined;
			closeUnused(standby.socket);
		} else if (this.#waiting?.opening && this.#current?.readyState === WebSocket.CONNECTING) {
			this.#takeOverOpening();
		} else {
			this.#replaceQuiet(true);
		}
	}

	/**
	 * Goes on with the standby, greeted, in place of the socket whose handshake is still under way, as the same
	 * connection. Nothing can be said on a socket before it opens, so nothing of the connection is lost with the one
	 * left, and the client hears of no close: what it has waiting to send goes out on this one once it has signed
	 * in, where a close would have failed it as not sent, and a first connection stays one, not a reconnect.
	 */
	#takeOverOpening(): void {
		const standby = this.#standby;
		const left = this.#current;
		if (!standby || !left) return;
		this.#standby = undefined;
		this.#stopWaiting();
		this.#abandonSocket = undefined;
		this.#current = undefined;
		closeUnused(left);
		this.#goOnWith({ socket: standby.socket, open: true, frames: standby.frames }, this.#connectionId);
	}

	/**
	 * Drops the socket waited on, gone quiet or nowhere, as if it had closed. With `carryOn`, a standby still open
	 * or opening, and connecting allowed now (`mayReplace`), goes on with it at once, taking it as the app's early
	 * connection is taken. Otherwise the standby closes with it, and what follows any close follows: the backoff,
	 * or the server asked why its handshake failed.
	 */
	#replaceQuiet(carryOn: boolean): void {
		const waiting = this.#waiting;
		if (!waiting) return;
		const standby = this.#standby;
		// Ending the quiet connection (`drop`) closes a standby still there: this one is taken first.
		this.#standby = undefined;
		const usable = carryOn && standby !== undefined && (standby.socket.readyState === WebSocket.CONNECTING || standby.socket.readyState === WebSocket.OPEN) && this.#mayReplace();
		if (standby && !usable) closeUnused(standby.socket);
		this.#abandonSocket?.(!waiting.opening ? 'ping unanswered' : carryOn ? 'not greeted' : 'opening timed out', usable);
		if (!standby || !usable) return;
		const { socket, frames } = standby;
		// The connection ended there (`drop`), as the client's does. With one still current, or the client stopped
		// as it heard of the close, the standby is nobody's.
		if (this.#current || !this.#isRunning) {
			closeUnused(socket);
			return;
		}
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		// One more try, as a reconnect after the backoff would have been.
		this.#reconnectAttempt += 1;
		this.#connectNow({ socket, open: socket.readyState === WebSocket.OPEN, frames });
	}

	/** A socket outlasted its wait within `PROBE_PATIENT_FOR_MS`: the network may be slow or flaky. */
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
		this.#signedIn = undefined;
	}

	#isCurrentSocket(id: number, socket: WebSocket): boolean {
		return id === this.#connectionId && this.#current === socket;
	}
}

/** Closes a socket nobody took (a standby), its handlers first, so nothing it does after reaches the client. */
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
