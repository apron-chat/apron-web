import { describe, expect, it } from 'vitest';
import { HistorySettings, RETENTIONS } from './settings.svelte';

describe('HistorySettings', () => {
	it('names its retention as a title does, each word capitalized: Search shows it beside its title', () => {
		const settings = new HistorySettings();
		expect(RETENTIONS.map((retention) => ((settings.retention = retention.value), settings.title))).toEqual(['Don’t Keep', 'A Day', 'A Week', '30 Days', 'A Year', 'Forever']);
	});
});
