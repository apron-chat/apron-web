import { DEVICES, expect, test } from './fixtures';

/** A draft long enough to write in the full panel. */
const DOC = ['# Rollout plan', '', ...Array.from({ length: 30 }, (_, n) => `${n + 1}. Promote the next slice of hosts.`)].join('\n');

for (const [device, use] of [['desktop', DEVICES.desktop], ['phone', DEVICES.phone]] as const) {
	test.describe(`the composer, on a ${device}`, () => {
		test.use({ ...use, knobs: { capabilities: ['embed:upload'] } });

		test('offers Embed as attachment once the draft has a second line, and embeds it as message.md, then a caption and send', async ({ preview, page }) => {
			await preview.open();
			await preview.press(preview.composer());
			const embed = page.getByRole('button', { name: 'Embed as attachment' });
			await page.keyboard.insertText('One line');
			// One line: neither Expand nor Embed as attachment.
			await expect(embed).toHaveCount(0);
			await page.keyboard.press('ControlOrMeta+A');
			await page.keyboard.insertText(DOC);
			// More than one: both, in the compact composer's row, with Send still in it.
			await expect(page.getByTestId('composer-expand')).toBeVisible();
			await expect(embed).toBeInViewport();
			await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
			if (device === 'phone') {
				// From the full panel, which closes as the draft leaves it.
				await preview.press(page.getByTestId('composer-expand'));
				await expect(page.getByTestId('composer-panel')).toBeVisible();
				await expect(embed).toBeInViewport();
			}

			await preview.press(embed);
			await expect(page.getByTestId('composer-panel')).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Rename message.md' })).toBeVisible();
			await expect(preview.composer()).toHaveText('');
			// The keyboard is still in the field, for a caption.
			await expect(preview.composer()).toBeFocused();
			await page.keyboard.type('The plan, as a file');
			await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
			const sent = await preview.waitForSent('message', (p) => p.body?.embeds?.length > 0);
			expect(sent.body.text).toBe('The plan, as a file');
			expect(sent.body.embeds).toEqual([expect.objectContaining({ kind: 'upload', title: 'message.md' })]);
		});
	});
}
