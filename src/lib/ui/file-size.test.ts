import { describe, expect, it } from 'vitest';
import { fileSize } from './file-size';

describe('fileSize', () => {
	it('reads as bytes, KB or MB', () => {
		expect([fileSize(512), fileSize(12_800), fileSize(1_468_006)]).toEqual(['512 B', '13 KB', '1.4 MB']);
	});
});
