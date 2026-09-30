import { describe, expect, it } from 'vitest';
import { parseEmailLink, takeEmailLink } from './email-link';

describe('emailed sign-in links (§4.10)', () => {
	it('reads the address and token from the fragment', () => {
		expect(parseEmailLink('#email=ada%40example.com&token=418092')).toEqual({ email: 'ada@example.com', token: '418092' });
		expect(parseEmailLink('#token=418092&email=ada@example.com&x=1')).toEqual({ email: 'ada@example.com', token: '418092' });
	});

	it('ignores fragments that are not a complete link', () => {
		expect(parseEmailLink('')).toBeUndefined();
		expect(parseEmailLink('#')).toBeUndefined();
		expect(parseEmailLink('#email=ada%40example.com')).toBeUndefined();
		expect(parseEmailLink('#token=1&email=')).toBeUndefined();
		expect(parseEmailLink('#room')).toBeUndefined();
	});

	it('scrubs the link from the URL, keeping its path and query', () => {
		const replaced: string[] = [];
		const link = takeEmailLink({ hash: '#email=ada%40example.com&token=418092', pathname: '/login', search: '?x=1' }, (url) => replaced.push(url));
		expect(link).toEqual({ email: 'ada@example.com', token: '418092' });
		expect(replaced).toEqual(['/login?x=1']);
		// Anything else in the fragment is left alone.
		expect(takeEmailLink({ hash: '#section', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(replaced).toHaveLength(1);
	});
});
