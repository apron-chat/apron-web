# Architecture

How the web client is put together. [behavior.md](behavior.md) describes what
it does.

The UI follows the Apron design system. `src/lib/design/tokens.css` holds its
tokens as CSS custom properties: color, interaction grounds (`--hover`,
`--pressed`, `--selected`, `--chosen`), the focus ring (`--focus-ring`), fades
(`--opacity-disabled`, `--opacity-dim`), type and line heights (`--leading-*`),
spacing, radii, control and panel sizes, stacking (`--z-*`) and motion
(`--duration-*`, `--ease-*`), with the breakpoints listed in a comment, since a
media query can't read a custom property (`src/lib/ui/breakpoints.ts` holds the
ones scripts need). Dark is the reference theme; light follows
`prefers-color-scheme`, or `data-theme` on the root when Preferences picks one,
so its tokens are written twice, and `tokens.test.ts` holds the two blocks
equal. `src/lib/design/apron.css` is its component stylesheet. Text sizes are the
`--text-*` scale (caps, xs, sm, ui, field, body, title); only glyphs sized to
their box, such as avatar initials and emoji, and the connect screen's display
title keep literal sizes. `apron.css` states its shared rules once, at its
top: one focus ring on every control (outside a standalone one, inside one
flush in a row or list), one disabled fade, and one status-text treatment
(`ap-tone-ok`, `-warn`, `-danger` on a muted note; an error is always danger).
`tokens.test.ts` lints the stylesheet for the scales: line heights, fades and
weights.

