// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import NoticeLine from './NoticeLine.svelte';
import { signInQrDialog } from './lazy';
import type { Notice } from '$lib/protocol/client';
import * as dom from '$lib/test/dom';
import { byText, queryByText } from '$lib/test/queries';

beforeAll(dom.stubDialog);

const LINK = 'https://link.apron.chat/#server=wss://server.apron.chat/&token=apron_device_Qm7xHk41x9';

/** The `/invite-device` notice of apron-server-cloudflare, as it writes it. */
const INVITE_DEVICE = [
	'This token signs in as you (`ada`) on your device **phone**. It does not expire, and anyone who has it can sign in as you, so keep it secret. `/invite-device phone` again replaces it.',
	'```\napron_device_Qm7xHk41x9\n```',
	`Or open this link on **phone**, which signs you in there with any Apron app: <${LINK}>`
].join('\n\n');

function notice(from: string, text: string): Notice {
	return { key: 'n1', room_id: 'general', from: { user_id: from, name: 'System message to you' }, body: { text, format: 'markdown' }, after: '0', at: 1724803200042 };
}

describe('NoticeLine', () => {
	it('offers the QR code of a sign-in link in a notice only for you, and shows it, with its warning, only once asked', async () => {
		await signInQrDialog.load();
		dom.render(NoticeLine, { notice: notice('~private', INVITE_DEVICE), onopenroom: () => {} });
		expect(document.querySelector('svg.ap-qr')).toBeNull();
		byText('Show QR code').click();
		flushSync();
		const dialog = dom.byRole<HTMLDialogElement>('dialog');
		expect(dialog.open).toBe(true);
		expect(dialog.querySelector('svg.ap-qr')?.getAttribute('aria-label')).toBe('QR code of the sign-in link');
		expect(dialog.textContent).toContain('Anyone who scans this code can sign in as you.');
		expect(dialog.textContent).not.toContain('apron_device_');
		byText('Done').click();
		flushSync();
		expect(document.querySelector('dialog')).toBeNull();
	});

	it('offers none in a notice to the room, nor for a link that carries no token', () => {
		dom.render(NoticeLine, { notice: notice('~room', INVITE_DEVICE), onopenroom: () => {} });
		dom.render(NoticeLine, { notice: notice('~private', '```\ncode\n```\n\n<https://link.apron.chat/#server=wss://server.apron.chat/&room=general>'), onopenroom: () => {} });
		expect(queryByText('Show QR code')).toBeNull();
	});
});
