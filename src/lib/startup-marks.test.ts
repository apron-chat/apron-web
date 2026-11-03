import { describe, expect, it, vi } from 'vitest';

describe('startupMark', () => {
	it('marks each milestone the first time only, so a reconnect leaves the load’s marks as they were', async () => {
		// A fresh copy: the unit tests share their worker's modules, and others (the client's) make marks too.
		vi.resetModules();
		const { startupMark } = await import('./startup-marks');
		performance.clearMarks();
		startupMark('socket-open');
		startupMark('socket-open');
		startupMark('signed-in');
		expect(performance.getEntriesByType('mark').map((mark) => mark.name)).toEqual(['apron:socket-open', 'apron:signed-in']);
	});
});
