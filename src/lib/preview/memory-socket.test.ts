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
});
