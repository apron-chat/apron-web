// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decorateCode } from './copy-code';

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
});
