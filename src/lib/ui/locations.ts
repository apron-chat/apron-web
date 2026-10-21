/**
 * Shared locations: the composer's Share location puts an OpenStreetMap pin
 * link in the draft, and the link's card (a `link` embed, PROTOCOL.md §4.8.1)
 * is built from the URL alone. Nothing is fetched and no map image is shown,
 * since clients load `og` media only from the chat server.
 */
import type { OpenGraph } from '$lib/protocol/types';

/** A pin's place, and the link it was found as. */
export interface LocationLink {
	lat: number;
	lon: number;
	url: string;
}

/** What `getCurrentPosition` reports that a shared location needs; `accuracy` is a radius in metres. */
export interface Fix {
	latitude: number;
	longitude: number;
	accuracy: number;
}

const OSM_URL = /https?:\/\/(?:www\.)?openstreetmap\.org\/[^\s<>()[\]{}"'`]*/gi;

/** Decimal places worth sharing for a fix this accurate: 0.0001° is about 11 m, so a vaguer fix says less. */
export function locationDecimals(accuracy: number): number {
	if (accuracy <= 5) return 5;
	if (accuracy <= 50) return 4;
	if (accuracy <= 500) return 3;
	return 2;
}

/** The map's zoom for a fix this accurate: a street for a precise one, a town for a vague one. */
function zoomFor(accuracy: number): number {
	if (accuracy <= 50) return 17;
	if (accuracy <= 500) return 15;
	if (accuracy <= 5000) return 13;
	return 11;
}

/** The OpenStreetMap link with a pin at a fix, rounded to what its accuracy supports. */
export function locationUrl(fix: Fix): string {
	const decimals = locationDecimals(fix.accuracy);
	const lat = fix.latitude.toFixed(decimals);
	const lon = fix.longitude.toFixed(decimals);
	return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoomFor(fix.accuracy)}/${lat}/${lon}`;
}

/** How far off a fix may be, for people: "within 20 m", "within 1.5 km". */
export function accuracyLabel(accuracy: number): string {
	if (accuracy < 1000) return `within ${Math.max(1, Math.round(accuracy / 5) * 5)} m`;
	return `within ${Number((accuracy / 1000).toFixed(accuracy < 10_000 ? 1 : 0))} km`;
}

/** The draft text for a fix: its pin link and how far off it may be. */
export function locationText(fix: Fix): string {
	return `📍 ${locationUrl(fix)} (${accuracyLabel(fix.accuracy)})`;
}

/** An OpenStreetMap link with a pin (`mlat` and `mlon`), else undefined. */
export function parseLocationLink(value: string): LocationLink | undefined {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}
	if (!/^https?:$/.test(parsed.protocol) || !/^(www\.)?openstreetmap\.org$/i.test(parsed.hostname)) return undefined;
	const lat = coordinate(parsed.searchParams.get('mlat'), 90);
	const lon = coordinate(parsed.searchParams.get('mlon'), 180);
	if (lat === undefined || lon === undefined) return undefined;
	return { lat, lon, url: value };
}

function coordinate(text: string | null, limit: number): number | undefined {
	if (!text || !/^-?\d{1,3}(\.\d+)?$/.test(text)) return undefined;
	const value = Number(text);
	return Math.abs(value) <= limit ? value : undefined;
}

/** The distinct pin links in a message's text, in order, up to `max`, leaving out URLs in `skip`. */
export function findLocationLinks(text: string, skip: readonly string[] = [], max = Infinity): LocationLink[] {
	const found = new Map<string, LocationLink>();
	for (const match of text.matchAll(OSM_URL)) {
		if (found.size >= max) break;
		const link = parseLocationLink(match[0].replace(/[.,:;!?*_~]+$/, ''));
		if (link && !found.has(link.url) && !skip.includes(link.url)) found.set(link.url, link);
	}
	return [...found.values()];
}

/** A pin's card: where it is, in degrees north or south and east or west. */
export function locationPreview(link: LocationLink): OpenGraph {
	const degrees = (value: number, positive: string, negative: string) => `${Math.abs(value)}° ${value < 0 ? negative : positive}`;
	return { site_name: 'OpenStreetMap', title: 'Shared location', description: `${degrees(link.lat, 'N', 'S')}, ${degrees(link.lon, 'E', 'W')}` };
}
