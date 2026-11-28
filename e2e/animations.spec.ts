import type { Locator } from '@playwright/test';
import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Animated images (`$lib/ui/animation-settings`, `AnimatedImage`): they play by themselves as Preferences' Media says,
 * else show their first frame; each upload's has a button to play and pause it, and a click on the picture still
 * views it.
 */

test.use(DEVICES.desktop);

/** A 160 × 100 GIF of two frames, red then blue, looping. */
const GIF = 'data:image/gif;base64,R0lGODlhoABkAIEAANw8PAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADwAAACwAAAAAoABkAAAIzAABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK17MuLHjx5AjS55MubLly5gza97MubPnz6BDix5NurTp06hTq17NurXr17Bjyy4aEAAh+QQBDwABACwAAAAAoABkAIE8WtwAAAAAAAAAAAAIzAABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK17MuLHjx5AjS55MubLly5gza97MubPnz6BDix5NurTp06hTq17NurXr17Bjyy4aEAA7';

async function postGif(preview: Preview): Promise<void> {
	await preview.post('general', 'grace', { text: 'Party', embeds: [{ kind: 'upload', embed_id: 'gif', url: 'https://apron-preview.invalid/files/party.gif', title: 'party.gif', og: { image: { url: GIF, type: 'image/gif', width: 160, height: 100, alt: 'A flashing square' } } }] });
}

/** The colour at the middle of the still standing in for the picture: its first frame. */
function stillColour(still: Locator): Promise<number[]> {
	return still.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(80, 50, 1, 1).data.slice(0, 3)]);
}

test.describe('where the device doesn’t ask for reduced motion', () => {
	test.use({ reducedMotion: 'no-preference' });

	test('a GIF plays, its button pauses it on its first frame and plays it again, and a click on it still views it', async ({ preview, page }) => {
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		const picture = figure.locator('img.ap-embed-media');
		await expect(picture).toBeVisible();
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);
		await figure.getByRole('button', { name: 'Pause party.gif' }).click();
		const still = figure.getByRole('img', { name: 'A flashing square' });
		await expect(still).toBeVisible();
		await expect(picture).toBeHidden();
		expect(await stillColour(still)).toEqual([220, 60, 60]);
		await figure.getByRole('button', { name: 'Play party.gif' }).click();
		await expect(picture).toBeVisible();
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);

		await figure.locator('a.ap-embed-imagelink').click();
		await expect(page.getByRole('dialog', { name: 'party.gif' })).toBeVisible();
	});
});

test.describe('a GIF that plays by itself', () => {
	test.use({ reducedMotion: 'no-preference' });

	test('holds still after 5 seconds, and a Play press then plays it on', async ({ preview, page }) => {
		await page.clock.install();
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		await expect(figure.locator('img.ap-embed-media')).toBeVisible();
		await page.clock.runFor(4_000);
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);
		await page.clock.runFor(1_000);
		await expect(figure.getByTestId('animation-still')).toBeVisible();
		await figure.getByRole('button', { name: 'Play party.gif' }).click();
		await page.clock.runFor(60_000);
		await expect(figure.locator('img.ap-embed-media')).toBeVisible();
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);
	});
});

test.describe('a playing GIF’s Pause', () => {
	test.use({ reducedMotion: 'no-preference' });

	test('shows on hover where there’s a mouse', async ({ preview, page }) => {
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		const pause = figure.getByRole('button', { name: 'Pause party.gif' });
		await expect(figure.locator('img.ap-embed-media')).toBeVisible();
		await page.mouse.move(1, 1);
		await expect(pause).toHaveCSS('opacity', '0');
		await figure.locator('img.ap-embed-media').hover();
		await expect(pause).toHaveCSS('opacity', '1');
	});

	test.describe('on a phone', () => {
		test.use({ ...DEVICES.phone, reducedMotion: 'no-preference' });

		test('always shows, as a touch screen can’t hover', async ({ preview, page }) => {
			await preview.open();
			await postGif(preview);
			await expect(page.locator('figure.ap-embed-animated').getByRole('button', { name: 'Pause party.gif' })).toHaveCSS('opacity', '1');
		});
	});
});

test.describe('where the device asks for reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('a GIF holds still until played, and plays by itself once Preferences say Always', async ({ preview, page }) => {
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		await expect(figure.getByTestId('animation-still')).toBeVisible();
		await expect(figure.locator('img.ap-embed-media')).toBeHidden();
		await expect(figure.getByRole('button', { name: 'Play party.gif' })).toBeVisible();

		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
		await expect(preferences.getByTestId('animations')).toHaveValue('system');
		await expect(preferences.getByTestId('animations-note')).toHaveText('Follows your device’s reduced motion setting.');
		await preferences.getByTestId('animations').selectOption('always');
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);
		await expect(figure.getByRole('button', { name: 'Pause party.gif' })).toBeAttached();
	});
});

test.describe('where Preferences say Never', () => {
	test.use({ reducedMotion: 'no-preference' });

	test('a GIF holds still, whatever the device asks, until played', async ({ preview, page }) => {
		await page.addInitScript(() => localStorage.setItem('apron.animations', 'never'));
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		expect(await stillColour(figure.getByTestId('animation-still'))).toEqual([220, 60, 60]);
		await figure.getByRole('button', { name: 'Play party.gif' }).click();
		await expect(figure.locator('img.ap-embed-media')).toBeVisible();
	});
});
