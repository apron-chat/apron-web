import type { Locator } from '@playwright/test';
import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Animated images (`$lib/ui/animation-settings`, `AnimatedImage`), in what only a browser shows: the still's pixels,
 * the image hidden behind it, Pause on hover, the device's reduced motion, and Preferences' choice, saved and changed.
 * Exact timing, a card's, and the rest are `Embed.svelte.test.ts`'s and `animation-settings.svelte.test.ts`'s.
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

	test('a GIF plays for 5 seconds, then holds on its first frame; Play plays it on, Pause shows on hover, and a click on it still views it', async ({ preview, page }) => {
		await page.clock.install();
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		const picture = figure.locator('img.ap-embed-media');
		await expect(picture).toBeVisible();
		const pause = figure.getByRole('button', { name: 'Pause GIF party.gif' });
		await page.mouse.move(1, 1);
		await expect(pause).toHaveCSS('opacity', '0');
		await picture.hover();
		await expect(pause).toHaveCSS('opacity', '1');

		await page.clock.runFor(5_000);
		const still = figure.getByRole('img', { name: 'A flashing square' });
		await expect(still).toBeVisible();
		await expect(picture).toBeHidden();
		expect(await stillColour(still)).toEqual([220, 60, 60]);
		await figure.getByRole('button', { name: 'Play GIF party.gif' }).click();
		await page.clock.runFor(60_000);
		await expect(picture).toBeVisible();
		await expect(figure.getByTestId('animation-still')).toHaveCount(0);

		await figure.locator('a.ap-embed-imagelink').click();
		await expect(page.getByRole('dialog', { name: 'party.gif' })).toBeVisible();
	});
});

test.describe('where the device asks for reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('a saved Always plays a GIF anyway, and System Default in Preferences holds it still', async ({ preview, page }) => {
		await page.addInitScript(() => localStorage.setItem('apron.animations', 'always'));
		await preview.open();
		await postGif(preview);
		const figure = page.locator('figure.ap-embed-animated');
		await expect(figure.locator('img.ap-embed-media')).toBeVisible();

		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
		await expect(preferences.getByTestId('animations')).toHaveValue('always');
		await preferences.getByTestId('animations').selectOption('system');
		await expect(figure.getByTestId('animation-still')).toBeAttached();
		await expect(figure.getByRole('button', { name: 'Play GIF party.gif' })).toBeAttached();
	});
});
