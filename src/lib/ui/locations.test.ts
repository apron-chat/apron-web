import { describe, expect, it } from 'vitest';
import { accuracyLabel, findLocationLinks, locationDecimals, locationPreview, locationText, locationUrl, parseLocationLink } from './locations';

describe('shared locations', () => {
	it('rounds a fix to what its accuracy supports', () => {
		expect(locationUrl({ latitude: 40.712776, longitude: -74.005974, accuracy: 3 })).toBe('https://www.openstreetmap.org/?mlat=40.71278&mlon=-74.00597#map=17/40.71278/-74.00597');
		expect(locationUrl({ latitude: 40.712776, longitude: -74.005974, accuracy: 30 })).toBe('https://www.openstreetmap.org/?mlat=40.7128&mlon=-74.0060#map=17/40.7128/-74.0060');
		expect(locationUrl({ latitude: 40.712776, longitude: -74.005974, accuracy: 2000 })).toBe('https://www.openstreetmap.org/?mlat=40.71&mlon=-74.01#map=13/40.71/-74.01');
		expect([5, 50, 500, 5000].map(locationDecimals)).toEqual([5, 4, 3, 2]);
	});

	it('says how far off a fix may be', () => {
		expect(accuracyLabel(0.4)).toBe('within 1 m');
		expect(accuracyLabel(23)).toBe('within 25 m');
		expect(accuracyLabel(1480)).toBe('within 1.5 km');
		expect(accuracyLabel(25_400)).toBe('within 25 km');
		expect(locationText({ latitude: 51.5, longitude: -0.12, accuracy: 12 })).toBe('📍 https://www.openstreetmap.org/?mlat=51.5000&mlon=-0.1200#map=17/51.5000/-0.1200 (within 10 m)');
	});

	it('reads pin links, and nothing else', () => {
		expect(parseLocationLink('https://www.openstreetmap.org/?mlat=51.5&mlon=-0.12#map=17/51.5/-0.12')).toMatchObject({ lat: 51.5, lon: -0.12 });
		expect(parseLocationLink('https://openstreetmap.org/?mlat=-33.86&mlon=151.2')).toMatchObject({ lat: -33.86, lon: 151.2 });
		expect(parseLocationLink('https://www.openstreetmap.org/#map=17/51.5/-0.12')).toBeUndefined();
		expect(parseLocationLink('https://www.openstreetmap.org/?mlat=91&mlon=0')).toBeUndefined();
		expect(parseLocationLink('https://www.openstreetmap.org/?mlat=1e2&mlon=0')).toBeUndefined();
		expect(parseLocationLink('https://openstreetmap.org.evil.example/?mlat=1&mlon=2')).toBeUndefined();
	});

	it('finds distinct pins in text without trailing punctuation, leaving out dismissed ones', () => {
		const a = 'https://www.openstreetmap.org/?mlat=1&mlon=2#map=17/1/2';
		const b = 'https://www.openstreetmap.org/?mlat=3&mlon=4';
		expect(findLocationLinks(`here ${a}. and ${b}, again ${a}`).map((link) => link.url)).toEqual([a, b]);
		expect(findLocationLinks(`${a} ${b}`, [a]).map((link) => link.url)).toEqual([b]);
		expect(findLocationLinks(`${a} ${b}`, [], 1)).toHaveLength(1);
	});

	it('describes a pin in degrees', () => {
		expect(locationPreview({ lat: -33.86, lon: 151.2, url: '' })).toEqual({ site_name: 'OpenStreetMap', title: 'Shared location', description: '33.86° S, 151.2° E' });
	});
});
