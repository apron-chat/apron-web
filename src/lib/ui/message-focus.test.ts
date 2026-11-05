// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { articleOf, isMessageRow, MESSAGE_STEPS, messageRows, stepMessage, timelineItems } from './message-focus';

afterEach(() => (document.body.innerHTML = ''));

/** A timeline: `m` a person's message, `s` a system line, `n` a scoped notice, `t` a thread card; each named by its place. */
function timeline(kinds: string): HTMLElement {
	const list = document.createElement('div');
	list.innerHTML = [...kinds].map((kind, at) => ({
		m: `<article class="ap-msg" data-message-id="${at}" tabindex="-1"><button>Reply</button></article>`,
		s: `<article class="ap-msg ap-msg-system" data-message-id="${at}" tabindex="-1"></article>`,
		n: `<article class="ap-notice" data-message-id="${at}" tabindex="-1"></article>`,
		t: `<button class="ap-thread">thread ${at}</button>`
	})[kind]).join('');
	document.body.append(list);
	return list;
}
const id = (row: HTMLElement | undefined) => row?.dataset.messageId;

describe('messageRows', () => {
	it('lists people\'s messages oldest first, past system lines, notices and thread cards', () => {
		const list = timeline('msmntm');
		expect(messageRows(list).map(id)).toEqual(['0', '2', '5']);
		expect(isMessageRow(list.querySelector('article.ap-msg'))).toBe(true);
		expect(isMessageRow(list.querySelector('.ap-msg-system'))).toBe(false);
		// The keyboard on something in a row isn't on the row.
		expect(isMessageRow(list.querySelector('article.ap-msg button'))).toBe(false);
	});
});

describe('stepMessage', () => {
	const rows = messageRows(timeline('mmmmmm'));

	it('moves one up or down, to the ends, or a page, and stops past an end', () => {
		expect(id(stepMessage(rows, rows[3], 'previous'))).toBe('2');
		expect(id(stepMessage(rows, rows[3], 'next'))).toBe('4');
		expect(id(stepMessage(rows, rows[3], 'first'))).toBe('0');
		expect(id(stepMessage(rows, rows[3], 'last'))).toBe('5');
		expect(id(stepMessage(rows, rows[3], 'pageUp', 2))).toBe('1');
		expect(id(stepMessage(rows, rows[1], 'pageUp', 4))).toBe('0');
		expect(id(stepMessage(rows, rows[3], 'pageDown', 4))).toBe('5');
		// Past the oldest (older ones to load) and the newest (the composer next): nothing here.
		expect(stepMessage(rows, rows[0], 'previous')).toBeUndefined();
		expect(stepMessage(rows, rows[0], 'first')).toBeUndefined();
		expect(stepMessage(rows, rows[0], 'pageUp', 3)).toBeUndefined();
		expect(stepMessage(rows, rows[5], 'next')).toBeUndefined();
		expect(stepMessage(rows, rows[5], 'last')).toBeUndefined();
	});

	it('maps the keys, Shift and the rest left to their owners', () => {
		expect(MESSAGE_STEPS).toMatchObject({ ArrowUp: 'previous', ArrowDown: 'next', Home: 'first', End: 'last', PageUp: 'pageUp', PageDown: 'pageDown' });
		expect(MESSAGE_STEPS.Enter).toBeUndefined();
	});
});

describe('timelineItems', () => {
	it('stops at messages and notices, and what between them takes the keyboard, not at what is in a message', () => {
		const list = timeline('mntsm');
		expect(timelineItems(list).map((item) => item.dataset.messageId ?? item.textContent)).toEqual(['0', '1', 'thread 2', '4']);
		expect(articleOf(list.querySelector('article.ap-msg button')!)?.dataset.messageId).toBe('0');
		expect(articleOf(list.querySelector('.ap-thread')!)).toBeUndefined();
	});
});
