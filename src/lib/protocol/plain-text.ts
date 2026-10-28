/**
 * Cleaning user-written plain text for display, such as a bio (`ext:bio`).
 * Shown as text, never as markup, it can't inject anything, but some
 * characters still change how it and what's around it read.
 */

/**
 * Control characters but the line feed, and the bidi embeddings, overrides
 * and isolates (U+202A–U+202E, U+2066–U+2069), which could reverse how the
 * text around it reads, as `evil\u202Egnp.exe` shows as `evilexe.png`.
 */
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Plain text as it is safe to show and to send: line feeds for line breaks,
 * tabs as spaces, no control or bidi formatting characters, at most one
 * blank line in a row, trimmed, and cut to `maxChars` characters (code
 * points, so an emoji is one) when given. Everything else stays as written:
 * markup and URLs are text, and only ever rendered as text.
 */
export function cleanPlainText(text: string, maxChars?: number): string {
	const clean = text.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ').replace(UNSAFE, '').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return maxChars === undefined ? clean : [...clean].slice(0, maxChars).join('').trimEnd();
}

/** The bidi embeddings and overrides (U+202A–U+202E), which clients ignore in what users write (§3.5.2). */
const BIDI_OVERRIDES = /[\u202A-\u202E]/g;
const HAS_OVERRIDE = /[\u202A-\u202E]/;

/**
 * Text as it is shown, without bidi embeddings and overrides (§3.5.2): a
 * name, a title or a message can't show its own characters out of order.
 * Only for display: what the client keeps and sends stays as written, so an
 * edit sends back every character its author typed.
 */
export function withoutBidiOverrides(text: string): string {
	return HAS_OVERRIDE.test(text) ? text.replace(BIDI_OVERRIDES, '') : text;
}

/** Whether any string in a list has an embedding or override to drop (`withoutBidiOverrides`). */
const anyOverride = (values: readonly unknown[]) => values.some((value) => typeof value === 'string' && HAS_OVERRIDE.test(value));

/**
 * A user object as it is shown (§3.5.2): its `name` and `roles` without bidi
 * embeddings and overrides (`withoutBidiOverrides`). The object itself when
 * there are none, and one copy per object when there are, so a caller that
 * compares by identity sees no change.
 */
export function shownPerson<T extends { name?: string; roles?: unknown }>(person: T): T;
export function shownPerson<T extends { name?: string; roles?: unknown }>(person: T | undefined): T | undefined;
export function shownPerson<T extends { name?: string; roles?: unknown }>(person: T | undefined): T | undefined {
	if (!person) return person;
	const roles = Array.isArray(person.roles) ? (person.roles as unknown[]) : [];
	if (!anyOverride([person.name, ...roles])) return person;
	const kept = shownPeople.get(person);
	if (kept) return kept as T;
	const shown = { ...person };
	if (typeof person.name === 'string') shown.name = withoutBidiOverrides(person.name);
	if (roles.length) shown.roles = roles.map((role) => (typeof role === 'string' ? withoutBidiOverrides(role) : role)) as T['roles'];
	shownPeople.set(person, shown);
	return shown;
}
const shownPeople = new WeakMap<object, object>();

/** What an embed shows as text (§4.8): never its addresses, IDs or kind. */
const EMBED_TEXT = ['title', 'text', 'html'] as const;
const OG_TEXT = ['title', 'description', 'site_name'] as const;
const OG_MEDIA = ['image', 'video', 'audio'] as const;
const shownEmbeds = new WeakMap<object, object>();

/**
 * An embed (§4.8) as it is shown (§3.5.2): its title, text, HTML, and its
 * `og` title, description, site name and media `alt`, without bidi
 * embeddings and overrides (`withoutBidiOverrides`). The embed itself when
 * none has one, and one copy per embed when one does; the message keeps the
 * embed as sent.
 */
export function shownEmbed<T extends object>(embed: T): T {
	const fields = embed as Record<string, unknown>;
	const og = fields.og !== null && typeof fields.og === 'object' && !Array.isArray(fields.og) ? (fields.og as Record<string, unknown>) : undefined;
	const media = (key: string) => {
		const item = og?.[key];
		return item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : undefined;
	};
	const texts = [...EMBED_TEXT.map((key) => fields[key]), ...OG_TEXT.map((key) => og?.[key]), ...OG_MEDIA.map((key) => media(key)?.alt)];
	if (!anyOverride(texts)) return embed;
	const kept = shownEmbeds.get(embed);
	if (kept) return kept as T;
	const strip = (object: Record<string, unknown>, keys: readonly string[]) => {
		const copy = { ...object };
		for (const key of keys) if (typeof copy[key] === 'string') copy[key] = withoutBidiOverrides(copy[key] as string);
		return copy;
	};
	const shown = strip(fields, EMBED_TEXT);
	if (og) {
		const shownOg = strip(og, OG_TEXT);
		for (const key of OG_MEDIA) {
			const item = media(key);
			if (item) shownOg[key] = strip(item, ['alt']);
		}
		shown.og = shownOg;
	}
	shownEmbeds.set(embed, shown);
	return shown as T;
}
