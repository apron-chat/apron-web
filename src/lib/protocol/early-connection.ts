/**
 * The connection the app opens as it starts (`hooks.client.ts`), to the server the page is about to connect to,
 * before the page's code has loaded: the handshake, and the server's `server` frame, come while that code loads and
 * the page first renders, rather than after. The page's client takes it (`takeEarlyConnection`) in place of the
 * connection it would have opened, and finds the frames that arrived meanwhile as if they had arrived after.
 *
 * It sends nothing. Taken by a client for another server, or not taken in time, it closes, never having signed in.
 */
import { startupMark } from '../startup-marks';
import type { WebSocketFactory } from './client-types';

/** How long it waits to be taken: a page that starts its client at all does so well within this. */
export const EARLY_CONNECTION_MS = 15_000;

/** An early connection as the client takes it: open (`open`) or opening, and the frames that came while it waited. */
export interface EarlyConnection {
	socket: WebSocket;
	open: boolean;
	frames: unknown[];
}

interface Waiting {
	url: string;
	socket: WebSocket;
	frames: unknown[];
	timer: ReturnType<typeof setTimeout>;
}

let waiting: Waiting | undefined;
/** A client has asked for it: one opened from now on would be nobody's. */
let asked = false;

const CONNECTING = 0;
const OPEN = 1;

/**
 * Opens the connection to `url` (the address as the client compares it, `serverAddress`), unless one is open
 * already, or a client has already started without it. Nothing if the socket can't be made: the client tries itself.
 */
export function openEarlyConnection(url: string, factory: WebSocketFactory = (address) => new WebSocket(address)): void {
	if (waiting || asked) return;
	let socket: WebSocket;
	try {
		socket = factory(url);
	} catch {
		return;
	}
	const entry: Waiting = { url, socket, frames: [], timer: setTimeout(() => drop(entry), EARLY_CONNECTION_MS) };
	socket.onopen = () => startupMark('socket-open');
	socket.onmessage = (event: MessageEvent) => entry.frames.push(event.data);
	// Closed or failed before it was taken: the client connects itself, as it would have.
	socket.onclose = () => drop(entry);
	socket.onerror = () => drop(entry);
	waiting = entry;
}

/**
 * The early connection to `url`, if it is still open or opening: handed over once, its handlers the caller's to set.
 * One to another server closes. Either way, none opens after this.
 */
export function takeEarlyConnection(url: string): EarlyConnection | undefined {
	asked = true;
	const entry = waiting;
	if (!entry) return undefined;
	waiting = undefined;
	clearTimeout(entry.timer);
	const { socket } = entry;
	release(socket);
	if (entry.url !== url || (socket.readyState !== CONNECTING && socket.readyState !== OPEN)) {
		close(socket);
		return undefined;
	}
	return { socket, open: socket.readyState === OPEN, frames: entry.frames };
}

function drop(entry: Waiting): void {
	if (waiting !== entry) return;
	waiting = undefined;
	clearTimeout(entry.timer);
	release(entry.socket);
	close(entry.socket);
}

function release(socket: WebSocket): void {
	socket.onopen = null;
	socket.onmessage = null;
	socket.onclose = null;
	socket.onerror = null;
}

function close(socket: WebSocket): void {
	try {
		if (socket.readyState === CONNECTING || socket.readyState === OPEN) socket.close(1000, 'not used');
	} catch {
		// Closed already.
	}
}

/** For tests: forgets any early connection, closing it, and lets one open again. */
export function resetEarlyConnection(): void {
	if (waiting) drop(waiting);
	asked = false;
}
