/**
 * Stands in for `linkify-it` (aliased in `vite.config.ts`), which markdown-it constructs whether or not it links bare
 * URLs: `markdown.ts` renders with `linkify: false` and finds links itself (`linkifyText`), so markdown-it's own
 * linkify rules return before they reach it. That leaves ~11 KB out of startup JS. Anything that does reach it means
 * linkify was turned on: say so rather than quietly finding no links.
 */
export class LinkifyIt {
	test(): never {
		return unused();
	}

	match(): never {
		return unused();
	}

	matchAtStart(): never {
		return unused();
	}
}

function unused(): never {
	throw new Error('linkify-it is stubbed out (src/lib/protocol/linkify-off.ts): markdown-it must keep `linkify: false`');
}
