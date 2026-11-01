import { describe, expect, it, vi } from 'vitest';
import { editLiveText } from '$lib/protocol/live-text';
import { LiveTyping, liveEdit, liveTextOf, type LiveTypingEnd, type LiveTypingTransport } from './live-typing';

/** A transport whose write is read by the test: what readers would show, and the write's end. */
function transport(start: LiveTypingTransport['start'] = async () => ({ messageId: 'm1', writeUrl: 'https://chat.example/w/1' })) {
	const state = { shown: '', closed: false, respond: (_response: Response) => {}, fail: (_cause: unknown) => {} };
	const decoder = new TextDecoder();
	const write: LiveTypingTransport['write'] = (_url, body) => {
		void (async () => {
			const reader = body.getReader();
			for (;;) {
				const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
				if (done) break;
				state.shown = editLiveText(state.shown, decoder.decode(value, { stream: true }));
			}
			state.closed = true;
		})();
		return new Promise<Response>((resolve, reject) => {
			state.respond = resolve;
			state.fail = reject;
		});
	};
	return { state, transport: { start, write } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LiveTyping', () => {
	it('streams the composer as edits, and readers show the composer', async () => {
		const { state, transport: t } = transport();
		const onend = vi.fn();
		const typing = new LiveTyping('', t, onend);
		typing.update('hel');
		await typing.started;
		typing.update('hello');
		typing.update('help');
		typing.update('help me');
		await settle();
		expect(state.shown).toBe('help me');
		expect(typing.text).toBe('help me');
		expect(await typing.finish()).toBe('m1');
		expect(typing.active).toBe(false);
		typing.update('ignored');
		typing.close();
		await settle();
		expect(state.shown).toBe('help me');
		expect(state.closed).toBe(true);
		expect(onend).not.toHaveBeenCalled();
	});

	it('writes what was typed before the message was posted', async () => {
		const { state, transport: t } = transport();
		const typing = new LiveTyping('', t, () => {});
		typing.update('early');
		await typing.started;
		await settle();
		expect(state.shown).toBe('early');
	});

	it('tells of a write that could not be made', async () => {
		const { state, transport: t } = transport();
		const ends: LiveTypingEnd[] = [];
		const typing = new LiveTyping('', t, (end) => ends.push(end));
		await typing.started;
		state.fail(new TypeError('Failed to fetch'));
		await settle();
		expect(ends).toEqual([{ kind: 'failed', messageId: 'm1', reason: 'This connection can’t stream live text' }]);
		expect(typing.active).toBe(false);
		expect(await typing.finish()).toBeUndefined();
	});

	it('tells of a text the server ended, with its reason', async () => {
		const { state, transport: t } = transport();
		const ends: LiveTypingEnd[] = [];
		const typing = new LiveTyping('', t, (end) => ends.push(end));
		await typing.started;
		state.respond(new Response('This live text is limited to 64 KB; it ended\n', { status: 413 }));
		await settle();
		expect(ends).toEqual([{ kind: 'ended', messageId: 'm1', reason: 'This live text is limited to 64 KB; it ended' }]);
	});

	it('tells of a message that was not posted', async () => {
		const { transport: t } = transport(() => Promise.reject(new Error('Not allowed')));
		const ends: LiveTypingEnd[] = [];
		const typing = new LiveTyping('', t, (end) => ends.push(end));
		await typing.started;
		expect(ends).toEqual([{ kind: 'failed', reason: 'Not allowed' }]);
	});

	it('says nothing of the write ending after it was finished', async () => {
		const { state, transport: t } = transport();
		const onend = vi.fn();
		const typing = new LiveTyping('', t, onend);
		await typing.started;
		await typing.finish();
		state.respond(new Response('gone', { status: 410 }));
		await settle();
		expect(onend).not.toHaveBeenCalled();
	});
});

describe('liveEdit (a sender of append live text, §4.8.5)', () => {
	it('sends typing at the end as it is, and nothing for no change', () => {
		expect(liveEdit('', 'hi')).toBe('hi');
		expect(liveEdit('hi', 'hi there')).toBe(' there');
		expect(liveEdit('same', 'same')).toBe('');
	});

	it('backspaces one character deleted from the end, by code point', () => {
		expect(liveEdit('hello', 'hell')).toBe('\b');
		expect(liveEdit('a😀', 'a')).toBe('\b');
		// An emoji with its skin tone is one character of two code points.
		expect(liveEdit('ok 👍🏽', 'ok ')).toBe('\b\b');
	});

	it('resets to the whole text when text was replaced', () => {
		// The second half selected and deleted, then typed over.
		expect(liveEdit('Hello there, world', 'Hello th')).toBe('\fHello th');
		expect(liveEdit('Hello th', 'Hello thx')).toBe('x');
		// The first half selected and deleted.
		expect(liveEdit('Hello there, world', 'ere, world')).toBe('\fere, world');
		// A selection typed over, and an edit before the end.
		expect(liveEdit('Hello wrold', 'Hello world')).toBe('\fHello world');
		expect(liveEdit('Helo world', 'Hello world')).toBe('\fHello world');
		expect(liveEdit('a😀', 'a😃')).toBe('\fa😃');
		expect(liveEdit('abc', '')).toBe('\f');
	});

	it('gives readers the new text, whatever the change', () => {
		const texts = ['', 'h', 'he', 'hello', 'hell', 'help', 'help 😀', 'help 😃!', 'x', 'xy\nz', '', '日本語', '日本', '日本 👍🏽', '日本 '];
		let shown = '';
		let sent = '';
		for (const next of texts) {
			shown = editLiveText(shown, liveEdit(sent, next));
			sent = next;
			expect(shown).toBe(next);
		}
	});

	it('leaves backspace and form feed out of what is sent', () => {
		expect(liveTextOf('a\bb\fc')).toBe('abc');
	});
});
