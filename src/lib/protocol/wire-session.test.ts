import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROOM_ID, userIn, type ChatClient, type ClientSnapshot, type RoomSnapshot } from './client';
import type { Identity } from './types';
import { FakeSocket, startClient } from '$lib/test/client';

/**
 * The shared session fixtures (protocol/tests/fixtures/wire/session, README
 * "Session scenarios"), run against the real `ChatClient` on a `FakeSocket`:
 * the fixture plays the server, operation steps call the client's public API.
 * This is the runner of apron-server-go's `tests/interop/wire.spec.ts`, with
 * the fake socket in place of its Go peer, so every variant runs here, in both
 * envelopes, against this client rather than a pinned one.
 */

type ObjectValue = Record<string, unknown>;
type Step =
	| { receive: ObjectValue }
	| { request: { as: string; match: ObjectValue } }
	| { reply: { to: string; result?: ObjectValue; error?: ObjectValue } }
	| { send: { as: string; room?: string; text: string; format: 'plain' | 'markdown'; reply_to?: string; mentions?: string[] } }
	| { command: { as: string; room?: string; text: string; mentions?: string[] } }
	| { editMessage: { as: string; message_id: string; text: string } }
	| { moveMessage: { as: string; message_id: string; room: string } }
	| { deleteMessage: { as: string; message_id: string } }
	| { react: { as: string; message_id: string; emojis: string[] } }
	| { mute: { as: string; mute: number | boolean } }
	| { createRoom: { as: string; parent_room_id?: string; title?: string; description?: string } }
	| { updateRoom: { as: string; room: string; title?: string | null; description?: string | null } }
	| { joinRoom: { as: string; room: string } }
	| { leaveRoom: { as: string; room: string } }
	| { listRooms: { as: string; parent_room_id?: string } }
	| { loadRoom: { as: string; room: string } }
	| { loadOlder: { as: string; room: string } }
	| { idle: number | false }
	| { disconnect: true }
	| { expect: ObjectValue };
interface Variant {
	name: string;
	steps: Step[];
}
interface Fixture {
	format: number;
	kind: string;
	name: string;
	variants: Variant[];
	expected: ObjectValue;
}

/** Requests whose `params` must equal the fixture's exactly (README "Request matching"). */
const MUTATIONS = new Set(['message', 'command', 'room_set', 'room_join', 'room_leave', 'reactions', 'status']);
/** How many turns of promise callbacks and zero-delay timers a step may take to show (fixtures carry no sleeps). */
const SETTLE_TURNS = 20;

