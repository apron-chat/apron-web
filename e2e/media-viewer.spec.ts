import type { CDPSession, Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * A phone's screen on `page`: `touch` sends touches as it does, each finger a point, by the order given (an empty list
 * lifts them all). One session throughout, as the browser keeps track of the fingers down by it.
 */
async function screenOf(page: Page): Promise<{ touch: (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) => Promise<void> }> {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	return {
		touch: async (type, points) => {
			await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ ...point, id })) });
		}
	};
}

/** The demo's two photos from the ridge, in `general`, oldest first. */
const DUSK = 'dusk-over-the-ridge.jpg';
const DAWN = 'first-light.jpg';

test.describe('the image viewer', () => {
	test.use({ ...DEVICES.phone });

	test('opens on a tap, pages to the next, and the phone\'s Back closes it, back on the image last shown', async ({ preview, page }) => {
		await preview.open();
		const links = page.locator('a.ap-embed-imagelink');
		await preview.press(links.first());
		const viewer = page.getByRole('dialog', { name: DUSK });
		await expect(viewer).toBeVisible();
		await expect(viewer.locator('.ap-viewer-count')).toHaveText('1 of 2');
		await preview.press(viewer.getByRole('button', { name: 'Next image' }));
		await expect(page.getByRole('dialog', { name: DAWN })).toBeVisible();

		await page.goBack();
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(links.nth(1)).toBeFocused();
		await expect(page.locator('article[data-message-id]').first()).toBeVisible();
	});
});

test.describe('the image viewer, zoomed on a phone', () => {
	test.use({ ...DEVICES.phone });

	test('pinches the image larger about the fingers, drags it no further than its edges, and a double tap shows it whole; the page itself never zooms', async ({ preview, page }) => {
		await preview.open();
		const { touch } = await screenOf(page);
		await preview.press(page.locator('a.ap-embed-imagelink').first());
		const viewer = page.getByRole('dialog', { name: DUSK });
		const image = viewer.locator('img.ap-viewer-media');
		const stage = viewer.locator('.ap-viewer-stage');
		await expect(image).toBeVisible();
		await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
		const whole = (await image.boundingBox())!;
		const area = (await stage.boundingBox())!;
		const centre = { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 };

		await test.step('two fingers spread apart zoom in about them, and a pinch closes nothing', async () => {
			await touch('touchStart', [{ x: centre.x - 30, y: centre.y }, { x: centre.x + 30, y: centre.y }]);
			for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: centre.x - 30 - step * 15, y: centre.y }, { x: centre.x + 30 + step * 15, y: centre.y }]);
			await touch('touchEnd', []);
			const zoomed = (await image.boundingBox())!;
			// Spread from 60 to 240 apart: four times as large, still centred where the fingers were.
			expect(zoomed.width / whole.width).toBeCloseTo(4, 0);
			expect(Math.abs(zoomed.x + zoomed.width / 2 - centre.x)).toBeLessThan(2);
			await expect(viewer).toBeVisible();
			expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
		});

		await test.step('one finger drags it, as far as its edge and no further', async () => {
			await touch('touchStart', [{ x: centre.x, y: centre.y }]);
			for (let step = 1; step <= 10; step++) await touch('touchMove', [{ x: centre.x + step * 200, y: centre.y }]);
			await touch('touchEnd', []);
			const dragged = (await image.boundingBox())!;
			// Its left edge reaches the screen's, and stops there: no gap beside it.
			expect(Math.abs(dragged.x - area.x)).toBeLessThan(1);
			// A tap beside nothing, now it fills the screen, closes nothing either.
			await touch('touchStart', [{ x: area.x + 10, y: centre.y }]);
			await touch('touchEnd', []);
			await page.waitForTimeout(400);
			await expect(viewer).toBeVisible();
		});

		await test.step('a double tap shows it whole, and another zooms in where it lands', async () => {
			const tap = async (x: number, y: number) => {
				await touch('touchStart', [{ x, y }]);
				await touch('touchEnd', []);
			};
			await tap(centre.x, centre.y);
			await tap(centre.x, centre.y);
			await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));
			await page.waitForTimeout(400);
			// Off the middle: the point tapped stays where it was across the image.
			const at = { x: centre.x + 50, y: centre.y };
			await tap(at.x, at.y);
			await tap(at.x, at.y);
			await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2.5);
			const zoomed = (await image.boundingBox())!;
			expect((at.x - zoomed.x) / zoomed.width).toBeCloseTo((at.x - whole.x) / whole.width, 2);
		});

		await test.step('a finger left down as the viewer closes leaves nothing behind: opened again, one finger drags no zoom, a double tap zooms, and a tap beside it closes it', async () => {
			// A finger down on the image as it closes, whose lift then goes elsewhere: played as the pointer events the
			// viewer sees, as the browser's own touches would go on to tap whatever is under them by then.
			await image.evaluate((node, at) => {
				node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 77, pointerType: 'touch', clientX: at.x, clientY: at.y }));
			}, centre);
			await page.goBack();
			await expect(viewer).toBeHidden();
			await preview.press(page.locator('a.ap-embed-imagelink').first());
			await expect(viewer).toBeVisible();
			await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
			await touch('touchStart', [{ x: centre.x, y: centre.y }]);
			for (let step = 1; step <= 5; step++) await touch('touchMove', [{ x: centre.x + step * 20, y: centre.y }]);
			await touch('touchEnd', []);
			expect(Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));
			await page.waitForTimeout(400);
			for (let tap = 0; tap < 2; tap++) {
				await touch('touchStart', [{ x: centre.x, y: centre.y }]);
				await touch('touchEnd', []);
			}
			await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2.5);
			for (let tap = 0; tap < 2; tap++) {
				await touch('touchStart', [{ x: centre.x, y: centre.y }]);
				await touch('touchEnd', []);
			}
			await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));
		});

		await test.step('another image starts whole, and unzoomed, a tap beside the image still closes the viewer', async () => {
			await preview.press(viewer.getByRole('button', { name: 'Next image' }));
			const next = page.getByRole('dialog', { name: DAWN });
			await expect(next).toBeVisible();
			await expect(next.locator('.ap-viewer-stage')).not.toHaveClass(/ap-viewer-zoomed/);
			const shown = (await next.locator('img.ap-viewer-media').boundingBox())!;
			await touch('touchStart', [{ x: area.x + area.width / 2, y: shown.y + shown.height + 20 }]);
			await touch('touchEnd', []);
			await expect(next).toBeHidden();
		});
	});
});

