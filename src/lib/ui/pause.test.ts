import { describe, expect, it } from 'vitest';
import { isPaused, muteFor, pauseChoices, pausedUntilLabel } from './pause';

describe('pausing notifications', () => {
	const now = new Date(2026, 9, 2, 13, 30);
	const clock = (hours: number, minutes = 0) => new Date(2026, 9, 2, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	it('offers an hour, eight hours, tomorrow at 9:00, and until resumed, each with when it ends', () => {
		const choices = pauseChoices(now);
		expect(choices.map((choice) => choice.label)).toEqual(['For 1 hour', 'For 8 hours', 'Until tomorrow', 'Until I resume']);
		expect(choices[0]).toMatchObject({ hint: `until ${clock(14, 30)}`, until: now.getTime() + 3_600_000 });
		expect(choices[1]).toMatchObject({ hint: `until ${clock(21, 30)}`, until: now.getTime() + 8 * 3_600_000 });
		expect(choices[2]).toMatchObject({ hint: clock(9), until: new Date(2026, 9, 3, 9).getTime() });
		expect(choices[3]).toEqual({ value: 'resume', label: 'Until I resume', until: true });
	});

	it('sends mute as the seconds left, at least one, or true', () => {
		expect(muteFor(now.getTime() + 3_600_000, now.getTime())).toBe(3600);
		expect(muteFor(now.getTime() + 1500, now.getTime())).toBe(2);
		expect(muteFor(now.getTime() - 5000, now.getTime())).toBe(1);
		expect(muteFor(true, now.getTime())).toBe(true);
	});

	it('is paused until the end, or until resumed, and not after (desktop notifications stay quiet meanwhile)', () => {
		expect(isPaused(true, now.getTime())).toBe(true);
		expect(isPaused(now.getTime() + 1, now.getTime())).toBe(true);
		expect(isPaused(now.getTime(), now.getTime())).toBe(false);
		expect(isPaused(undefined, now.getTime())).toBe(false);
	});

	it('says when a pause ends', () => {
		expect(pausedUntilLabel(new Date(2026, 9, 2, 14, 30).getTime(), now)).toBe(`until ${clock(14, 30)}`);
		expect(pausedUntilLabel(new Date(2026, 9, 3, 9).getTime(), now)).toBe(`until tomorrow ${clock(9)}`);
		expect(pausedUntilLabel(new Date(2026, 9, 6, 9).getTime(), now)).toMatch(/^until \S+ /);
		expect(pausedUntilLabel(true, now)).toBe('until you resume');
	});
});