const fixtureModules = import.meta.glob('../../../protocol/tests/fixtures/wire/session/*.json', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;
const fixtures = Object.entries(fixtureModules)
	.sort(([left], [right]) => byString(left, right))
	.map(([file, source]) => [file.split('/').at(-1)!, JSON.parse(source) as Fixture] as const);

if (!fixtures.length) throw new Error('No session fixtures found');

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

for (const [file, fixture] of fixtures) {
	describe(`${file}: ${fixture.name}`, () => {
		for (const variant of fixture.variants) {
			for (const envelope of ['minimal', 'jsonrpc'] as const) {
				it(`${variant.name} (${envelope})`, () => runVariant(fixture, variant, envelope));
			}
		}
	});
}

/** Runs one variant from a fresh client, as `wire.spec.ts` does, and checks `expected` at the end. */
async function runVariant(fixture: Fixture, variant: Variant, envelope: 'minimal' | 'jsonrpc'): Promise<void> {
	expect(fixture.format).toBe(4);
	expect(fixture.kind).toBe('session');
	const { client } = startClient({ storage: new Map() });
	const requests = new Map<string, ObjectValue>();
	const unmatched: ObjectValue[] = [];
	const operations: Record<string, string> = {};
	/** When the latest `idle` step with seconds ran, which a `status` reporting them may add to. */
	let idleAt = 0;
	let socket = connection();
	/** How many of `socket.sent` have gone into `unmatched`. */
	let taken = 0;
	const wire = (frame: ObjectValue) => (envelope === 'jsonrpc' ? { ...frame, jsonrpc: '2.0' } : frame);
	const track = (as: string, promise: Promise<unknown>) => {
		expect(Object.hasOwn(operations, as), `duplicate operation ${as}`).toBe(false);
		operations[as] = 'pending';
		promise.then(() => (operations[as] = 'fulfilled'), () => (operations[as] = 'rejected'));
	};

	for (const [index, step] of variant.steps.entries()) {
		const kind = Object.keys(step)[0];
		try {
			expect(Object.keys(step)).toHaveLength(1);
			if ('receive' in step) {
				socket.receive(wire(structuredClone(step.receive)));
			} else if ('request' in step) {
				const { as } = step.request;
				let { match } = step.request;
				expect(requests.has(as), `duplicate capture ${as}`).toBe(false);
				const wanted = isObject(match.params) ? match.params : {};
				// A `status` also matches by which of `idle` and `mute` it carries, so the two queue separately.
				const carries = (frame: ObjectValue, key: string) => Object.hasOwn(paramsOf(frame) ?? {}, key) === Object.hasOwn(wanted, key);
				const selects = (frame: ObjectValue) => frame.method === match.method &&
					paramsOf(frame)?.room_id === wanted.room_id &&
					paramsOf(frame)?.message_id === wanted.message_id &&
					(match.method !== 'status' || (carries(frame, 'idle') && carries(frame, 'mute')));
				let position = -1;
				for (let turn = 0; position < 0 && turn <= SETTLE_TURNS; turn++) {
					if (turn) await flush();
					while (taken < socket.sent.length) unmatched.push(socket.sent[taken++]);
					position = unmatched.findIndex(selects);
				}
				if (position < 0) throw new Error(`the client sent no ${JSON.stringify(match)}; unmatched: ${JSON.stringify(unmatched)}`);
				const [frame] = unmatched.splice(position, 1);
				const idle = paramsOf(frame)?.idle;
				if (typeof wanted.idle === 'number') {
					// Time passes before the client sends: up to the whole seconds since the `idle` step.
					expect(idle).toBeGreaterThanOrEqual(wanted.idle);
					expect(idle).toBeLessThanOrEqual(wanted.idle + Math.floor((Date.now() - idleAt) / 1000));
					match = { ...match, params: { ...wanted, idle } };
				}
				expect(restrict(frame, match)).toEqual(match);
				if (MUTATIONS.has(match.method as string)) expect(frame.params).toEqual(match.params);
				if ('jsonrpc' in frame) expect(frame.jsonrpc).toBe('2.0');
				expect(typeof frame.id).toBe('string');
				expect([...requests.values()].some((previous) => previous.id === frame.id), 'new operation reuses a request ID').toBe(false);
				requests.set(as, frame);
			} else if ('reply' in step) {
				const request = requests.get(step.reply.to);
				expect(request, `uncaptured request ${step.reply.to}`).toBeDefined();
				const { to: _, ...result } = step.reply;
				socket.receive(wire({ id: request!.id, ...result }));
			} else if ('send' in step) {
				const { as, room, text, format, reply_to, mentions } = step.send;
				track(as, client.send(room ?? DEFAULT_ROOM_ID, text, format, {
					...(reply_to !== undefined ? { replyTo: reply_to } : {}),
					...(mentions !== undefined ? { mentions } : {})
				}).promise);
			} else if ('command' in step) {
				const { as, room, text, mentions } = step.command;
				track(as, client.command(room ?? DEFAULT_ROOM_ID, text, mentions !== undefined ? { mentions } : {}).promise);
			} else if ('editMessage' in step) {
				const { as, message_id, text } = step.editMessage;
				track(as, client.editMessage(message_id, text).promise);
			} else if ('moveMessage' in step) {
				const { as, message_id, room } = step.moveMessage;
				track(as, client.moveMessage(message_id, room).promise);
			} else if ('deleteMessage' in step) {
				const { as, message_id } = step.deleteMessage;
				track(as, client.deleteMessage(message_id).promise);
			} else if ('react' in step) {
				const { as, message_id, emojis } = step.react;
				track(as, client.react(message_id, emojis).promise);
			} else if ('mute' in step) {
				const { as, mute } = step.mute;
				track(as, client.setMute(mute));
			} else if ('idle' in step) {
				// Not an operation: what the page would say once its wait for input is over.
				if (step.idle === false) client.setIdle(false);
				else {
					idleAt = Date.now();
					client.setIdle(true, idleAt - step.idle * 1000);
				}
			} else if ('createRoom' in step) {
				const { as, parent_room_id, title, description } = step.createRoom;
				track(as, client.createRoom({
					...(parent_room_id !== undefined ? { parentRoomId: parent_room_id } : {}),
					...(title !== undefined ? { title } : {}),
					...(description !== undefined ? { description } : {})
				}).promise);
			} else if ('updateRoom' in step) {
				const { as, room, ...patch } = step.updateRoom;
				track(as, client.updateRoom(room, {
					...(Object.hasOwn(patch, 'title') ? { title: patch.title } : {}),
					...(Object.hasOwn(patch, 'description') ? { description: patch.description } : {})
				}).promise);
			} else if ('joinRoom' in step) {
				track(step.joinRoom.as, client.joinRoom(step.joinRoom.room).promise);
			} else if ('leaveRoom' in step) {
				track(step.leaveRoom.as, client.leaveRoom(step.leaveRoom.room).promise);
			} else if ('listRooms' in step) {
				track(step.listRooms.as, client.listRooms(step.listRooms.parent_room_id));
			} else if ('loadRoom' in step) {
				track(step.loadRoom.as, client.loadRoom(step.loadRoom.room));
			} else if ('loadOlder' in step) {
				track(step.loadOlder.as, client.loadOlder(step.loadOlder.room));
			} else if ('disconnect' in step) {
				socket.drop();
				unmatched.length = 0;
				socket = connection(socket);
				taken = 0;
			} else if ('expect' in step) {
				await expectState(client, operations, step.expect);
			} else {
				throw new Error(`Unknown fixture step: ${JSON.stringify(step)}`);
			}
			await flush();
		} catch (error) {
			if (error instanceof Error) error.message = `step ${index + 1} (${kind}): ${error.message}`;
			throw error;
		}
	}
	await expectState(client, operations, fixture.expected);
}

/**
 * The connection the client opens next, open (the Go peer hands a runner only
 * accepted connections): the first, or after `previous` dropped, the one its
 * reconnect opens once the backoff runs out.
 */
function connection(previous?: FakeSocket): FakeSocket {
	for (let timer = 0; timer < 50 && previous && FakeSocket.latest() === previous; timer++) vi.advanceTimersToNextTimer();
	const socket = FakeSocket.latest();
	if (socket === previous) throw new Error('the client did not reconnect');
	socket.open();
	return socket;
}

/** Lets promise callbacks and zero-delay timers run: no time passes. */
async function flush(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

/** Waits a bounded number of turns for the given keys of the session state, then asserts them. */
async function expectState(client: ChatClient, operations: Record<string, string>, expected: ObjectValue): Promise<void> {
	for (let turn = 0; turn < SETTLE_TURNS && canonical(pick(logicalState(client, operations), expected)) !== canonical(expected); turn++) await flush();
	expect(pick(logicalState(client, operations), expected)).toEqual(expected);
}

/** JSON with object keys sorted, so equal JSON values compare equal as strings. */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) => isObject(inner)
		? Object.fromEntries(Object.keys(inner).sort(byString).map((key) => [key, inner[key]]))
		: inner);
}

