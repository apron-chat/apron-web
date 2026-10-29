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
 */
export function memorySocket(url: string, host: MemoryHost): WebSocket {
	const end: MemorySocket = {
		get open() {
			return socket.readyState === 1;
		},
		deliver: (frame) => {
			if (socket.readyState === 1) socket.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
		},
		close: () => socket.close()
	};
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
			host.closed(end);
			socket.onclose?.({} as CloseEvent);
		},
		send: (data: string) => {
			if (socket.readyState !== 1) return;
			let frame: WireFrame;
			try { frame = JSON.parse(data) as WireFrame; } catch { return; }
			queueMicrotask(() => {
				if (socket.readyState === 1) host.received(end, frame);
			});
		}
	};
	queueMicrotask(() => {
		if (socket.readyState !== 0) return;
		socket.readyState = 1;
		socket.onopen?.({} as Event);
		// Closed from `onopen`: the host never hears of it, as `closed` already ran.
		if (socket.readyState === 1) host.opened(end);
	});
	return socket as unknown as WebSocket;
}