test.describe('the image viewer, zoomed with a mouse', () => {
	test.use({ ...DEVICES.desktop });

	test('a double click zooms in where it lands, a drag moves it, Ctrl and the wheel zoom it, and a click beside it then closes nothing', async ({ preview, page }) => {
		await preview.open();
		await page.locator('a.ap-embed-imagelink').first().click();
		const viewer = page.getByRole('dialog', { name: DUSK });
		const image = viewer.locator('img.ap-viewer-media');
		await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
		const whole = (await image.boundingBox())!;
		const centre = { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 };

		// Zoomed in where it lands: that point of the image stays under the pointer.
		await page.mouse.dblclick(centre.x + 40, centre.y);
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2.5);
		await expect(image).toHaveCSS('cursor', 'grab');
		await page.waitForTimeout(400);
		const zoomed = (await image.boundingBox())!;
		expect((centre.x + 40 - zoomed.x) / zoomed.width).toBeCloseTo((centre.x + 40 - whole.x) / whole.width, 2);
		// Dragged a pixel at a time, it keeps up with the pointer from the first: none of the move is lost.
		await page.mouse.move(centre.x, centre.y);
		await page.mouse.down();
		await page.mouse.move(centre.x - 60, centre.y - 20, { steps: 60 });
		await page.mouse.up();
		const dragged = (await image.boundingBox())!;
		expect([Math.round(dragged.x - zoomed.x), Math.round(dragged.y - zoomed.y)]).toEqual([-60, -20]);

		// A mouse wheel's notch is a step (e^0.25, about 1.28 times), not a leap to the most it zooms.
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -100);
		await page.keyboard.up('Control');
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(3.2);
		// The page itself didn't zoom.
		expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);

		// Beside the image is ground no longer: a click there leaves it open.
		await page.mouse.click(whole.x - 40, centre.y);
		await page.waitForTimeout(300);
		await expect(viewer).toBeVisible();

		// From the keyboard: 0 shows it whole, + and − zoom about the middle, by half again each.
		await page.keyboard.press('0');
		await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));
		await page.keyboard.press('+');
		await page.keyboard.press('+');
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 100) / 100).toBe(2.25);
		await page.keyboard.press('-');
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 100) / 100).toBe(1.5);
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('dialog', { name: DAWN }).locator('.ap-viewer-stage')).not.toHaveClass(/ap-viewer-zoomed/);
	});

	test('eased back out with motion allowed, it stays clipped below the bar until it is whole, and then closes on a click beside it', async ({ preview, page }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await preview.open();
		await page.locator('a.ap-embed-imagelink').first().click();
		const viewer = page.getByRole('dialog', { name: DUSK });
		const image = viewer.locator('img.ap-viewer-media');
		await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
		const whole = (await image.boundingBox())!;
		const centre = { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 };
		await page.mouse.dblclick(centre.x, centre.y);
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2.5);
		// While it eases back out, whatever is at the bar is the bar's, never the image.
		const bar = (await viewer.locator('.ap-viewer-bar').boundingBox())!;
		const atBar = await page.evaluate(async ({ x, y, cx, cy }) => {
			const seen: string[] = [];
			const target = document.elementFromPoint(cx, cy)!;
			for (const type of ['pointerdown', 'pointerup']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy, isPrimary: true, pointerId: 9 }));
			await new Promise((settle) => setTimeout(settle, 120));
			for (const type of ['pointerdown', 'pointerup']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy, isPrimary: true, pointerId: 9 }));
			for (let frame = 0; frame < 12; frame++) {
				await new Promise((settle) => requestAnimationFrame(settle));
				seen.push(document.elementFromPoint(x, y)!.tagName);
			}
			return seen;
		}, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2, cx: centre.x, cy: centre.y });
		expect(atBar).not.toContain('IMG');
		await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));

		// One ease giving way to the next (− then 0, a frame apart) eases too, and still never over the bar: the image
		// is drawn between its sizes on the way, and stays clipped until it is whole.
		await page.mouse.dblclick(centre.x, centre.y);
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2.5);
		await page.waitForTimeout(400);
		const { tags, sizes } = await page.evaluate(async ({ x, y, w }) => {
			const media = document.querySelector('dialog[open] img.ap-viewer-media')!;
			const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
			const frame = () => new Promise((settle) => requestAnimationFrame(settle));
			const tags: string[] = [];
			const sizes: number[] = [];
			const look = () => {
				tags.push(document.elementFromPoint(x, y)!.tagName);
				sizes.push(media.getBoundingClientRect().width / w);
			};
			press('-');
			for (let n = 0; n < 2; n++) (await frame(), look());
			press('0');
			for (let n = 0; n < 20; n++) (await frame(), look());
			return { tags, sizes };
		}, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2, w: whole.width });
		expect(tags).not.toContain('IMG');
		expect(sizes.some((size) => size > 1.05 && size < 2.45)).toBe(true);
		await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(Math.round(whole.width));
		await expect(viewer.locator('.ap-viewer-stage')).not.toHaveClass(/ap-viewer-zoomed/);
		await page.mouse.click(whole.x - 40, centre.y);
		await expect(viewer).toBeHidden();
	});

	test('a Safari trackpad pinch (its gesture events) zooms the image about the pointer, not the page', async ({ preview, page }) => {
		await preview.open();
		await page.locator('a.ap-embed-imagelink').first().click();
		const viewer = page.getByRole('dialog', { name: DUSK });
		const image = viewer.locator('img.ap-viewer-media');
		await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
		const whole = (await image.boundingBox())!;
		const at = { x: whole.x + whole.width * 0.3, y: whole.y + whole.height / 2 };
		// As Safari sends them (Chromium has none): the scale since the pinch began, where the pointer is.
		const prevented = await viewer.locator('.ap-viewer-stage').evaluate((stage, at) => {
			const gesture = (type: string, scale: number) => {
				const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: at.x, clientY: at.y });
				stage.dispatchEvent(event);
				return event.defaultPrevented;
			};
			return [gesture('gesturestart', 1), gesture('gesturechange', 2), gesture('gestureend', 2)];
		}, at);
		expect(prevented).toEqual([true, true, true]);
		await expect.poll(async () => Math.round((await image.boundingBox())!.width / whole.width * 10) / 10).toBe(2);
		const zoomed = (await image.boundingBox())!;
		expect((at.x - zoomed.x) / zoomed.width).toBeCloseTo(0.3, 2);
		expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
	});
});

