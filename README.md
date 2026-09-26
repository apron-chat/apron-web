<p align="center">
  <img src="docs/apron.png" width="112" alt="Apron">
</p>

<h1 align="center">Apron web</h1>

<p align="center">
  A bottomless chat client for the
  <a href="https://github.com/shazow/apron/blob/main/PROTOCOL.md">Apron Chat Protocol</a>.
  <br>
  <a href="https://web.apron.chat"><strong>web.apron.chat</strong></a>
</p>

<p align="center">
  <img width="721" alt="The Apron web client: a room with threads, reactions, and the composer" src="https://github.com/user-attachments/assets/bdd4b15c-485e-4c19-838b-75c748dd2890">
</p>

Point it at any Apron server and it renders the chat. The server is
authoritative for identity, history, and threading; the client is a renderer
that adapts to whatever capabilities the server advertises, so a minimal
backend is useful right away and a complete one lights up everything.

## Features

- **Rooms and threads**: start a thread from any message, browse and join
  rooms, and move messages between them.
- **Conversation**: edits, replies, reactions, `@` mentions, Markdown, and
  slash commands.
- **Media**: file and voice uploads, live streamed output, link cards, and
  sandboxed embeds.
- **History**: per-room recovery across reconnects, with rolling retention.
- **Sign-in**: guest access, passkeys, and sessions that resume across reloads.
- **Static**: a SvelteKit site that any host can serve, in dark and light
  themes.

## Quick start

```sh
git clone --recurse-submodules https://github.com/apron-chat/apron-web
cd apron-web
npm ci
npm run dev
```

Open `http://localhost:5173` with an Apron server listening on port 8080, such
as the Go reference server in [shazow/apron](https://github.com/shazow/apron),
or connect to `wss://server.apron.chat/` from the connect screen.

## The Apron family

- [shazow/apron](https://github.com/shazow/apron): the protocol, its
  conformance fixtures, and the Go reference server.
- [apron-chat/apron-server-cloudflare](https://github.com/apron-chat/apron-server-cloudflare):
  the public demo server behind `server.apron.chat`.

## Development

Setup, tests, deployment, the code layout, and a detailed account of how the
client behaves on the protocol are in [DEVELOPMENT.md](DEVELOPMENT.md). Every
merge to `main` deploys to [web.apron.chat](https://web.apron.chat).

## License

[MIT](LICENSE)
