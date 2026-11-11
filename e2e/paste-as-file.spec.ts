import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/** About 1 KB of Markdown, with Windows line breaks as a clipboard may hold them. */
const DOC = ['# Rollout plan', '', ...Array.from({ length: 30 }, (_, n) => `${n + 1}. Promote the next slice of hosts.`)].join('\r\n');
/** The same, as the draft holds it. */
const AS_DRAFTED = DOC.replace(/\r\n/g, '\n');

/** Pastes `text` into the composer from the clipboard, as Ctrl+V or ⌘V does. */
async function paste(page: Page, text: string): Promise<void> {
	await page.evaluate((text) => navigator.clipboard.writeText(text), text);
	await page.keyboard.press('ControlOrMeta+V');
}

const button = (page: Page) => page.getByRole('button', { name: 'Attach as file instead' });

test.describe('a long paste into the composer', () => {
	test.use({ ...DEVICES.desktop, knobs: { capabilities: ['embed:upload'] } });
	test.beforeEach(async ({ context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	});

	test('offers to attach it as a file; taken, the paste becomes pasted.md and what was typed around it is the message', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('Here is the plan: ');
		await paste(page, DOC);
		await page.keyboard.type(' Thoughts?');
		await expect(button(page)).toHaveAttribute('title', 'Send the pasted text as pasted.md (1 KB) rather than in the message');

		await button(page).click();
		await expect(button(page)).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Rename pasted.md' })).toBeVisible();
		await expect(preview.composer()).toBeFocused();
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.embeds?.length > 0);
		expect(sent.body.text).toBe('Here is the plan:  Thoughts?');
		expect(sent.body.embeds).toEqual([expect.objectContaining({ kind: 'upload', title: 'pasted.md' })]);
	});

	test('isn\'t offered for a short paste, and goes once the pasted text is edited away or sent', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await paste(page, 'a short line, well under a kilobyte');
		await expect(preview.composer()).toContainText('a short line');
		await expect(button(page)).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+A');
		await paste(page, DOC);
		await expect(button(page)).toBeVisible();
		// Typing within it: it is no longer what was pasted.
		await page.keyboard.press('ArrowUp');
		await page.keyboard.type('x');
		await expect(button(page)).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+A');
		await paste(page, DOC);
		await expect(button(page)).toBeVisible();
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text === AS_DRAFTED);
		await expect(button(page)).toHaveCount(0);
	});
});

test.describe('a long paste where the server takes no files', () => {
	test.use({ ...DEVICES.desktop });

	test('isn\'t offered', async ({ preview, page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await preview.open();
		await preview.composer().click();
		await paste(page, DOC);
		await expect(preview.composer()).toContainText('Rollout plan');
		await expect(button(page)).toHaveCount(0);
	});
});

test.describe('a long paste on a phone', () => {
	test.use({ ...DEVICES.phone, knobs: { capabilities: ['embed:upload'] } });

	test('fits the offer in the composer\'s row of buttons, its words shortened', async ({ preview, page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await preview.open();
		await preview.press(preview.composer());
		await paste(page, DOC);
		await expect(button(page)).toHaveText('As file', { useInnerText: true });
		const [form, offer, send] = await Promise.all([page.locator('form.ap-composer').boundingBox(), button(page).boundingBox(), page.getByRole('button', { name: 'Send message' }).boundingBox()]);
		expect(offer!.x + offer!.width).toBeLessThanOrEqual(send!.x);
		expect(send!.x + send!.width).toBeLessThanOrEqual(form!.x + form!.width);
	});
});