This repository is the design system's source. `src/lib/design/components`
holds its presentational Svelte 5 components (runes, snippets, typed `Props`,
exported from `$lib/design/components`), and `src/lib/design/previews` a live
preview page for each. `npm run design:bundle` builds them into
`dist-design/project/components/`: `bundle.js` (one classic script, with the
Svelte runtime inside, that sets `window.Apron` with `render`, `html`, `part`
and `parts` for plain pages), `bundle.css` (all of `tokens.css`, both themes,
then `apron.css`, then `rail.css`, so it needs nothing else; `rail.css` styles
`BackendRail` and `AppShell`'s column for it, which the app never renders, so
the app doesn't import it and none of it ships with the app), `index.d.ts`
(generated from each component's `interface Props`) and each
`<Name>/preview.html`. Publish those files to the design system artifact.
`tokens.css` is the tokens' source of truth: change a token there, and it
reaches the design system with the next bundle.

Every design component follows two conventions. It declares the props it
takes and spreads nothing onto its markup: a `class`, added to its own; a
`testid` for its root where something queries it, and a named prop for an
inner part's (`chipTestid`, `sendTestid`), so no design component
hard-codes one; an `id` or a label where it fits; the handlers its callers
use; and an attribute other code reads, such as `data-room` on a room's row
or `data-timeline-item` on a timeline row, from a prop of its own. A
spread stays only where a component stands in for one element any of whose
attributes is the caller's by design, such as `Button`'s `<button>` or
`ComposerEditable`'s field (or `Embed` handing an embed's fields on to its
renderer), and then with a `<!-- spread: why -->` comment right before it:
`conventions.test.ts` fails on any spread without one. Where a caller's
handler and the component's own share an event, `chain()` from `util.ts`
runs the caller's first, and its `preventDefault()` skips the component's
own. Role badges beside a name stack when they don't fit (`--ap-role-overflow:
stack`): after an unneeded handle, the name gives way first, down to
`--ap-name-min`, then the badges stack behind the last that fits, which ends
with their count; a handle
shows only where two people share a name, and gives way last. An untitled
thread is called "Untitled", its room_id in the tooltip.

The Svelte components under `src/lib/components` are the app's side of the
design system: each renders a design component and adds the app's state and
behavior (the client, `directory` lookups, stores, requests), and none has
markup or styles of its own. The page lays itself out with the design
system's `AppShell` (rooms panel, main pane and member-list column; the
panels' collapse, slide and resize handles (`PanelToggle`, `PanelHandle`,
driven by `SidebarHandle`); one pane at a time on phones; the overlaid member
list under 960px) and renders `EmptyState`, `RoomLoading` (in `NoRoom`),
`FloatingDay` and `DropZone`, with `Toasts` and `ConnectionNotice` beside it.
The wrappers: `ConnectScreen` and `SignIn` (the pieces the design system's
`ConnectScreen` is made of: `ConnectPage`, `ConnectHeader` and `SignInForm`;
`SignIn` keeps the state machine in `$lib/ui/sign-in`), `Sidebar` (`SidebarHead`, whose server opens `ServerPane`, `SidebarSection` and
`RoomItem`, its Private section's rows with the `Faces` of who each private room is with) with `ThreadList` (the design system's `ThreadList`, its rows `ThreadItem`s,
which share `RoomItem`'s row), `MemberListSidebar` (`MemberList`, whose + mounts `AddMembersDialog`: the design system's `AddMembersForm`, the same `PeoplePicker` in a `Dialog` as `PrivateRoomForm`, adding the people picked), `ProfileBar` (`ProfileBar`, one button that opens
`PreferencesDialog` at Profile, whose form, `ProfileEditor`, it fills in), `ServerPane` (the design system's `ServerCard` in a `Popover`, whose `onclose` gives a phone's sheet a dimmed page to close it on, mounted by the page and opened through `$lib/ui/server-pane`; its Disconnect is `ChatClient.disconnect`, a `stop` that connecting again undoes), `RoomHeader` (`RoomHeader`, with its ⋯ `MenuButton`) with
`SearchDialog` (the design system's `SearchPanel`, a field and a listbox of results in a `Dialog`, which the page owns and opens from the room header's ⋯ menu or Ctrl/⌘F: it reads the query's text and `user:`/`room:` filters (`parseQuery`; the text matches as one run, `matchesText`), suggests a filter's value at the caret with the composer's `AutocompletePicker` (`filterAtCaret`, `searchPeople`, `searchRooms`, put in by `withFilterValue`) in the panel's `suggestions`, and matches (`queryMatcher`, resolving names against the users met and the rooms shown) with `$lib/ui/search` what `HistoryKeeper.searchKept` scans of this device's kept history (`scanMessages`, a few hundred rows a read) and what `storedRecords()` holds, and the page opens a result as a link to it, `linked` with `searched`), `RoomEditor`, `NewRoomDialog` and `NewThreadDialog` (all three the design system's `RoomForm`, one centered `Dialog` for creating or editing a room or thread; each wrapper keeps only its own requests: `RoomEditor` saves with `room_set`, `NewRoomDialog` creates a room and words a refused Private, and `NewThreadDialog`, which the page owns, names every new thread, from a room, a message or a selection, and leaves creating it to the page), `NewPrivateDialog` (the design system's `PrivateRoomForm`, a `PeoplePicker` in a `Dialog`, which the page owns: it starts a private room with the people picked, or opens the one you already have with someone, and at the server's limit offers yours to leave), the private room's intro and "You were added" banner (the design system's `PrivateIntro` and `AddedBanner`, which the page renders), `ThreadCard` (the design system's `ThreadMarker`; it and `ThreadList`'s rows share the preview lines of `ThreadLines`),
`ThreadDescription` (the open room's or thread's description, pinned under the header until its × puts it away, which `storage.ts` remembers per room until it's edited), `RoleBadges`, `MentionText` (`Mention`), the embeds (`Embed*`; the trusted-origin gate stays in `embeds/og.ts`; `EmbedTerminal` below), `MessageEditor` (`MessageEditor`, whose `field` the app supplies, the Composer's `MessageField`), `NoticeLine` (a scoped `Message`, from `noticeView`), `MembershipLine` and the renamed line (`SystemLine`), `Composer` (`Composer`, whose `field` the app supplies: `MessageField`, a `ComposerEditable` it fills and edits, with its `AutocompletePicker` (`MentionPicker`, for `@`, `#` and `:`)) and `StagedFile` (`AttachmentTile` in `Attachments`), `SelectionBar`, `JumpBar`, `StatusBanner`, `ReadOnlyBar`,
`ProfileCard` (whose Message opens or starts a private conversation), `ReactorsPopover` and `EmojiPopover` (the full emoji picker, which the design system leaves to the client; all three in the design system's `Popover`, a bottom sheet on phones),
`PreferencesDialog` (`SettingsSections` and `SettingRow`) with its `StatusPicker`, `PauseNotifications` and `NotifyPrompt` (`Nudge`), `SignInLinkDialog` (both
the design system's `Dialog`; a setting that takes effect at once is its `Switch`, and a
choice submitted with a form a `CheckList`-style row),
`MediaViewerHost` (the design system's `MediaViewer`, opened by image embeds through
`media-viewer.svelte.ts`, which reads the open timeline's `data-viewer-*` links), `TerminalViewerHost` (the design
system's `TerminalViewer`, opened by a terminal embed's Expand through `terminal-viewer.svelte.ts`; below), `UpdateNotice` (the design system's `ActionBanner`, which reads whether the page's
`PaneDrafts` hold anything unsent through `pageDrafts`). Avatars are the design system's `Avatar`, given an avatar
`directory` will load and the `hue` of their `user_id` (`hueOf`).

A message row has no wrapper: the page renders the design system's `Message`
straight from a `MessageView`, plain data that `messageView` (`src/lib/ui/message-view.ts`)
makes from the record, where it sits (grouped, selected, edited, highlighted) and what
the viewer may do (`MessageCaps`): the sender as `directory` knows them, with a handle
only where a name is shared, the body's sanitized markup, the reply's quote, the
embeds with their uploads and the reaction chips. It keeps what depends only on the
record and the directory per record, and hands back the previous view while nothing in
it changed, so a change elsewhere redraws no row. The row draws its header, body and
reactions itself and adds the rest only where present: the quote (`ReplyPreview`), the
messages, rooms and threads its links point to (`LinkCard`, an `<a>` the page's Apron link handler follows,
built on `EmbedCard`'s classes so it reads as a link preview; the links are read from the rendered body's anchors
(`placeLinksIn`), so a card follows exactly what the text links; `MessageContext.linked` and `linkedRoom` give what
is loaded or listed, and nothing is fetched for one; in the text, `directory.resolveLink` draws the links themselves
as chips), the
embeds (`MessageEmbeds`, each through the page's `embed` snippet, the app's `Embed`),
the hover toolbar (`MessageActions`, built once a pointer or focus reaches the row) and
the editor (the page's `editor` snippet, the lazy `MessageEditor`, for the row being
edited). What its controls do is one `MessageHandlers` object for every row, each
handler given the row's view: replying, reacting (the emoji picker through `pick`, who
reacted through `showReactors` in `reactors.svelte.ts`), editing, deleting, starting a
thread, copying the link, the select gestures (a shift-click, `x`, a long press),
opening rooms and profile cards, jumping to a quote, and decorating code blocks
(`decorateCode`). The design system's `Message` takes no other attributes. Global resets (the page's height, `box-sizing`, `font: inherit` on controls) are in `src/app.css`. A style change goes in `apron.css`, and reaches the
design system with the next `npm run design:bundle`. A user's `status` (§4.5)
is the design system's `StatusDot` on their `Avatar`: online a dot, idle a
crescent, dnd a barred dot, offline a hollow ring, your own `invisible` the
same ring with its own words, and any other value `unknown`, a dashed ring
whose words carry the value (`presenceLabel`), cut out of the avatar, with
nothing where the server sends no status or `""`. Its colors are the
`--presence-*` tokens. `directory.status` reads it from the kept user object
only, never a recorded `from`; for you that is the status you chose, since
the client keeps `status` only from a `you`. `user-status.ts` lists the
choices, words your own (`ownStatusLabel`), decides when the page is silent
(`pageSilenced`: paused, or `dnd`) and sorts the member list (online, idle,
dnd, unknown, offline, then none), where offline members are dimmed.
`seen` (§4.5.2), when someone's shown status last became `offline`, merges
into the kept user object like any field. The client also keeps `sawOffline`
(in memory, in the snapshot): the receipt time of each change of another
user's kept status to `offline` from one that showed, recorded in
`noteUser`, so a status learnt after a sign-in or held through a resume
(none kept) records nothing; `dropKeptStatuses` clears it except on a
resume, and `settleHeldStatuses` drops it for whoever it drops the `seen`
of. `directory.seen` reads both through `shownSeen` (only while they show
`offline`, never yours, the later of the two, and only a `log_id`-format
time a `Date` can hold), and `lastSeen` words it ("Last seen recently" under
`SEEN_RECENT_MS`, ten minutes, since a server may record `seen` coarsely,
with a tooltip that says only that; else "Last seen 15m ago" and the exact
time; always the `datetime`) for `ProfileCard`'s `seen` and, through
`withLastSeen`, the member row's tooltip.
`ProfileCard` shows an unknown value literally. Messages show no status: it
is about now, and they are history. `PreferencesDialog` renders the design
system's `CheckList` (what to notify about), `Callout` (installing for push,
and what the server answered for a status) and `MenuButton` (Status, in
`StatusPicker`, as a picker with `selected` and a `lead` dot per choice,
offering Online and None, and `dnd` and `invisible` where `accepted`
(`server.status`, which `ProfileBar` passes from the server frame) lists them
and the server hasn't answered something else for them (`unsupported`),
`busy` while the choice is saved, which keeps focus where `disabled` would
drop it; `onannounce` hands the server's answer to the dialog's live region;
and Pause…, in `PauseNotifications`) as they are, and `pause.ts` words and times
the pause. Its status notes are read through one
live region, and switches and checkboxes that can't change stay focusable with
`aria-disabled`, referring to the note that says why.

