import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg'
};

/**
 * Serves a static build directory (adapter-static output: `/__preview` → `__preview.html`) on a free port.
 * Files are looked up on every request, so nothing is cached between builds; still, serve a snapshot, not
 * a directory you will rebuild, so a running comparison can't change under you.
 *
 * `compress` serves text (HTML, JS, CSS, JSON, SVG) brotli-compressed to a browser that takes it, as a CDN does, for
 * timings that depend on the bytes sent (`qa startup`); without it, every file goes as it is on disk.
 *
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function serveDir(dir, { port = 0, host = '127.0.0.1', compress = false } = {}) {
	/** @type {Map<string, Buffer>} */
	const compressed = new Map();
	const root = resolve(dir);
	if (!existsSync(join(root, 'index.html')) && !existsSync(join(root, '__preview.html')))
		throw new Error(`${dir} doesn't look like a build (no index.html)`);
	const server = createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
		const file = resolveFile(root, path);
		if (!file) {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('not found');
			return;
		}
		const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
		if (compress && /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && /\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
			const key = `${file}:${statSync(file).mtimeMs}`;
			if (!compressed.has(key)) compressed.set(key, brotliCompressSync(readFileSync(file)));
			const body = /** @type {Buffer} */ (compressed.get(key));
			res.writeHead(200, { 'content-type': type, 'content-encoding': 'br', 'content-length': body.length, 'cache-control': 'no-store', vary: 'accept-encoding' });
			res.end(req.method === 'HEAD' ? undefined : body);
			return;
		}
		res.writeHead(200, {
			'content-type': type,
			'content-length': statSync(file).size,
			'cache-control': 'no-store'
		});
		if (req.method === 'HEAD') res.end();
		else createReadStream(file).pipe(res);
	});
	return new Promise((ok, fail) => {
		server.once('error', fail);
		server.listen(port, host, () => {
			const address = /** @type {import('node:net').AddressInfo} */ (server.address());
			ok({
				url: `http://${host}:${address.port}`,
				port: address.port,
				close: () =>
					new Promise((done) => {
						server.close(() => done(undefined));
						server.closeAllConnections();
					})
			});
		});
	});
}

function resolveFile(root, path) {
	const clean = normalize(path).replace(/^([/\\])+/, '');
	for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
		const full = join(root, candidate);
		if (full !== root && !full.startsWith(root + sep)) return null; // outside the build
		try {
			if (statSync(full).isFile()) return full;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}
