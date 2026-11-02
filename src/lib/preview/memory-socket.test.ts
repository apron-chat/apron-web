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
			const socket = memorySocket('ws://memory.invalid', host, 100);
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
});
