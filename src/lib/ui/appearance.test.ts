import { describe, expect, it } from 'vitest';
import { decodeAppearance, DEFAULT_APPEARANCE, sanitizeFontFamily } from './appearance.svelte';

describe('appearance preferences', () => {
	it('defaults to system theme and font stacks', () => {
		expect(decodeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
	});

	it('keeps only supported theme modes and safe single font family names', () => {
		expect(decodeAppearance({ mode: 'dark', interfaceFont: 'Inter', chatFont: 'Atkinson Hyperlegible', monoFont: 'JetBrains Mono' })).toEqual({
			mode: 'dark', interfaceFont: 'Inter', chatFont: 'Atkinson Hyperlegible', monoFont: 'JetBrains Mono'
		});
		expect(decodeAppearance({ mode: 'sepia', interfaceFont: 'Foo; color:red', chatFont: 'Bar, sans-serif', monoFont: 'Baz' })).toEqual({
			mode: 'system', interfaceFont: '', chatFont: '', monoFont: 'Baz'
		});
	});

	it('rejects font-family syntax rather than accepting raw CSS', () => {
		expect(sanitizeFontFamily('Comic Sans MS')).toBe('Comic Sans MS');
		expect(sanitizeFontFamily('Arial, sans-serif')).toBe('');
		expect(sanitizeFontFamily('"Injected; color:red')).toBe('');
		expect(sanitizeFontFamily('x'.repeat(65))).toBe('');
	});
});
