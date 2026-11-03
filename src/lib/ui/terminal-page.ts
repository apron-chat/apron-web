/**
 * The address of terminal.apron.chat's page for a `terminal` embed's live text
 * (§4.8.6): the stream on a page of its own, which reads it straight from the
 * chat server, as the embed does. Its keys go after the `#`, so the stream's
 * address never reaches that site's host:
 *
 * https://terminal.apron.chat/#stream=https://chat.example/live/1&title=make%20test
 *
 * The page reads only `https:` streams without a user name or password, so
 * there is no address for any other.
 */
export const TERMINAL_PAGE_ORIGIN = 'https://terminal.apron.chat';

/** `title` is the embed's, as sent: anything but a string is left out. */
export function terminalPageUrl(stream: string | undefined, title?: unknown): string | undefined {
	if (!stream) return undefined;
	let url: URL;
	try {
		url = new URL(stream);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return undefined;
	url.hash = '';
	// As the page writes its own links: encoded as a component, with `:` and `/` left readable.
	const encode = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
	const keys = [`stream=${encode(url.href)}`];
	if (typeof title === 'string' && title.trim()) keys.push(`title=${encode(title.trim())}`);
	return `${TERMINAL_PAGE_ORIGIN}/#${keys.join('&')}`;
}