function byString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** The room projection of the fixtures' README, from the client's public snapshot. */
function projectRoom(room: RoomSnapshot): ObjectValue {
	const record = room.record;
	const has = (key: string) => record !== undefined && Object.hasOwn(record, key);
	return {
		room_id: room.id,
		...(has('log_id') ? { log_id: record!.log_id } : {}),
		...(has('parent_room_id') ? { parent_room_id: record!.parent_room_id } : {}),
		...(has('title') ? { title: record!.title } : {}),
		...(has('description') ? { description: record!.description } : {}),
		...(has('ext') ? { ext: record!.ext } : {}),
		messages: room.timeline.order.map((id) => {
			const reactions = room.timeline.reactions[id];
			return {
				...room.timeline.events[id],
				...(reactions ? { reactions: reactions.map(({ emoji, user_ids }) => ({ emoji, user_ids })) } : {})
			};
		})
	};
}

/**
 * A message's sender as the fixtures project it (README "Session state"):
 * the rendered user, less any field its kept object holds as cleared (an
 * empty value, "", [], {}), which is omitted rather than taken from `from`.
 */
function senderOf(snapshot: ClientSnapshot, from: Identity): Identity {
	const rendered = userIn(snapshot, from);
	let id = from.user_id;
	for (let hops = 0; hops < 8 && snapshot.userAliases[id] !== undefined; hops += 1) id = snapshot.userAliases[id];
	const kept = snapshot.users[id] ?? snapshot.users[from.user_id];
	if (!kept) return rendered;
	const cleared = (value: unknown) => value === '' || (Array.isArray(value) && value.length === 0) ||
		(isObject(value) && Object.keys(value).length === 0);
	return Object.fromEntries(Object.entries(rendered)
		.filter(([key]) => key === 'user_id' || !(Object.hasOwn(kept, key) && cleared(kept[key])))) as Identity;
}

