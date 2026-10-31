import { describe, expect, it } from 'vitest';
import { parseThemeCss, THEMES } from './appearance.svelte';
import { contrast, deriveTokens, readBase } from './theme-colors';

/** One mode's color of a token a theme sets: `light-dark()`'s half, or the one color. */
function color(vars: Map<string, string>, name: string, mode: 'light' | 'dark') {
	const base = readBase(vars.get(name)!);
	if (!base) throw new Error(`${name} isn't a color: ${vars.get(name)}`);
	return base[mode];
}

describe('theme colors', () => {
	it('reads a base as one #hex for both modes, or light-dark(#hex, #hex)', () => {
		expect(readBase('#abc')).toEqual({ light: [170, 187, 204], dark: [170, 187, 204] });
		expect(readBase('light-dark(#ffffff, #000000)')).toEqual({ light: [255, 255, 255], dark: [0, 0, 0] });
		expect(readBase('red')).toBeUndefined();
		expect(readBase('light-dark(#fff, var(--x))')).toBeUndefined();
	});

	it('derives the palette from ground and ink, one value where both modes agree, and lets the theme\'s own tokens win', () => {
		const derived = new Map(deriveTokens(new Map([['--base-ground', '#000000'], ['--base-ink', 'light-dark(#ffffff, #eeeeee)']])));
		expect(derived.get('--bg-100')).toBe('#000000');
		expect(derived.get('--ink')).toBe('light-dark(#ffffff, #eeeeee)');
		expect(derived.has('--accent')).toBe(false);
		expect(deriveTokens(new Map([['--base-accent', '#ff0000']]))).toEqual([]);
		const theme = new Map(parseThemeCss('--base-ground: #ffffff; --base-ink: #000000; --base-accent: #8a2c08; --line: #123456;').vars);
		expect(theme.get('--line')).toBe('#123456');
		expect(theme.get('--on-accent')).toBe('#ffffff');
	});

	it('gives every premade theme with base colors readable text, links, accents and borders, light and dark', () => {
		for (const theme of THEMES) {
			const vars = new Map(parseThemeCss(theme.css).vars);
			if (!vars.has('--base-ground')) continue;
			for (const mode of ['light', 'dark'] as const) {
				const ground = color(vars, '--bg-100', mode);
				for (const ink of ['--ink', '--ink-muted', '--denim', '--accent']) expect(contrast(color(vars, ink, mode), ground), `${theme.id} ${ink} ${mode}`).toBeGreaterThanOrEqual(4.5);
				expect(contrast(color(vars, '--on-accent', mode), color(vars, '--accent', mode)), `${theme.id} --on-accent ${mode}`).toBeGreaterThanOrEqual(4.5);
				for (const groundName of ['--bg-100', '--bg-200']) expect(contrast(color(vars, '--line-strong', mode), color(vars, groundName, mode)), `${theme.id} --line-strong on ${groundName} ${mode}`).toBeGreaterThanOrEqual(3);
			}
		}
	});
});
