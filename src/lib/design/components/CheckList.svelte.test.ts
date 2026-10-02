// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CheckList from './CheckList.svelte';

const options = [
	{ value: 'mentions', title: 'Mentions', text: 'When someone @-mentions you' },
	{ value: 'replies', title: 'Replies', text: 'Replies to your messages' },
	{ value: 'private', title: 'Private rooms', text: 'Every message in private rooms you’re in', disabled: true, note: 'Not offered by this server' }
];

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(CheckList, { target: document.body, props: { label: 'Notify me about', options, ...props } as never });
	flushSync();
	return [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
}

describe('CheckList', () => {
	it('names its group and each box by its label, and disables what isn\'t offered, saying why', () => {
		const boxes = render({ value: ['mentions'] });
		expect(document.querySelector('fieldset legend')?.textContent).toBe('Notify me about');
		expect(boxes.map((box) => box.closest('label')?.querySelector('.ap-choice-title')?.textContent)).toEqual(['Mentions', 'Replies', 'Private rooms']);
		expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);
		expect(boxes[2].disabled).toBe(true);
		expect(boxes[2].closest('label')?.textContent).toContain('Not offered by this server');
		expect(document.body.textContent?.match(/Not offered/g)).toHaveLength(1);
	});

	it('keeps the last checked box with `min`, and reports changes in the options\' order', () => {
		const onchange = vi.fn();
		let boxes = render({ value: ['mentions'], min: 1, onchange });
		// The only checked one can't be unchecked.
		expect(boxes[0].disabled).toBe(true);
		expect(boxes[1].disabled).toBe(false);
		boxes[1].click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith(['mentions', 'replies']);
		boxes = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
		// Two checked: either may go.
		expect(boxes[0].disabled).toBe(false);
		boxes[0].click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith(['replies']);
		expect(boxes[1].disabled).toBe(true);
	});
});
