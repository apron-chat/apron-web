// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCode, decorateCode } from './copy-code';

afterEach(() => vi.unstubAllGlobals());

function body(): HTMLElement {
	const node = document.createElement('div');
	node.innerHTML = '<pre><code>apron_bot_token</code></pre><p>and</p><pre><code>two</code></pre>';
	return node;
}

describe('decorateCode', () => {
	it('gives each code block of a notice a Copy button, and a message’s none', () => {
		const notice = body();
		decorateCode(notice, true);
		expect([...notice.querySelectorAll('pre')].map((pre) => pre.querySelector('button')?.textContent)).toEqual(['Copy', 'Copy']);
		const message = body();
		expect(decorateCode(message, false)).toBeUndefined();
		expect(message.querySelector('button')).toBeNull();
	});

	it('says Copy failed where there is no clipboard (plain http), rather than nothing', async () => {
		vi.stubGlobal('navigator', {});
		const node = body();
		const action = copyCode(node);
		const copy = node.querySelector('button')!;
		copy.click();
		await vi.waitFor(() => expect(copy.textContent).toBe('Copy failed'));
		action.destroy();
	});
});
