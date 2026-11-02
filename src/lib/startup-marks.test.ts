import { describe, expect, it } from 'vitest';
import { startupMark } from './startup-marks';

describe('startupMark', () => {
	it('marks each milestone the first time only, so a reconnect leaves the load’s marks as they were', () => {
		performance.clearMarks();
		startupMark('socket-open');
		startupMark('socket-open');
		startupMark('signed-in');
		expect(performance.getEntriesByType('mark').map((mark) => mark.name)).toEqual(['apron:socket-open', 'apron:signed-in']);
	});
});
