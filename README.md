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
npm run preview
```

`npm run dev` needs a backend on port 8080: the Go reference server from
[shazow/apron](https://github.com/shazow/apron) (`make dev-server`), or the
demo Worker from
[apron-chat/apron-server-cloudflare](https://github.com/apron-chat/apron-server-cloudflare)
(`npx wrangler dev --port 8080`).

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

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs
`npm run check`, `npm test`, and `npm run build` on every pull request and on
`main`. A push to `main` (a merged pull request), or a manual run of the
workflow on `main`, then builds with `wss://server.apron.chat/` as the default
server and deploys `build/` to `https://web.apron.chat` with `wrangler.toml`,
in the `web.apron.chat` GitHub environment. It needs the `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` secrets there or on the repository; the token needs
to deploy Workers and manage the `web.apron.chat` custom domain. Deploys never
run concurrently. To deploy by hand, with Wrangler on `PATH`:

```sh
VITE_DEFAULT_SERVER_URL=wss://server.apron.chat/ npm run build
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
