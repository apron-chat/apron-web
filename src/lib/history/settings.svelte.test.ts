import { describe, expect, it } from 'vitest';
import { clearLabels, HistorySettings, RETENTIONS } from './settings.svelte';

describe('HistorySettings', () => {
	it('names its retention as a title does, each word capitalized: Search shows it beside its title', () => {
		const settings = new HistorySettings();
		expect(RETENTIONS.map((retention) => ((settings.retention = retention.value), settings.title))).toEqual(['Don’t Keep', 'A Day', 'A Week', '30 Days', 'A Year', 'Forever']);
	});
});

describe('clearLabels', () => {
	it('says both in one button where the signed-in account is the only one kept', () => {
		expect(clearLabels({ accounts: 1, current: 4210, used: '18 MB' })).toEqual({ current: 'Clear current user (4,210 messages using 18 MB)' });
	});

	it('counts messages for the current user and accounts for all where there are others', () => {
		expect(clearLabels({ accounts: 3, current: 1, used: '18 MB' })).toEqual({ current: 'Clear current user (1 message)', all: 'Clear all users (3 accounts using 18 MB)' });
	});

	it('offers only all where none of the signed-in account’s is kept, and nothing where none is', () => {
		expect(clearLabels({ accounts: 1 })).toEqual({ all: 'Clear all users (1 account)' });
		expect(clearLabels({ accounts: 0, used: '2 MB' })).toEqual({ all: undefined });
	});
});
