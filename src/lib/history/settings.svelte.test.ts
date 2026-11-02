import { describe, expect, it } from 'vitest';
import { clearLabels, HistorySettings, RETENTIONS } from './settings.svelte';

describe('HistorySettings', () => {
	it('names its retention as a title does, each word capitalized: Search shows it beside its title', () => {
		const settings = new HistorySettings();
		expect(RETENTIONS.map((retention) => ((settings.retention = retention.value), settings.title))).toEqual(['Don’t Keep', 'A Day', 'A Week', '30 Days', 'A Year', 'Forever']);
	});
});

describe('clearLabels', () => {
	it('says the space in one button where the signed-in account is the only one kept', () => {
		expect(clearLabels({ accounts: 1, current: true, used: '18 MB' })).toEqual({ current: 'Clear current user (18 MB)' });
	});

	it('counts accounts for all where there are others', () => {
		expect(clearLabels({ accounts: 3, current: true, used: '18 MB' })).toEqual({ current: 'Clear current user', all: 'Clear all users (3 accounts using 18 MB)' });
	});

	it('offers only all where none of the signed-in account’s is kept, and nothing where none is', () => {
		expect(clearLabels({ accounts: 1, current: false })).toEqual({ all: 'Clear all users (1 account)' });
		expect(clearLabels({ accounts: 0, current: false, used: '2 MB' })).toEqual({ all: undefined });
	});
});
