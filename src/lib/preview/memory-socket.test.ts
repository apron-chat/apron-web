import { describe, expect, it, vi } from 'vitest';
import { memorySocket, type MemoryHost } from './memory-socket';

describe('memorySocket', () => {
	it('tells the host of a connection only while it is open: one closed from `onopen` is never opened', async () => {
		const host: MemoryHost = { opened: vi.fn(), received: vi.fn(), closed: vi.fn() };
		const socket = memorySocket('ws://memory.invalid', host);
		socket.onopen = () => socket.close();
		await Promise.resolve();
		expect(host.closed).toHaveBeenCalledTimes(1);
		expect(host.opened).not.toHaveBeenCalled();

		const open = memorySocket('ws://memory.invalid', host);
		await Promise.resolve();
		expect(host.opened).toHaveBeenCalledTimes(1);
		open.close();
	});

	it('plays a round trip when given one: opening takes all of it, each frame half, in order either way', async () => {
		vi.useFakeTimers();
		try {
			const received: unknown[] = [];
			let server: Parameters<MemoryHost['opened']>[0] | undefined;
			const host: MemoryHost = { opened: (end) => (server = end), received: (_end, frame) => received.push(frame), closed: vi.fn() };
			const socket = memorySocket('ws://memory.invalid', host, 100, () => Date.now());
			const heard: string[] = [];
			socket.onmessage = (event) => heard.push(event.data as string);
			await vi.advanceTimersByTimeAsync(99);
			expect(socket.readyState).toBe(0);
			await vi.advanceTimersByTimeAsync(1);
			expect(socket.readyState).toBe(1);

			socket.send(JSON.stringify({ id: 1 }));
			socket.send(JSON.stringify({ id: 2 }));
			await vi.advanceTimersByTimeAsync(49);
			expect(received).toEqual([]);
			await vi.advanceTimersByTimeAsync(1);
			expect(received).toEqual([{ id: 1 }, { id: 2 }]);

			server!.deliver({ id: 3 } as never);
			server!.deliver({ id: 4 } as never);
			expect(heard).toEqual([]);
			await vi.advanceTimersByTimeAsync(50);
			expect(heard.map((data) => JSON.parse(data).id)).toEqual([3, 4]);

			// A frame still on its way when the socket closes never arrives.
			server!.deliver({ id: 5 } as never);
			socket.close();
			await vi.advanceTimersByTimeAsync(50);
			expect(heard).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('times a reply from when its request was sent, even when the page was too busy to hand the request on in time', async () => {
		vi.useFakeTimers();
		try {
			let clock = 0;
			const now = () => clock;
			const host: MemoryHost = {
				opened: (end) => end.deliver({ method: 'server' } as never),
				received: (end, frame) => end.deliver({ id: frame.id, result: {} } as never),
				closed: vi.fn()
			};
			const socket = memorySocket('ws://memory.invalid', host, 100, now);
			const heard: { id?: unknown; method?: unknown; at: number }[] = [];
			socket.onmessage = (event) => heard.push({ ...JSON.parse(event.data as string), at: clock });
			const step = async (ms: number) => {
				clock += ms;
				await vi.advanceTimersByTimeAsync(ms);
			};
			await step(100);
			await step(50);
			// The greeting leaves as the connection opens: half a round trip after.
			expect(heard).toEqual([{ method: 'server', at: 150 }]);

			socket.send(JSON.stringify({ id: 1 }));
			// The page is busy for 200 ms: no timer runs, and the request reaches the in-page server only then.
			clock += 200;
			// (A timer set while fake timers run is due a millisecond later at least.)
			await vi.advanceTimersByTimeAsync(51);
			// Its reply was due 100 ms after it was sent, long since: it arrives as soon as the page is free.
			expect(heard.at(-1)).toEqual({ id: 1, result: {}, at: 350 });

			socket.send(JSON.stringify({ id: 2 }));
			socket.send(JSON.stringify({ id: 3 }));
			await step(99);
			expect(heard).toHaveLength(2);
			await step(1);
			expect(heard.slice(2).map((frame) => [frame.id, frame.at])).toEqual([[2, 450], [3, 450]]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('opens before its server is there, which hears of it once it is, the times as they would have been', async () => {
		vi.useFakeTimers();
		try {
			let clock = 0;
			const now = () => clock;
			let ready!: (host: MemoryHost) => void;
			const host: MemoryHost = {
				opened: (end) => end.deliver({ method: 'server' } as never),
				received: (end, frame) => end.deliver({ id: frame.id, result: {} } as never),
				closed: vi.fn()
			};
			const socket = memorySocket('ws://memory.invalid', new Promise<MemoryHost>((resolve) => (ready = resolve)), 100, now);
			const heard: { at: number }[] = [];
			socket.onmessage = (event) => heard.push({ ...JSON.parse(event.data as string), at: clock });
			clock = 100;
			await vi.advanceTimersByTimeAsync(100);
			expect(socket.readyState).toBe(1);
			clock = 300;
			await vi.advanceTimersByTimeAsync(200);
			expect(heard).toEqual([]);
			// The server's code loads: its greeting was due half a round trip after the open, so it arrives at once.
			ready(host);
			await vi.advanceTimersByTimeAsync(1);
			expect(heard).toEqual([{ method: 'server', at: 300 }]);
			socket.send(JSON.stringify({ id: 1 }));
			clock = 400;
			await vi.advanceTimersByTimeAsync(100);
			expect(heard.at(-1)).toEqual({ id: 1, result: {}, at: 400 });

			// Closed before its server came: the server never hears of it.
			let never!: (host: MemoryHost) => void;
			const other = memorySocket('ws://memory.invalid', new Promise<MemoryHost>((resolve) => (never = resolve)), 100, now);
			clock = 500;
			await vi.advanceTimersByTimeAsync(100);
			other.close();
			never(host);
			await vi.advanceTimersByTimeAsync(1);
			expect(host.closed).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