Live text (`terminal` and `append` embeds, §4.8.3) is read by
`src/lib/protocol/live-text.ts`: `followLiveText` makes the streaming `GET`,
hands each chunk on as bytes, and after a drop or a failure tries again with
a growing pause, its sink's `start` marking that the new response replaces
what was shown. It fetches through `setLiveFetch`'s fetcher, which
`/__preview` points at its in-memory server for that server's own URLs. A
`terminal` embed is the app's `EmbedTerminal`, the design system's
`EmbedTerminal` (a header with the title and Live, Ended or Finished, over a
screen box it hands to `attach`) with a `TerminalScreen`
(`src/lib/ui/terminal-screen.ts`) in that box: xterm.js, imported by
`src/lib/ui/xterm.ts` the first time a terminal is shown, so it and its
stylesheet are a chunk of their own, made read-only (`terminalOptions`; no
listener for input, replies, titles or the bell; OSC 0, 1, 2 and 52
swallowed; a link handler that opens nothing; scroll gestures kept for the
page), its font fitted to the box's width (`terminalFontSize`) and its height
cut to the rows written (`shownRows`), themed from the design tokens and
again when the theme changes. Writes made before xterm loaded wait in order,
and a reset is RIS written in the same queue, so a reconnect can't show the
old response's tail. The embed writes its decoded text to a `TerminalFeed`
(also in `terminal-screen.ts`), not straight to its screen: the feed keeps
the text since the last reset and writes it on to every screen attached, and
a screen attached later is shown the text so far first. That is how the
full-screen viewer follows a live terminal without a second `GET url` (the
server caps reads per live text): the design system's `EmbedTerminal` shows
Expand when given `onexpand` (and calls it on a touch tap on the screen),
the app's `EmbedTerminal` hands `terminalViewer.show` (`src/lib/ui/terminal-viewer.svelte.ts`)
a view of itself (title, live, status and its feed, read as they change),
and `TerminalViewerHost`, mounted once in the layout, draws the design
system's `TerminalViewer` (a `<dialog>` on the `MediaViewer`'s ground, its
screen box in a stage that scrolls) with a second `TerminalScreen`, fitted
by `VIEWER_FIT` (`TerminalFit`: the columns in the stage's width and the
rows in its height, no smaller than 13px for the rows or 9px for the
columns) to the stage it sits in (`space`), attached to that feed while
open. The message's screen keeps no scrollback (`terminalOptions`'
`scrollback`, 0); the viewer's keeps `VIEWER_SCROLLBACK` (5,000) lines,
and the feed's replay of the text since the last reset fills them. With
scrollback, `TerminalScreen` takes the wheel, vertical swipes (the stage
is `touch-action: pan-x pinch-zoom`, so the browser pans only sideways)
and the scrolling keys on its `keys` element (the dialog, so focus can
stay on Close) away from xterm, whose key handler refuses every key on
every screen, and `scrollBy` moves the lines kept and the stage as one
scroll: back, the lines above first with the stage held at the screen's
foot, then the stage; forward, the stage to the foot first, then the
lines. xterm keeps a reader at the foot as output arrives and leaves one
who scrolled back where they are; the stage, open at the foot, stays
there as the screen grows until the reader scrolls it. Opening it pushes a history entry (`page.state.terminal`), so Back
closes it, and closing it otherwise leaves that entry; an embed that goes
closes the viewer showing it. An `append` embed has no component: `messageView` reads
`liveAppend(url)` (`src/lib/ui/live-append.svelte.ts`, one per `url`, a
`createSubscriber` that reads while some row shows it and tells readers at
most once a frame, decoding with a streaming `TextDecoder`) and renders the
body's text and the streamed text as one body, Markdown still arriving first
settled by `settleMarkdown` (`src/lib/ui/live-markdown.ts`), with `writing`
on the view while it arrives; the embed is left out of the row's embeds. The
record itself never changes, so editing, quoting and copying use the
snapshot's text, and a save sends the embed back by `embed_id`.

