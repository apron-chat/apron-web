import { describe, expect, it } from 'vitest';
import { enterAction } from './handheld';

describe('enterAction', () => {
	it('sends with a keyboard, and Shift+Enter starts a new line', () => {
		expect(enterAction({ shiftKey: false }, false)).toBe('send');
		expect(enterAction({ shiftKey: true }, false)).toBe('newline');
	});

	it('starts a new line on a phone or tablet, Shift or not: Send is the button', () => {
		expect(enterAction({ shiftKey: false }, true)).toBe('newline');
		expect(enterAction({ shiftKey: true }, true)).toBe('newline');
	});
});
