/**
 * A small argv parser: `--key value`, `--key=value`, boolean `--flag` / `--no-flag`, repeatable keys collected
 * into arrays, and positionals.
 *
 * @param {string[]} argv
 * @param {{ boolean?: string[], multi?: string[] }} [spec]
 * @returns {{ _: string[], [key: string]: any }}
 */
export function parseArgs(argv, { boolean = [], multi = [] } = {}) {
	/** @type {{ _: string[], [key: string]: any }} */
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') {
			out._.push(...argv.slice(i + 1));
			break;
		}
		if (!arg.startsWith('--')) {
			out._.push(arg);
			continue;
		}
		let [key, value] = arg.slice(2).split(/=(.*)/s);
		if (boolean.includes(key)) {
			out[key] = value === undefined ? true : !/^(0|false|no)$/i.test(value);
			continue;
		}
		if (key.startsWith('no-') && boolean.includes(key.slice(3))) {
			out[key.slice(3)] = false;
			continue;
		}
		if (value === undefined) {
			value = argv[++i];
			if (value === undefined) throw new Error(`--${key} needs a value`);
		}
		if (multi.includes(key)) (out[key] ??= []).push(value);
		else out[key] = value;
	}
	return out;
}

/** Splits comma-separated (and repeated) values into one list: `--suite a,b --suite c` → `[a, b, c]`. */
export function list(value) {
	if (value === undefined || value === true) return [];
	return [value].flat().flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
}

/** A positive integer option, or the default. */
export function int(value, fallback) {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0) throw new Error(`expected a whole number, got ${value}`);
	return n;
}
