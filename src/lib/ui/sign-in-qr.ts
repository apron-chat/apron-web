import { readApronLink } from './apron-link';

/**
 * Gives each sign-in link in a notice's body (Appendix A.4: a link with
 * `server` and `token`, which only servers write) a Show QR code button after
 * it, which hands `show` the link's `href` exactly as the server wrote it, so
 * a phone can scan it. It reads the rendered links, as `placeLinksIn` does,
 * never the text. Running it again adds no second button.
 */
export function offerSignInQr(body: HTMLElement, show: (href: string) => void): void {
	for (const anchor of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		const href = anchor.getAttribute('href') ?? '';
		if (!readApronLink(href)?.token || anchor.nextElementSibling?.classList.contains('ap-notice-qr')) continue;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'ap-btn ap-btn-sm ap-notice-qr';
		button.textContent = 'Show QR code';
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			show(href);
		});
		anchor.after(button);
	}
}
