import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from './client';
import { FakeSocket, startClient } from '$lib/test/client';

/**
 * Activity (§4.6): typing, which is bounded and refreshed before it expires,
 * and read cursors, which only move forward.
 */
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	({ client, socket } = startClient({ url: 'ws://fake.test/ws', onSnapshot: (next) => (snapshot = next) }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function latest(): FakeSocket {
	return FakeSocket.latest();
}

describe('typing', () => {
	beforeEach(async () => {
		await socket.greet();
		socket.receive({
			method: 'message',
			params: { message_id: '1724803200001', log_id: '1724803200001', room_id: 'lobby', from: { user_id: 'guest_1' }, body: { text: 'hi' } }
		});
	});

	/** Replaces the server frame, advertising capability `activity`. */
	function advertiseActivity(socket = latest()): void {
		socket.receive({ method: 'server', params: { apron: 9, agent: 'fake', auth: ['guest'], capabilities: ['activity'] } });
	}

	it('bounds typing traffic while refreshing it before expiry, and lets a sent message end it without another frame', () => {
		const socket = latest();
		advertiseActivity();
		const typing = () => socket.sent.filter(frame => frame.method === 'activity');
		// Twenty seconds of keystrokes: one frame at the start and one refresh twelve seconds in.
		for (let key = 0; key < 200; key++) {
			client.sendTyping('lobby', true);
			vi.advanceTimersByTime(100);
		}
		expect(typing()).toHaveLength(2);
		expect(typing()[0]).toEqual({ method: 'activity', params: { room_id: 'lobby', typing: 15 } });
		client.sendTyping('lobby', false);
		client.sendTyping('lobby', false);
		expect(typing()).toHaveLength(3);
		expect(typing().at(-1)?.params).toEqual({ room_id: 'lobby', typing: 0 });
		client.sendTyping('lobby', true);
		expect(typing()).toHaveLength(4);
		// A sent message ends it without another activity frame.
		client.send('lobby', 'hello').promise.catch(() => undefined);
		client.sendTyping('lobby', false);
		expect(typing()).toHaveLength(4);
	});

	it('sends no typing to a server without cap activity', () => {
		client.sendTyping('lobby', true);
		client.sendTyping('lobby', false);
		expect(latest().sent.filter(frame => frame.method === 'activity' || frame.method === 'typing')).toEqual([]);
	});

	it('keeps typing refreshes independent across rooms and transport reconnects', async () => {
		advertiseActivity();
		client.sendTyping('lobby', true);
		client.sendTyping('another-room', true);
		expect(latest().sent.filter(frame => frame.method === 'activity')).toHaveLength(2);
		latest().drop();
		client.retryNow();
		await latest().greet(['activity']);
		client.sendTyping('lobby', true);
		expect(latest().sent.filter(frame => frame.method === 'activity')).toHaveLength(1);
	});

	it('shows typing from activity broadcasts for the given seconds, until that user’s next message', () => {
		const bob = { user_id: 'bob', name: 'Bob' };
		const activity = (params: Record<string, unknown>) => latest().receive({ method: 'activity', params: { room_id: 'lobby', from: bob, ...params } });
		activity({ typing: 8 });
		expect(snapshot.typing).toEqual([{ room: 'lobby', from: bob }]);
		// Absent fields leave the state unchanged; read markers are not used.
		vi.advanceTimersByTime(5_000);
		activity({ read_message_id: '1724803200001' });
		expect(snapshot.typing).toEqual([{ room: 'lobby', from: bob }]);
		vi.advanceTimersByTime(3_000);
		expect(snapshot.typing).toEqual([]);
		// A refresh restarts the countdown; `typing: 0` stops at once.
		activity({ typing: 8 });
		vi.advanceTimersByTime(7_000);
		activity({ typing: 8 });
		vi.advanceTimersByTime(7_000);
		expect(snapshot.typing).toHaveLength(1);
		activity({ typing: 0 });
		expect(snapshot.typing).toEqual([]);
		// An unknown `typing` notification is ignored (§1).
		latest().receive({ method: 'typing', params: { room_id: 'lobby', from: bob, active: true } });
		expect(snapshot.typing).toEqual([]);
		// A new message from that user in the room ends it too.
		latest().receive({ method: 'activity', params: { room_id: 'lobby', from: bob, typing: 15 } });
		latest().receive({ method: 'activity', params: { room_id: 'lobby', from: { user_id: 'carol' }, typing: 15 } });
		// An edit is not a new message.
		latest().receive({ method: 'message', params: { message_id: '1724803200001', log_id: '1724803200002', room_id: 'lobby', from: bob, body: { text: 'edit' } } });
		expect(snapshot.typing.map((entry) => entry.from.user_id)).toEqual(['bob', 'carol']);
		latest().receive({ method: 'message', params: { message_id: '1724803200003', log_id: '1724803200003', room_id: 'lobby', from: bob, body: { text: 'done' } } });
		expect(snapshot.typing.map((entry) => entry.from.user_id)).toEqual(['carol']);
	});
});

describe('read cursors', () => {
	it('tracks read cursors forward only and advances your own with activity', async () => {
		await socket.greet(['history', 'rooms', 'activity'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
		const general = () => snapshot.rooms.find((room) => room.id === 'general')!;
		socket.receive({ method: 'activity', params: { room_id: 'general', from: { user_id: 'guest_1' }, read_message_id: '30' } });
		expect(general().readMessageId).toBe('30');
		socket.receive({ method: 'activity', params: { room_id: 'general', from: { user_id: 'guest_1' }, read_message_id: '25' } });
		expect(general().readMessageId).toBe('30');
		socket.sent = [];
		client.markRead('general', '29');
		expect(socket.sent).toEqual([]);
		client.markRead('general', '31');
		expect(socket.sent).toEqual([{ method: 'activity', params: { room_id: 'general', read_message_id: '31' } }]);
		expect(general().readMessageId).toBe('31');
		// Others' cursors do not move yours.
		socket.receive({ method: 'activity', params: { room_id: 'general', from: { user_id: 'bob' }, read_message_id: '40' } });
		expect(general().readMessageId).toBe('31');
	});

	it('takes your kept read cursor as the server sends it after listing the room (§4.6)', async () => {
		const room = { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '1724803312060', history_log_id: '10' };
		await socket.greet(['history', 'rooms', 'activity'], { room, you: { user_id: 'alice' } });
		// Right behind the room_list result, before the room's history: the New divider waits for that.
		socket.receive({ method: 'activity', params: { room_id: 'general', from: { user_id: 'alice' }, typing: 8, read_message_id: '1724803312050' } });
		const general = () => snapshot.rooms.find((entry) => entry.id === 'general')!;
		expect(general()).toMatchObject({ readMessageId: '1724803312050', loaded: false });
		await socket.reply('history', { more: false, latest_log_id: '1724803312060', history_log_id: '10' });
		expect(general()).toMatchObject({ readMessageId: '1724803312050', loaded: true });
	});

	it('keeps your read cursor locally when the server keeps none (ext:settings)', async () => {
		await socket.greet(['history', 'rooms', 'activity', 'ext:settings'], {
			room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' },
			ext: { settings: { read_cursors: false } }
		});
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
		socket.sent = [];
		client.markRead('general', '31');
		expect(socket.sent).toEqual([]);
		expect(snapshot.rooms.find((room) => room.id === 'general')?.readMessageId).toBe('31');
	});
});