`src/routes/+page.svelte` owns the session and the navigation (which room or
thread is open, per-room drafts) and composes the components. The
reactive state behind it lives in `src/lib/ui` as small classes — `SessionView`
(the last authenticated view, held through a reconnect or primed from this device;
`starting` while the first rooms aren't listed, `activeRoomHeld` while the open
room shows its held copy, and the open room's thread cards from the same view;
through a quiet reconnect, `steady`, `capabilities` and `passkeySession` keep
what the last ready session had, so controls don't blink out with a short drop,
and `reconnectQuiet` and `stalled` count from the client's `retryingSince`, when
it began trying where someone could see it, not from the drop), `MentionTracker`,
`IncomingMessageTracker` (new messages from others, for notifications),
`AppearanceSettings` (light or dark, and the theme: the premade ones, and reading a custom one's tokens; `theme-colors.ts` mixes a palette from a theme's base colors, and `src/lib/design/fonts.css` carries Recursive and Nunito for the themes that name them),
`UnreadTracker`, `ReadPositions` (how far you have read each room and thread,
kept on this device: where the New divider goes and the pane opens), `MessageSelection`, `FeedbackState`, `SidebarLayout`,
`PaneDrafts` (the composer's text and reply per room and thread),
`PagePresence` (whether the tab is attended, and the mention alert),
`ProgressiveReveal` (long timelines paint newest-first) and `FloatingDay` —
beside pure, unit-tested
helpers: `timeline.ts` groups threads under their rooms and builds the room and
thread views, `membership.ts` nets runs of joins and leaves and words their
lines, `reactions.ts` turns reaction summaries into chips (a key as its custom emoji's
image, or a placeholder), `custom-emoji.svelte.ts` keeps the server's custom
emoji catalog (`ext:emoji`), fetched the first time a key shows or a picker
opens, which `directory.resolveEmoji` draws keys in text with
(`renderMarkdown`'s scan in `protocol/custom-emoji.ts`), `emoji.ts`
places and themes the emoji picker (`emoji-picker.svelte.ts` keeps the one open
picker and loads emoji-mart), `draft.ts` edits the composer's draft, `draft-field.svelte.ts` (`DraftField`) is the field both the composer and the message editor write in (chips, caret and autocomplete), `role-mentions.ts` finds the roles an `@` can name (`@&role`) and who each one mentions, `link-previews.ts` finds a draft's links and fetches previews for those on a site `link-sites.ts` maps (GitHub, YouTube, X, Bluesky, Wikipedia), `messages.ts`
and `time.ts` read messages, `connection.ts` words the connection state, and
`commands.ts` maps the composer's `/` commands to requests (and picks the `ext:media` category a send's files fit: `emoji` for `/emoji add`),
`sign-in-link.ts` reads and scrubs a sign-in link (emailed, or the return from an external sign-in page) from the URL, tells this browser's own proposals' links from others, and words the question asked before using another's,
`members.ts` reads the `user_id` typed to add a member, adds people to a room in turn (`addMembers`, whose refusals `couldNotAdd` words) and splits the member list into Online and Offline (`memberSections`), `people.ts` sorts people by name (`byName`) and narrows who could be picked by what's typed (`pickable`, `matching`) for both people pickers, and
`room-order.svelte.ts` keeps the sidebar's top-level rooms in an order of your own (`RoomOrder`, by account under `apron.roomOrder`), which the sidebar drags rooms in with svelte-dnd-action and moves with Alt+↑/↓,
`storage.ts` keeps everything remembered between visits under `apron.*` keys,
Preferences and read positions included (on this device only; nothing is synced),
`session-cache.ts` keeps `SessionView`'s held view in IndexedDB per server, trimmed to
the last day's messages (`keptView`), which the page primes `SessionView` with
(`prime`) before the next visit's session is ready: shown as a held view, never
fed to the unread, mention or notification trackers, and replaced room by room
as a reconnect's is, and
`notifications.ts` shows notifications, through `service-worker.ts` where it
is registered, and words pushed messages for the service worker,
`private-rooms.ts` holds what private rooms (§4.2.4) as conversations need: which
joined rooms are private and top-level (the sidebar's Private section and the
`private_rooms` limit count those), the conversation you already have with
someone (`directRoomWith`), starting one (`startPrivateRoom`: created private,
its record checked, then each person added in turn with `addMembers`), where its intro goes
(`reachesStart`), and `ArrivalWatch`, which the page feeds each snapshot as the
client emits it, while what's in flight is still pending in it, to tell a room
someone else added you to from one this page asked for; `faces.ts` turns
people into the design system's `Faces` (`faceOf`, `facesOf`) through `directory`,
`notify-scopes.ts` decides which arriving messages the page notifies about from
the checked scopes, and which of them push sends as `wake`, and
`push-store.ts` keeps in IndexedDB, for the service worker too, the enabled
`push_id`s and the newest message each notification group notified about,
`web-push.ts` keeps this browser's push subscription for the server's key
(`WebPushSync` runs subscribing and unsubscribing one at a time, under a Web
Lock), `push-settings.svelte.ts` (`PushSettings`) turns push on and off per
account and shares the one subscription between accounts and tabs, and
`sw-handlers.ts` holds the service worker's push and click handlers, apart
from the worker so tests can run them. `media-settings.svelte.ts`
(`MediaSettings`) keeps where media loads from (Preferences, Media), and
`directory.mediaOrigins` is what it trusts on the active server: the server's
`ext:media` origins and the viewer's trusted origins, or `ANY_ORIGIN` under Any
site.

Media loads only through one gate, by construction. `media-gate.ts` is the only
place a URL becomes a `MediaSrc`, the type the design system's `MediaSrc`
props take (an avatar, an attachment tile, a card's or upload's image, video or
audio, the viewer's image, a custom emoji, a server's avatar): a `MediaGate`
(`directory.mediaGate`, `avatarGate`, `avatarGateFor` a recent server,
`localMedia` for this page's own object URLs) answers each URL with a
`MediaSrc` or nothing, so a plain string can't reach one without a cast, and
`npm run check` says where one tries. An embed reaches the design system's
`Embed` only as `message-view`'s `embedProps` makes it (its `og` media gated, no
HTML); the page draws it from the embed it was made from (`sourceEmbed`). The
custom emoji catalog is fetched only where `mediaGate` lets its emoji load, since
a fetch tells a site as much as an image does. A live view (`iframe`) loads only
on a click, as a link would. Markup from anyone else reaches the page only through
`$lib/protocol/sanitize` (`sanitizeHtml`, which `renderMarkdown`, `renderPlain`,
`renderBio` and HTML embeds use): after DOMPurify, every URL that would load is
asked of the gate it is given (none: nothing loads; `data:` media, in the
markup itself, loads from nowhere and stays), in an inert `<template>`
so nothing is fetched meanwhile; an image, video or audio that may not load
waits for a click where the gate says one may load it (`MediaGate.ask`), else
becomes a link to it (a custom emoji, its key), and `srcset`, `background`,
`data` and `ping` never stay. Media that waits for a click is the design
system's `MediaAsk` in a card or an upload (`loadableOg` gives its `ask`), and
the same markup, written by the sanitizer, in a message body; **Load** calls
`directory.loadOnce` (the gate then lets that URL through, on this page) and
**Always load** `mediaSettings.trust` (its origin joins the trusted ones).
`media-ask.ts` connects both, and answers the sanitizer's buttons
(`data-media-load`, `data-media-trust`) for the whole page; DOMPurify keeps no
`data-` attribute it doesn't name, so only the sanitizer writes them. `media-guard.test.ts` reads the source and fails
on anything else that makes a `MediaSrc`, imports DOMPurify, inserts markup, or
renders media outside the components that take a `MediaSrc`, and
`e2e/media-gate.spec.ts` names media on another site every way a server or a
sender can (and a custom emoji catalog on another site) and checks that none of
it is requested by default until a click, that Load loads only that one, and
that Always load trusts the site. What stays outside the gate:
the previews the viewer's own pasted links get from the sites `link-previews`
knows, a live view on a click, and the casts `media-guard.test.ts` lists, none
of them media.
Each gate is part of `directory.pieces`, so a change redraws every row, and
sanitized markup is kept by the gate it was made with.

Protocol types, replay reduction, and the WebSocket session live under
`src/lib/protocol` and speak Apron protocol v10. `client.ts` holds the session,
`ChatClient`, and re-exports the rest of its API: `client-types.ts` has the
snapshot and option types, `client-views.ts` the pure helpers over snapshots,
capabilities and server URLs, and `client-internals.ts` the per-room state,
tuning constants and helpers only `ChatClient` uses, `signin-connection.ts`
the connection an email or external sign-in proposes and approves on, and
`proposals.ts` the proposals this browser made, kept by their `state`.
`plain-text.ts` cleans text that people write and others see as plain text,
such as a bio (`ext:bio`): `cleanPlainText` drops control characters and the
bidi overrides and isolates that could make the text around it read
backwards, and keeps at most one blank line in a row. A bio is then
escaped, with only its bare `http(s)` links linked (`renderBio` in
`markdown.ts`), so nothing else in it is ever markup. `reducer.ts` keeps one store
of room records, message snapshots, per-user reaction sets, and memberships
for every room, and beside the latest membership per user, each room's
membership records in `log_id` order for the timeline's join and leave lines;
each record replaces the stored one only when its `log_id` is greater, so
overlapping history and live delivery cannot revert newer state, and a move
snapshot re-homes a message into its new room. Embedded `reply_to`
snapshots install like any other record. Room records keep `description` and `private`
(fixed at creation); an untitled top-level private room's snapshot `title` is
its other members' names (`peopleTitle`, `namedForMembers`), so everything
that names a room names it the same way; a room's `members` from a listing come with its
`member_count` when the server truncated them, kept until a complete list
replaces it. `types.ts` also knows the system identities (`~server`, `~room`,
`~private`). Reactions aggregate
per message (counts per emoji, who reacted, whether you did), entries that
differ only in U+FE0F as one, shown in their fully-qualified form, and are
hidden on tombstones.

Recovery is per room and uses `latest_log_id` and `history_log_id`. For each
top-level room the client tracks the monotonic effective lower bound and a
checkpoint, captures a fixed head from the room's record when it is listed or
joined, pages every
record kind from the bound (or the checkpoint), and buffers bounded live
records until recovery finishes; the room's published timeline is held until
then. If retention overtakes the next uncovered position the client rebuilds
from the new bound and ignores obsolete replies. `history_log_id: null` means
the effective bound is `latest_log_id + 1`. Sparse timestamp log IDs are
expected. Threads are rooms with a `parent_room_id`; they load their own
history with `loadRoom` when opened: the newest page (`before` the head, no
`after`), then older pages with `loadOlder` (`before` the oldest loaded
`first_log_id`) until one reports `more: false` or the bound passes it. A lost
connection keeps each room's records, members, bound and checkpoint: the next
connection resumes each kept room's recovery from its checkpoint right behind
`auth`, before any head is known (the first page reports it), and the room
stays if that connection's `room_list` lists it as joined. The listings of rooms
and threads to join (`directory`, `threadDirectory`) stay too, as they were,
until the next connection's replace them or it signs in as someone else; a
thread loaded before the drop shows as `resumed` until its next load catches
up. Through a resume, `statusesBeforeResume` keeps every status held from
before until the joined listing, for a list that changes over once. A resumed passkey
session asks only for the rooms whose `latest_log_id` passed the kept
checkpoints (`latest_log_id` in `room_list`): rooms in `left` go and the rest
stay; a result without `left` is a full listing. A thread reopened after a
reconnect loads only what came after its own checkpoint. Signing out or switching servers still starts over. The client
honors server retry delays with jittered reconnect backoff. When the `server` frame carries `ping` ([PROTOCOL.md §1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#1-transport--framing)), the client sends
exactly `{"method":"ping"}` every that many seconds, from before
authentication on; a ping that goes a whole interval without the
`{"method":"pong"}` answer marks the socket dead, and it is replaced through
the usual reconnect. `serverSettings` reads extension `ext:settings`
(`server.ext.settings`, only where `capabilities` lists it): with
`read_cursors: false` the client moves your read cursor locally without
sending it; elsewhere `markRead` sends each room's at most every
`READ_CURSOR_SEND_MS` (10 s), the latest of those that came sooner at the
end of the interval, and flushes those waiting when the page is hidden and
after the next sign-in. `yourPermissions` reads extension `ext:permissions`
(`you.ext.permissions`, an object, only where `capabilities` lists it; a key
that is absent or not a boolean takes its default, and so does every key
when `permissions` isn't an object; without the extension it offers what
PROTOCOL.md allows: writing, adding members anywhere, moving your own
messages): with `write: false` the snapshot is
`readOnly`, whoever you are. A `retry_after` refusal's `data.ext.limits` counts only where
`capabilities` lists `ext:limits`: `limitScope` turns it, with the refused
request, into the wait's `LimitScope`, and `heldBack` refuses what
`limitHolds` says that wait covers before it is sent.
`setIdle(idle, inputAt)` reports attendance, as `PagePresence.idle` decides it (no
input for `IDLE_AFTER_MS`, hidden on a handheld, or loaded hidden and unused;
the page's captured `keydown`, `pointerdown`, `pointermove`, `wheel` and
`touchmove` call `PagePresence.input`), with `status` requests `{idle}` (§4.5,
capability `status`) through `syncIdle`, which sends nothing until the
connection is signed in (`handleAuth` calls it after the result; a replacing
server frame while signed in calls it too). `idleReport` holds what the
server has for the current connection: each starts attended, so an attended
start sends nothing, and one on an idle page says so at once. Idle goes as
the whole seconds since `inputAt` (`PagePresence.inputAt`), or since the
page went idle where that is unknown. One request is
in flight at a time and the latest state follows its `{}`; a `retry_after`
error waits out the delay and then syncs the current state, and any other
error or a timeout does the same after a backoff from `IDLE_RETRY_MS`,
doubling to `IDLE_RETRY_MAX_MS`. `setStatus(status)` sends
`me` `{status}` and resolves with the `you` the server kept, whose `status`
is the one in effect. `setMute(mute)` sends a `status` request `{mute}` and
returns a promise that resolves on `{}` and rejects with the server's error
(nothing changed; `PauseNotifications` shows it in a `Callout`); it changes
nothing else: only a `status` notification from the server (`handleStatus`),
which reaches the sending connection too, before the result,
sets the snapshot's `mutedUntil`, or a room's with its `room_id` (and
`roomMutes`, every room paused, joined or not), which timers clear when
they run out. A sign-in, in `handleAuth`, is an `auth`
as a user the connection isn't already signed in as: an `auth` that adds to
the signed-in connection isn't one (a passkey registered while
authenticated, a guest's included, passes `added`, and an added address's
`{}` result never reaches `handleAuth`), nor is a repeat `auth` as the same
user (§3.2). Every notification a sign-in causes comes after its result, so
each sign-in drops the kept mutes (`resetMutes`) when its result arrives,
and the `status` notifications after it apply as they come, like any
other; a lost connection keeps the mutes until then. A `room_update` the
sign-in causes, such as an automatic join with its membership, also comes
after the result, and applies like any other, before or after the joined
`room_list` sent behind `auth` answers. `handleServer` keeps `server.status`, the optional
statuses the server accepts, as strings. Kept
users' `status` values outlast a lost connection, and each sign-in drops
them (`dropKeptStatuses`), all but your own, which the `auth` result's `you`
gives, so they show none until the server sends them again: as `user`
notifications after the result, and in the current user objects of
`room_list` and `room_update`, which carry `offline` and `""` too. A
resume as the same user still shows the dropped ones in the snapshot's
`users` until its joined listing arrives (`settleHeldStatuses`), and names
those users in `heldStatuses`, since they are no longer kept.
`setPushRegistration(params, userId)` keeps the `push_register` params (§4.9)
and sends them after each `auth` as that account while `server.push` offers
their `kind`. A replaced or cleared registration is unregistered, after the
next `auth` as the account it belonged to if it can't be at once
(`pushUnregisters` keeps each `url` with its user). `pushRequest` chains
requests for the same `url` on a connection, each after the last one's reply
(§1), so an unregister and a register can't apply out of order. Signing out unregisters and keeps the
unregister queued for its user until answered, so one lost with the replaced
connection goes again after that user's next `auth`; switching
servers forgets it. `setPushOff(url)` unregisters this browser's endpoint after
each `auth` while push is off for the account, and a refused `push_register`
is the snapshot's `pushError`.

Edits, moves, and deletion use the same `message` request as creation, with an
existing `message_id`, and resubmit every client field of the latest snapshot
(`room_id`, `body`, and a bare `reply_to`). `ext` is not resubmitted: a save
merges it one level deep (§4.12), so a save sends only the `ext` keys it
changes, a key with an empty value removes it, and a pending save settles on a
record that matches it whatever its `ext`. `ext` goes in `me`, messages and
`room_set` only to a server with capability `ext`; without it the client
leaves `ext` out of the request. A move is a save
with another `room_id`. Rooms and threads are created and updated with the
`room_set` request (capability `rooms`); a creation may ask for `private: true`, and
updates resubmit `title` and `description` (never `parent_room_id`,
`private`, or `ext`, which merges like a message's), and the change arrives as a `room_update`. The
client does not depend on the notifications a request causes arriving before
its result, as servers send them.
`room_join` and `room_leave` take the `room_id`, and a `user_id` to add or
remove someone else; an `unsupported` reply sets the snapshot's
`memberChangesUnsupported` until the next `server` frame. Reactions use the
`reactions` request (capability `reactions`) with your complete emoji set.

Every successful `auth` result is handled alike: its `you` becomes the
connection's identity and a `token` in it replaces the saved one, whether it
answers a guest sign-in, a token resume (rotation), a passkey, or an email or external sign-in.
A passkey ceremony is `usePasskey(action, name?)`, one per tap: `login` or
`register` (§4.10), modal mediation only, on the connection to this server
whether or not it is signed in. It is busy (`authBusy`, `passkeyBusy`) from
the call on, waits for requests sent as the old identity to settle, sends
`name` with a register `begin` and labels the new passkey with it
(`labelledCreationOptions`), and after a login relabels the passkey through
the Signal API where the browser has it (`signalPasskeyLabel`).
`cancelPasskeyPrompt()` abandons it at any point. The connection's own
sign-in never runs one: where only a passkey brings a registered session back
(no token to resume with), or a resume was refused, `authenticate` holds the
connection (`held`) and says how to sign in (`signInNeeded`), and the page's
sign-in panel (`SignIn.svelte`, state machine in `$lib/ui/sign-in`) takes the
user's tap from there.
Email and external sign-in (§4.11) propose on a connection of their own,
since a proposal on a signed-in connection would add to its account, and a
short code works only on the connection that proposed it: `requestEmailCode(email,
url?)` and `proposeExternal(returnUrl, url?)` open a `SignInConnection`
(`signin-connection.ts`) to that server that never signs in until approved,
wait for its `server` frame, and propose (`auth` without `token`, with
`email` or `return_url`). Each proposal carries a new random `state`,
remembered first in local storage (`proposals.ts`, for an hour) with its
server and whether it signs in or adds, for the link that comes back with it,
in this tab or another. An external proposal's `url` is opened only when it is
`https`, or `http` on a loopback host (`signInPageUrl`); a `return_url` the
server refuses (`invalid_params`, a rejected value) is dropped and the proposal
sent again without it, so the page shows a code instead. Any other refusal,
`denied` included, is shown as it is, not retried. A proposal that fails is
forgotten from local storage, so failures don't push out a live one. The connection stays open
for a code (pinging, and closed after `PROPOSAL_MS`) as the snapshot's
`signInCode`, leaving this connection and its view untouched; with a return,
it closes, since a link works on any connection. A newer proposal,
`cancelSignInCode()` and `stop()` close it, but the server keeps the proposal,
and its link still works. `signInWithCode(code, name?, beforeSwitch?)`
approves on it (`auth` with `token`, the proposal's scheme); a `denied` code
leaves it open to try again. On success the client
adopts that connection as its own: `beforeSwitch` runs, it moves to that
server if another (`switchServer`, as `setUrl` without connecting), closes its
connection as `restart` would, attaches the socket (`attachSocket`, shared
with `connectNow`), takes the `server` frame in without answering it, handles
the result as a sign-in, and then processes the frames that arrived after the
result. `signInWithLink(token, url?, { scheme?, state?, beforeSwitch? })` does
the same with a link's token on a fresh connection, with the proposal's
scheme or else one the server offers (approval takes either); a refused link
changes nothing. Approval forgets the proposal's `state`. It is recorded as
signed in with the proposal's scheme, or the only one the server offers, or
else `link` (email or external, not known which), never a guess.
`requestEmailCodeToAdd` and `proposeExternalToAdd(returnUrl?)` propose on the
signed-in connection, for its account; `addWithCode(code)` approves on that
same connection (refused if it has reconnected since), and
`addWithLink(token, state)` on any connection signed in to the account that
proposed it; `addWithConfirmedLink(token)`, on this connection, for a link of
no addition this browser proposed that the viewer said is one (the server
refuses it unless this account proposed it). Their `{}` result adds the address or identity: another way back
in for a registered session, or, for a guest without a token, what makes it an
account. How the kept
session signed in (`webauthn`, `email`, `external`, `link`, `token`) is remembered beside its token
as `signedInWith`, and ways added to the account since beside it
(`signInMethods`). Proposing a sign-in, `signInWithCode` and registering a
passkey accept a scheme listed in `auth` or `signup`, and adding an email or an external sign-in needs it in `auth`; a passkey login and a
token resume need it in `auth`. The `server` frame ([PROTOCOL.md §3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame))
is kept on the snapshot's `server` as sent: `apron` (the version), `capabilities`,
`agent` (the implementation, for debugging; the UI labels a server by its
`title` or else its host, never by `agent`), `welcome`, `title`,
`description`, `avatar` (which `serverLook` reads, the avatar only where a
user's would load), `signup`, `ping`, `push`, `status` and `ext`. A server is
known by its address, `serverAddress` (RFC 3986 §6.2.2–6.2.3, without a
fragment, which `new WebSocket()` refuses), which the client's URL, its kept
session's keys, link servers and Recent all use.
Frames are kept as sent. What users write loses the bidi embeddings and
overrides U+202A to U+202E (§3.5.2) only where it is shown, through
`withoutBidiOverrides` (`plain-text.ts`): in `roomTitle` and `peopleTitle`,
`serverLook`, every render in `markdown.ts`, the directory's `person` and
`name` (`shownPerson`, so names that look alike once they are dropped share
a name), an embed's text (`shownEmbed`), thread previews, renames and
notifications. Editors start from the records, so an edit sends back every
character, and IDs, tokens, write URLs and `ext` are never touched. Every `auth` the client sends carries `agent: "apron-web/0.4"`
(§3.2).

Exports live in `src/lib/archive`, in the format [ARCHIVE.md](../ARCHIVE.md)
specifies. `archive.ts` writes and reads it: `exportArchive` takes a
`ChatClient`'s `storedRecords()` (the `ProtocolStore`'s records, which
`records()` returns as the store keeps them: one per key, and every membership
logged), its `roomSyncs()` and its snapshot, and writes a header line, one
`room_list`-shaped line listing the shown rooms (and their parents; private
rooms, the threads in them and anyone known only from them only with
`privateRooms`) with each
one's `history_log_id` set to where its unbroken stretch of records starts (the
oldest page it loaded, `olderBefore`, or its retention floor), then each record
in a stretch, one per line in `log_id` order, as a `history` result would carry
it; a message outside every stretch goes only when one in a stretch replies to
it. `parseArchive` reads one back through the same decoders as a server's
frames, skipping lines and records it can't. `ArchiveServer` is the server in
the page that `/archive` (`src/routes/archive`) mounts the app against, as
`/__preview` mounts it against `MemoryProtocolServer`: it offers only guest
sign-in, as a `you` with `ext:permissions` `write: false`, says what it serves with `ext:archive`
(which the read-only bar reads, `serverArchive`), answers `auth`, `room_list`
and `history` (each room's stretch, or without `room_id` the joined rooms'
together from the greatest of their bounds), refuses writes with `denied` and
replies `unsupported` to the rest. Both make their sockets with `memorySocket`
(`src/lib/preview/memory-socket.ts`), a `WebSocket` as far as the client can
tell. Unlike `/__preview`, `/archive` is in every build.

History kept on this device lives in `src/lib/history`. `log.ts` pages a
room's log as `history` does (§4.3.2), for everything that answers it from what
is kept rather than from a server: `sliceLog` takes the oldest `limit` entries
from `after`, else the newest up to `before`, never splitting the entries at one
`log_id` (a reaction or membership record's sets and entries, kept one per
user), and `historyResult` folds them back into the records a server sends.
`ArchiveServer` pages an export with it, from memory. `history-db.ts` is the
IndexedDB store: a database per account on each server, named for both
(`historyName`, `apron-history:` and the two encoded), so nothing read for one
account (a restore, a page, a search) can come from another's, and forgetting
one deletes its database; `listHistories` finds them by name
(`indexedDB.databases()`), as a restore must before signing in, when only the
server is known. Each is shaped like a server's log: `records` keyed by `[room,
log, kind, id]` (`log_id`s as numbers, so a page or everything below a bound is
one key range), with a `key` index to replace a message's or reaction set's row
as it is written (compaction on write; a creation, `log_id == message_id`,
needs none), `rooms` with each room's record and `RoomSync`, and `meta` with
whose it is, the users, and a `version` each write moves on. It pages with the
same rules in a few requests whatever the page's size (a key cursor jumps to
the page's edge, one `getAll` reads it, one `count` says whether more lie past
it); `log.test.ts` holds the two pagers to the same pages.

`ProtocolStore.observe` reports each change it takes (a record that replaced
what it had, a bound's eviction, a rebuild's clear), and `HistoryKeeper`
(`history-keeper.ts`) mirrors those into the store in batches, one transaction
each, with every settled room's sync (`ChatClient.keptState`), so a room's
checkpoint is never kept without the records it covers. A write puts down only
the room rows whose record (by reference) or sync fields changed, and the users
only when `usersRevision` moved: the client's `KeptUsers` counts changes to
what is kept of a user, not to their `status` or `seen`, so presence alone
writes nothing. A room joined and
settled that isn't kept yet is written whole (`storedRecords(roomId)`), a few
rooms a write (`WHOLE_BUDGET`) so writing many isn't one long task; one no
longer joined goes once the joined set is complete, which is kept as complete
only once every joined room has a sync kept (one without would be left out of
the next visit's listing of what changed since). One tab writes per server,
under a Web Lock. A tab that takes it over goes on from what it restored when
`version` is still what it read; otherwise, for the same account, it writes
each room over only as far down as it holds it, keeping what is kept below when
that reaches up to it, and leaving a room as it is kept when there is a gap
between the two (`mergeOf`); another account's database on that server is
deleted first, so one account's is kept per server, as one session is saved.
Another tab deleting the database (signing out, or keeping turned off) closes
it here (`versionchange`), and this tab's writer ends rather than make it again.
A write that fails (a full disk) stops keeping for the page.

Before each new session signs in (the first, another server, a `restart`, but
not a reconnect), the client runs its `beforeFreshSession` hook while the
connection opens, and signing in waits for it, for up to `FRESH_HOOK_MS`. The
keeper's reads back each room's newest `RESTORE_WINDOW` entries (`plannedRoom`
applies the retention) from the one database kept for the server, and `ChatClient.restore` takes them as a dropped
connection's kept state: the rooms retained with their records and syncs, so
the first sign-in resumes each from its checkpoint through `requestRooms`, the
path a reconnect takes. Should that sign-in be as another account than the one
it was kept for (a saved token that now resumes as someone else), everything the
restore brought in goes before anything shows it (`dropRestored`). A room held only to its newest shows as loaded newest
first, and the keeper remembers how far down the rest reaches (`Coverage`):
`loadOlder` asks it first (`olderPagesFrom`), and it answers from IndexedDB
while what is kept is still what it restored from, the server paging beyond.
The sync it writes keeps that deeper reach, and records it served aren't
written back. `settings.svelte.ts` holds the retention
(`apron.historyRetention`), which Preferences' History section sets. The view
`session-cache.ts` keeps still paints the page before the session signs in.
