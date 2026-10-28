// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { offerSignInQr } from './sign-in-qr';
import { renderMarkdown } from '$lib/protocol/markdown';

function body(markdown: string): HTMLElement {
	const node = document.createElement('div');
	node.innerHTML = renderMarkdown(markdown);
	return node;
}

describe('offerSignInQr', () => {
	it('gives a sign-in link a button that hands over its href as the server wrote it, once however often it runs', () => {
		const node = body('Open this link: <https://link.apron.chat/#server=wss://server.apron.chat/&token=apron_device_a%2Bb>');
		const show = vi.fn();
		offerSignInQr(node, show);
		offerSignInQr(node, show);
		const buttons = node.querySelectorAll('button');
		expect([...buttons].map((button) => [button.previousElementSibling?.tagName, button.textContent])).toEqual([['A', 'Show QR code']]);
		buttons[0].click();
		expect(show).toHaveBeenCalledWith('https://link.apron.chat/#server=wss://server.apron.chat/&token=apron_device_a%2Bb');
	});

	it('leaves links to places, the apron: form of a token, a token with no server, and other sites alone', () => {
		const node = body([
			'<https://link.apron.chat/#server=wss://server.apron.chat/&room=general>',
			'<https://link.apron.chat/#token=apron_device_x>',
			'<https://example.com/#server=wss://server.apron.chat/&token=apron_device_x>'
		].join('\n\n'));
		offerSignInQr(node, () => {});
		expect(node.querySelector('button')).toBeNull();
	});
});