function keptUser(snapshot: ClientSnapshot, id: string): Identity {
	if (!snapshot.heldStatuses?.includes(id)) return snapshot.users[id];
	const { status: _held, ...kept } = snapshot.users[id];
	return kept;
}

function logicalState(client: ChatClient, operations: Record<string, string>): ObjectValue {
	const snapshot = client.snapshot();
	// The default room before its `room_id` is known is the client's own placeholder, not a room;
	// a room open without joining it is not visible either.
	const rooms = snapshot.rooms.filter((room) => room.id !== DEFAULT_ROOM_ID && room.joined);
	return JSON.parse(JSON.stringify({
		you: snapshot.you ?? null,
		capabilities: [...(snapshot.server?.capabilities ?? [])].sort(byString),
		rooms: [...rooms].sort((left, right) => byString(left.id, right.id)).map(projectRoom),
		typing: snapshot.typing
			.map((entry) => ({ room_id: entry.room, from: entry.from }))
			.sort((left, right) => byString(left.room_id, right.room_id) || byString(left.from.user_id, right.from.user_id)),
		// The kept users: a status only held on screen through a resume is not kept (README "Session state").
		users: Object.fromEntries(Object.keys(snapshot.users).sort(byString).map((id) => [id, keptUser(snapshot, id)])),
		members: Object.fromEntries(rooms.filter((room) => room.members !== undefined).sort((left, right) => byString(left.id, right.id))
			.map((room) => [room.id, room.members!.map((member) => member.user_id).sort(byString)])),
		senders: Object.fromEntries(rooms.flatMap((room) => room.timeline.order.map((id) => [id, senderOf(snapshot, room.timeline.events[id].from)]))),
		notices: snapshot.rooms.flatMap((room) => room.notices)
			.sort((left, right) => left.at - right.at || byString(left.key, right.key))
			.map(({ room_id, from, body }) => ({ room_id, from, ...(body ? { body } : {}) })),
		directory: (snapshot.directory ?? []).map((listing) => listing.id),
		// The mutes in effect, `""` for the one without `room_id`: `true` until unmuted, else "timed".
		mutes: Object.fromEntries([
			...(snapshot.mutedUntil !== undefined ? [['', snapshot.mutedUntil] as const] : []),
			...Object.entries(snapshot.roomMutes ?? {})
		].sort(([left], [right]) => byString(left, right)).map(([room, until]) => [room, until === true ? true : 'timed'])),
		operations
	}));
}

/** Only the given keys of the expected state (README "Session state"). */
function pick(state: ObjectValue, expected: ObjectValue): ObjectValue {
	return Object.fromEntries(Object.keys(expected).map((key) => [key, state[key]]));
}

/**
 * The recursive subset of `actual` described by `expected`: objects keep the
 * listed keys, arrays and scalars compare exactly.
 */
function restrict(actual: unknown, expected: unknown): unknown {
	if (!isObject(expected) || !isObject(actual)) return actual;
	const result: ObjectValue = {};
	for (const key of Object.keys(expected)) {
		if (Object.hasOwn(actual, key)) Object.defineProperty(result, key, { value: restrict(actual[key], expected[key]), enumerable: true, writable: true, configurable: true });
	}
	return result;
}

function isObject(value: unknown): value is ObjectValue {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paramsOf(frame: ObjectValue): ObjectValue | undefined {
	return isObject(frame.params) ? frame.params : undefined;
}
