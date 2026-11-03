import type { WireFrame } from '$lib/protocol/types';

/** The server's end of one in-page connection. */
export interface MemorySocket {
	/** Still open: a frame delivered after it closed goes nowhere. */
	readonly open: boolean;
	/** Sends `frame` to the client. */
	deliver(frame: WireFrame): void;
	/** Closes the connection from the server's end, as a network drop does. */
	close(): void;
}

/** An in-memory server, as the sockets it makes see it. */
export interface MemoryHost {
	/** A connection opened: the place to send the `server` frame (§3.1). */
	opened(socket: MemorySocket): void;
	/** A frame the client sent, parsed; a frame that isn't JSON never arrives. */
	received(socket: MemorySocket, frame: WireFrame): void;
	closed(socket: MemorySocket): void;
}

/**
 * A WebSocket, as far as `ChatClient` can tell, connected to `host` in this
 * page: it opens on the next microtask, and each frame either way arrives on a
 * microtask of its own, as a network's would arrive later than it was sent.
 *
 * With a round trip to play (`rttMs`), opening takes all of it and each frame either way half of it, in order. The
 * times run from when the client sent: a reply is due one round trip after its request went even when the page was
 * too busy to run the in-page server as the request reached it, as a real server answers while the page is busy.
 * `now` is the clock those times are on.
 */
export function memorySocket(url: string, host: MemoryHost, rttMs = 0, now: () => number = () => performance.now()): WebSocket {
	const half = rttMs / 2;
	/** Frames on their way, each due at `at`, in order. */
	const toServer: { at: number; frame: WireFrame }[] = [];
	const toClient: { at: number; data: string }[] = [];
	/** While the server handles a frame: when the frame reached it, so what it sends back leaves from then. */
	let handlingAt: number | undefined;
	/** When the last frame to the client is due, so none overtakes another. */
	let lastToClient = -Infinity;
	const end: MemorySocket = {
		get open() {
			return socket.readyState === 1;
		},
		deliver: (frame) => {
			if (socket.readyState !== 1) return;
			if (rttMs <= 0) return void socket.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
			const at = Math.max((handlingAt ?? now()) + half, lastToClient);
			lastToClient = at;
			toClient.push({ at, data: JSON.stringify(frame) });
			arm(drainToClient, at);
		},
		close: () => socket.close()
	};
	// Each timer hands on everything due by then, in order (a timer that fires late reorders nothing), and sets
	// another for what is still on its way.
	function drainToClient(): void {
		while (toClient.length && toClient[0].at <= now()) {
			const { data } = toClient.shift()!;
			if (socket.readyState === 1) socket.onmessage?.({ data } as MessageEvent);
		}
		if (toClient.length) arm(drainToClient, toClient[0].at);
	}
	function drainToServer(): void {
		while (toServer.length && toServer[0].at <= now()) {
			const { at, frame } = toServer.shift()!;
			if (socket.readyState !== 1) continue;
			handlingAt = at;
			try {
				host.received(end, frame);
			} finally {
				handlingAt = undefined;
			}
		}
		if (toServer.length) arm(drainToServer, toServer[0].at);
	}
	const arm = (drain: () => void, at: number) => setTimeout(drain, Math.max(0, Math.ceil(at - now())));
	const socket = {
		url,
		readyState: 0,
		onopen: null as ((event: Event) => void) | null,
		onmessage: null as ((event: MessageEvent) => void) | null,
		onerror: null as ((event: Event) => void) | null,
		onclose: null as ((event: CloseEvent) => void) | null,
		close: () => {
			if (socket.readyState === 3) return;
			socket.readyState = 3;
			toServer.length = 0;
			toClient.length = 0;
			host.closed(end);
			socket.onclose?.({} as CloseEvent);
		},
		send: (data: string) => {
			if (socket.readyState !== 1) return;
			let frame: WireFrame;
			try { frame = JSON.parse(data) as WireFrame; } catch { return; }
			if (rttMs <= 0) {
				queueMicrotask(() => {
					if (socket.readyState === 1) host.received(end, frame);
				});
				return;
			}
			const at = now() + half;
			toServer.push({ at, frame });
			arm(drainToServer, at);
		}
	};
	const openAt = now() + rttMs;
	const opened = () => {
		if (socket.readyState !== 0) return;
		socket.readyState = 1;
		socket.onopen?.({} as Event);
		// Closed from `onopen`: the host never hears of it, as `closed` already ran.
		if (socket.readyState !== 1) return;
		// What the server sends as the connection opens (the `server` frame) leaves then, however late this runs.
		handlingAt = rttMs > 0 ? openAt : undefined;
		try {
			host.opened(end);
		} finally {
			handlingAt = undefined;
		}
	};
	if (rttMs > 0) setTimeout(opened, rttMs);
	else queueMicrotask(opened);
	return socket as unknown as WebSocket;
}
