# Apron web client

A Svelte 5 / SvelteKit 2 + TypeScript client for the
[Apron Chat Protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md),
deployed at `https://web.apron.chat`. It builds as a static shell with
`adapter-static`; the browser opens the WebSocket from `onMount`, so any static
host can serve the generated site, including the
[Go reference server](https://github.com/shazow/apron/tree/main/servers/go).

Use Node.js 24 (see `.node-version`), or `devenv shell`, which also provides
Wrangler:

```sh
git submodule update --init   # or clone with --recurse-submodules
npm ci
npm run dev       # Vite serves the UI and proxies /ws, /write/, /files/, /streams/ to 127.0.0.1:8080
npm run check     # svelte-check
npm test          # reducer and replay unit tests
npm run build     # writes the static site to build/
npm run design:bundle  # builds the design system's components to dist-design/
npm run preview
```

`npm run dev` needs a backend on port 8080: the Go reference server from
[shazow/apron](https://github.com/shazow/apron) (`make dev-server`), or the
demo Worker from
[apron-chat/apron-server-cloudflare](https://github.com/apron-chat/apron-server-cloudflare)
(`npx wrangler dev --port 8080`).

The server the client opens first is `VITE_DEFAULT_SERVER_URL` from the build
(the connect screen switches to any other, and remembers it):

- `npm run dev` leaves it unset, so it uses same-origin `/ws`, proxied to
  port 8080. To start dev against another server, set it in `.env.local`.
- Builds (`npm run build`, production, and Previews) read `.env.production`:
  `wss://server.apron.chat/`, the reference server for testing and demos. To
  build for another server, set it in `.env.production.local` (`.env.local`
  doesn't override `.env.production`) or on the command line, e.g.
  `VITE_DEFAULT_SERVER_URL=wss://chat.example/ npm run build`. Set it empty for
  same-origin `/ws`.

Embed media (upload previews, link card images) loads only from the chat
server's own origin, plus the origins listed in `VITE_TRUSTED_MEDIA_ORIGINS`
(comma-separated, set the same way). `.env.production` trusts
`https://media.apron.chat`, where the reference server serves uploads.

The unit tests replay the implementation-agnostic protocol fixtures in
[shazow/apron](https://github.com/shazow/apron), checked out as the `protocol`
submodule and pinned to a commit. Dependabot opens a pull request when it
moves, so CI runs the client against new fixtures before they are adopted; to
update by hand, run `git -C protocol fetch origin main`, check out the commit
you want, and commit `protocol`. The end-to-end browser tests against the Go
server are in shazow/apron's `tests/interop`.

The favicon and app icons are generated from the logo in that submodule,
`protocol/art/apron-logo.svg`: run `npm run icons` after it changes (or
`npm run icons -- path/to/logo.svg` for another file) and commit the results
in `static/` and `src/lib/assets/favicon.svg`.

## Deployment

[Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
is connected to this repository in the Cloudflare dashboard. A push to `main` (a
merged pull request) deploys `build/` to `https://web.apron.chat` with
`wrangler.toml`. Every other branch gets a
[Preview](https://developers.cloudflare.com/workers/previews/) at
`https://<branch>-apron-web.shazow.workers.dev`, and Cloudflare comments its URL
on the pull request. Both build with `wss://server.apron.chat/` as the default
server, from `.env.production`. The build command is:

```sh
git submodule update --init && npm run build
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm run check`,
`npm test`, `npm run build` and `npm run design:bundle` on every pull request
and on `main`. Branch protection on `main` requires its `test` check, so only
tested changes reach the production build. To deploy by hand, with Wrangler on `PATH`:

```sh
npm run build
wrangler deploy
```

The backend deploys separately, from
[apron-chat/apron-server-cloudflare](https://github.com/apron-chat/apron-server-cloudflare).
The apex `apron.chat` is reserved for docs.

## Documentation

- [docs/behavior.md](docs/behavior.md): what the client does, feature by
  feature, and the protocol capabilities each one needs.
- [docs/architecture.md](docs/architecture.md): the design system, the code
  layout, and how the protocol session keeps and recovers state.