test.describe('the image viewer, closed with Escape and opened again at once', () => {
	test.use({ ...DEVICES.desktop });

	test('before its close event has come, stays open, and closed, leaves no entry for Back to find', async ({ preview, page }) => {
		await preview.open();
		const links = page.locator('a.ap-embed-imagelink');
		await links.first().click();
		await expect(page.getByRole('dialog', { name: DUSK })).toBeVisible();
		// Escape, then a click on the other image once the dialog has closed but before its `close` event (a task later).
		const between = await page.evaluate(async () => {
			const dialog = document.querySelector('dialog[open]')!;
			dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			await new Promise<void>((settle) => queueMicrotask(settle));
			const closed = !dialog.open;
			document.querySelectorAll<HTMLElement>('a.ap-embed-imagelink')[1].click();
			return closed;
		});
		expect(between).toBe(true);
		const viewer = page.getByRole('dialog', { name: DAWN });
		await expect(viewer).toBeVisible();
		// Still open once the late close event, and any Back, have come and gone; and on its history entry.
		await page.waitForTimeout(300);
		await expect(viewer).toBeVisible();
		expect(await page.evaluate(() => JSON.stringify(history.state ?? {}))).toContain('"media"');
		await viewer.getByRole('button', { name: 'Close' }).click();
		await expect(viewer).toBeHidden();
		await expect.poll(() => page.evaluate(() => JSON.stringify(history.state ?? {}))).not.toContain('"media"');
	});
});
