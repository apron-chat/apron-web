import { describe, expect, it } from 'vitest';
import { toggleTask } from './task-list';

describe('toggleTask', () => {
	it('checks and unchecks the marker on a line, leaving the rest as written', () => {
		const source = '- [ ] Foo\n- [x] Bar';
		expect(toggleTask(source, 0, true)).toBe('- [x] Foo\n- [x] Bar');
		expect(toggleTask(source, 1, false)).toBe('- [ ] Foo\n- [ ] Bar');
	});

	it('finds the marker after quotes, numbers and indentation', () => {
		expect(toggleTask('intro\r\n\r\n> 1. a\r\n>    - [X] deep', 3, false)).toBe('intro\r\n\r\n> 1. a\r\n>    - [ ] deep');
		expect(toggleTask('* \t[ ] tab', 0, true)).toBe('* \t[x] tab');
	});

	it('saves nothing for a line without a marker, or one already as asked', () => {
		expect(toggleTask('- [ ] Foo', 1, true)).toBeUndefined();
		expect(toggleTask('- Foo [ ]', 0, true)).toBeUndefined();
		expect(toggleTask('- [x] Foo', 0, true)).toBeUndefined();
	});

});
