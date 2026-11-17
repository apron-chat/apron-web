# History

What changed in Apron for the people using it, a week at a time, newest first.

<!--
To update: run `git fetch --unshallow origin` if the clone is shallow, then read
this file and find the newest week below. Summarize every commit that landed on
origin/main since then, as main records it:
`git log --first-parent --reverse --format='%h %cd %s' --date=short --since=<monday> origin/main`.
A merge commit counts as one change; read it with `git diff <hash>^1 <hash>`.
Add new weeks above the old ones. Don't edit past weeks unless an entry is wrong.

Don't trust commit messages and PR descriptions alone: they can describe plans
that changed or miss work added in later commits. Check each commit's diff
(`git show --stat <hash>`, then the files that matter) to see what actually
shipped. Where a message and its diff disagree, write from the diff. If a later
commit in the same week reverts or reworks an earlier one, describe how it ended up.

Weeks start Monday: `## Week of 2026-11-16`. Skip a week if nothing in it qualifies.
The first week (2026-09-21) starts with the web client imported from shazow/apron
(#1): open it with a short paragraph on what Apron could do then, then list the
rest of that week as usual.

Write for someone who uses Apron, not someone who works on its code. Name the
feature as users see it ("the document viewer", not "DocViewer"). Write one line
per entry and end it with its PR numbers, like (#256, #257), or with the short
commit hash when a commit has no PR number. If several PRs built one feature,
give it one entry.

Order within a week:
1. **New feature:** something users can now do that they couldn't before.
2. **Changed:** existing behaviour that works differently now, or a breaking
   change: something a user has to relearn, set again or upgrade. Say what to do
   if anything.
3. **Removed:** something users could do before and can't now.
4. **Improved:** a substantial gain in UX, accessibility, reliability, speed
   users would notice, privacy or security.
5. **Fixed:** a bug that users would have noticed or reported, such as lost
   drafts, a stuck sign-in or wrong data. Leave out flaky tests and fixes for
   bugs that never shipped.

Mark protocol or server-compatibility changes with **Requires server protocol vN**.

Leave out styling tweaks (pixel sizes, spacing, corners), refactors, tests, CI,
perf-budget updates, dependency bumps and follow-up review fixes. If you can't
tell whether a user would notice a change, leave it out. Aim for 3–8 entries a
week.
-->

## Week of 2026-11-16

- **New feature:** Dismiss a temporary notice, such as a server notice, a command's reply or a local error, with its ×. Notices now sit in the message column. (#284)
- **Changed:** External sign-in opens the server's sign-in page in a small window, or in this tab if the window is blocked, and finishes by itself when you return. Servers with the older external sign-in aren't supported: sign in another way, or ask the server's admin to update. (#278)
- **Changed:** A message with a link waits up to 1.5 seconds for its preview so the card goes out with it, and Send shows a spinner meanwhile. If you hide or leave the page, it goes at once. (#282, #283)
- **Improved:** Passkeys work on servers whose passkeys this page couldn't use before, through the server's own passkey page. Sign-in choices use the server's own names, such as "Acme SSO". (#278)
- **Improved:** Links whose text doesn't show where they go, or whose address could pass for another site (lookalike letters, punycode, `bank.example@evil.example`), stand out in their own colour. (#286)
- **Improved:** YouTube link previews show the video's thumbnail. (#282)
- **Fixed:** An emailed sign-in code stopped working if the page reconnected while you read the email, for example after a phone slept. (#278)

## Week of 2026-11-09

- **New feature:** Markdown attachments open rendered in a full-screen document viewer, with Download and Smaller and Larger text. (#251, #260, #261, #277)
- **New feature:** **Embed as attachment** turns a long draft into a `message.md` file on the message, leaving the field free for a caption, on servers that accept it. (#256, #257, #258, #259)
- **New feature:** Unsent drafts are kept on this device for each room and thread, so a reload, closed tab or crash no longer loses them. Attached files aren't kept. (#272)
- **New feature:** The @mention picker offers people outside the room, and "Add to room on send" adds them as the message goes. Mentions that won't reach anyone are greyed out. (#267)
- **New feature:** Room and thread descriptions are written like messages, with formatting, mentions, checklists and Preview. (#249, #266)
- **New feature:** The message toolbar offers your three most recent reactions, and a + beside a message's reactions opens the picker. (#248)
- **Changed:** Only one window of a browser stays connected to a server. The other shows "Apron is open in another window" with **Use here** to take it back. (#270)
- **Changed:** The message toolbar is a row of icons above the message instead of over its first line, with labels in wide windows and a ⋯ menu on desktop. (#248, #250, #252, #271)
- **Changed:** Closing a live terminal embed hides it and stops streaming, and it stays closed after a reload. Back, or a click beside the content, closes any viewer. (#253, #254, #255, #259)
- **Changed:** The composer stays usable while reconnecting; only Send waits. Leaving a thread you're the last one in asks first. (#265, #272)
- **Improved:** Coming back to Apron on a phone, or switching from Wi-Fi to cellular, reconnects in about 2 seconds instead of waiting on a dead connection. (#264, #268)
- **Improved:** On a small phone with the keyboard up, the composer keeps the line you're writing and Send in view. (#279)
- **Improved:** Input methods no longer trigger Enter and the arrow keys mid-composition in search and pickers, a skip button jumps past the rooms list, and Windows High Contrast mode shows focus. (#276)
- **Fixed:** After signing in with a passkey from a guest session, the open room got stuck on "Checking for new messages…". (#264)
- **Fixed:** Avatars and custom emoji showed as initials after a reload on servers that keep media on another domain. (#244)

## Week of 2026-11-02

- **New feature:** Keyboard shortcuts throughout, listed with ?: Alt+↑/↓ moves between rooms and threads, ↑ from an empty composer moves through messages, and r replies, e edits. (#212, #218, #219)
- **New feature:** Ctrl/⌘K finds any room or thread by name, joined or not, and Ctrl/⌘F searches messages, loading older history from the server on request. (#220, #224, #225)
- **New feature:** A full-panel composer for longer messages, with a formatting toolbar and Preview. (#229, #243)
- **New feature:** Checklists: `- [ ]` items show as checkboxes that the author and anyone the message mentions can tick. (#236, #242, #243)
- **New feature:** Voice notes and audio play in Apron's own player, with a waveform to seek along and 1×, 1.5× and 2× speed. (#233, #235, #237, #241)
- **Changed:** Signing out keeps this device's local history for when you sign in again. To delete it, untick Keep local history when you sign out, or use Preferences > History. (#199)
- **Changed:** A room picked under Other Rooms opens for reading without joining. Press Join, or post, to join. (#212, #215)
- **Changed:** Muted rooms no longer count toward the tab title or app badge, and mentions of you now get through a mute. (#226, #228)
- **Changed:** Connecting to a new server takes two steps: its address, then the sign-in options it offers. Recent servers can be starred or removed, and the guest button reads Join. (#231, #240)
- **Changed:** Links to rooms or messages on another server open in a new tab instead of switching this tab's server. (#230)
- **Improved:** Faster startup: a room's first messages show 20–28% sooner on phones. (#201, #221)
- **Improved:** Reconnecting no longer stalls on "Still trying to reconnect…", and a saved server that's gone no longer leaves the app stuck. (#216, #239)
- **Improved:** Clicking a notification opens the message itself, also in an installed phone app, and push notifications show the room's name. (#203, #204, #223)
- **Improved:** Animated images you upload have their metadata removed, and HTML embeds may use only an allowed set of tags. (#223)
- **Fixed:** Blank lines typed in the composer were dropped, so paragraphs were sent as one. (#208)
- **Fixed:** In Safari, pressing Enter to confirm input-method text (for example Japanese) sent the message. (#223)
- **Fixed:** New replies in joined threads didn't show in the rooms list after a reconnect or reload. (#200)

## Week of 2026-10-26

- **New feature:** Private conversations with one or more people, from **Message** on a profile card or the + beside the new Private section. Where the server supports them, private rooms show read receipts, which you can turn off in Preferences. (#123, #129, #187)
- **New feature:** Local history: a signed-in session keeps what it loaded on this device (30 days by default, deleted when you sign out) so reloads show it at once. Search it with `user:` and `room:` filters, export it as `.jsonl`, and open an export read-only. (#135, #137, #171)
- **New feature:** Live text: terminal output shows in a real, read-only terminal you can expand to full screen, and `/live` types your next message live while others watch. Live streams from v9 servers show only as plain cards. **Requires server protocol v10** (#162, #189, #191)
- **New feature:** Organize the rooms list: drag rooms into order, mute a room or thread for a while, and fold headings down to what has news. Threads quiet for 3 days fold under Inactive, and Browse rooms is now Other Rooms. (#125, #145, #147, #148, #150, #151, #160, #185, #198)
- **New feature:** Themes: Apron, Ferrous, Gumball, Linocut, or your own CSS. Fonts you chose before become a custom theme. (#174, #177)
- **New feature:** Copy selected messages as a Markdown log, mention everyone with a role with `@&role`, and get mention chips and suggestions while editing. Links to YouTube, X, Bluesky and Wikipedia get previews too. (#122, #159, #164, #168, #172, #181)
- **Changed:** Images, video and audio from sites other than the chat server and your trusted sites wait for a click: Load, Always load, or Block. To load from every site you haven't blocked, choose Any site in Preferences → Media. (#163, #193, #194)
- **Changed:** Preferences opens at Profile from one button in the profile bar. The server's name above the rooms list opens its details, with Connect to another server… and Disconnect. (#174, #177)
- **Improved:** Brief drops no longer flash banners or empty the page, and the room you're reading catches up first. On servers that keep read cursors, unread counts survive a reload. Notifications close once you've read the room on another device. (#127, #128, #130, #154, #169, #173)

## Week of 2026-10-19

- **New feature:** Apron links: link.apron.chat links to rooms, threads, messages, people, invites and sign-ins open in the app, and show as chips in messages. The ⋯ menu copies a link to the room or thread. (#112, #119)
- **New feature:** Sign in, or add a way to sign in, through your server's own sign-in page where it offers one. **Requires server protocol v9** (#89)
- **New feature:** Long-press or right-click a reaction to see who reacted. (#90)
- **New feature:** Profiles can have a bio of up to 250 characters. (#115, #116)
- **Changed:** Where you are in the app is kept after the `#` in the address, so the host serving Apron never sees which servers and rooms you open. Old `?room=` bookmarks open the default room: open the room again and re-bookmark it. (#114)
- **Changed:** Whether you can move other people's messages now depends on what the server allows you, not on your admin or mod role. (#111)
- **Changed:** A room's or thread's description is pinned under the header in three lines. Its × hides it until it changes, and threads call it "Description" instead of "Summary". (#91, #94, #108, #117)
- **Improved:** Rooms and threads open where you left off, at the New divider, even on servers that keep no read cursors. (#100)
- **Improved:** Moving messages into a thread adds their authors to it, so they can still see them. (#95)
- **Improved:** On phones, the app fits above the keyboard with the header in view, and iPhone no longer zooms into the composer. (#97, #118)
- **Improved:** Rate limits count down in the timeline and on Send, and a held-back room loads again by itself. (#109)
- **Improved:** Voice clips are about a quarter of the size, and the avatar picker accepts any image your browser opens, such as HEIC or AVIF. (#92, #96)
- **Fixed:** Passkey sign-in through 1Password in Chrome and Arc on macOS failed with "clientExtensionResults must be an object". (#106)
- **Fixed:** Going back to a room from a thread didn't open it at its latest message. (#102, #113)

## Week of 2026-10-12

- **New feature:** Rooms, threads and messages have their own links: the address bar shows where you are, so you can bookmark, share or reload them. A message's ⋯ menu has Copy link. (#86)
- **New feature:** On a phone, the back arrow in a room's header counts your unread messages elsewhere, in orange with an @ when you're mentioned. (#84)
- **Changed:** On a phone, the rooms list is a step in browser history, so Back closes it and returns you to what you were reading. (#85)
- **Improved:** Thread cards in a room show the summary and latest reply, as the sidebar does, and when the thread was last replied to. (#87)
- **Improved:** When two people share a display name, mentions of either one show the user ID too. (#82)
- **Fixed:** A guest who signed up for an account appeared twice in a room's member list. (#81)

## Week of 2026-10-05

- **New feature:** Push notifications when Apron is closed, for signed-in accounts on servers that offer them. On iPhone and iPad, add Apron to the Home Screen first. (#48, #57, #61)
- **New feature:** Status: Online, Do not disturb or Invisible, shown as a dot on avatars in the member list. Do not disturb silences notifications, and others see you as idle after five minutes away. (#48, #52, #68)
- **New feature:** Pause notifications for an hour, 8 hours, until tomorrow morning or until you resume, on all your devices. (#48)
- **New feature:** Click an image to open it full screen, and page through the room's images with the arrow keys. (#53)
- **New feature:** Remove or rename a message's attachments while editing it, or rename a file before you send it. (#70)
- **New feature:** The sidebar lists threads you haven't joined under Other threads, and you can join or leave a thread from its row. (#50, #66, #73, #74, #79)
- **Changed:** Apron works only with servers that speak protocol v8. **Requires server protocol v8** (#48)
- **Changed:** One Notifications switch replaces Desktop notifications and also turns on push. **Notify me about** offers mentions, replies to you, private rooms or joined rooms, kept for each account. (#48, #57)
- **Changed:** Starting a thread asks for a title and an optional summary first. (#66, #71, #75)
- **Changed:** On phones and tablets, Enter starts a new line; tap Send to send. (#60)
- **Changed:** Buttons in the window's top corners open and close the rooms list and member list. A room's Edit and Leave moved into the ⋯ menu in its header. (#51, #59, #62)
- **Improved:** With a passkey or email account, reloading shows your rooms and messages from last time straight away. (#56, #67, #72)
- **Improved:** The update notice warns when reloading would lose an unsent message. (#53)

## Week of 2026-09-28

- **New feature:** Sign in or create an account by email, with an emailed code or link. Add an email or a passkey to your account from your profile. (#36)
- **New feature:** Rooms can have a description, and private rooms are marked with a lock. `/topic` now sets the description instead of the title. (#36)
- **New feature:** Role badges beside names, and a member list that counts members and adds or removes them. `/invite @user` and `/kick @user` work too. (#36, #39)
- **New feature:** Click a mention, name or avatar for a profile card that warns when someone else uses the same name. From it you can mention them, copy their ID, or add them to the room. (#47)
- **New feature:** Attach files to a draft by picking, pasting, dropping or recording, with previews, and send them in one message with your text. (#35, #49)
- **Changed:** Room descriptions, private rooms, email sign-in, roles and member changes need a v7 server, and rooms on v6 servers no longer show their intro message. **Requires server protocol v7** (#36)
- **Changed:** Start thread names the thread after the message, pins its gist as the summary, and quotes it in your reply. (#36)
- **Changed:** Passkey sign-in happens in one panel, where you choose Sign in or Create account. Passkeys no longer pop up by themselves after a reconnect: tap Sign in on the banner. (#40, #41, #46)
- **Removed:** The client's banner about how long the demo server keeps messages. A server can say this in its own welcome notice. (#45)
- **Improved:** Images are shrunk before upload, and photos are re-encoded, which removes location and other EXIF data. (#35)
- **Fixed:** Passkey sign-in did nothing with password-manager extensions such as 1Password. (#40, #43)
- **Fixed:** Accounts created with a passkey or invite got a random ID or "Member" instead of the name you chose. (#45)

## Week of 2026-09-21

The Apron web client moved out of shazow/apron into its own repository and deploys to web.apron.chat (#1). It spoke Apron protocol v6 and connected to server.apron.chat or any server you entered, as a guest or with a passkey. It had rooms and threads, Markdown messages with replies, edits, reactions and @mentions, slash commands, uploads, voice clips, live terminal output, typing indicators and a "New" divider at your last read message.

- **New feature:** Preferences: desktop notifications for mentions or every message, a light or dark theme, and your own fonts. (#23)
- **New feature:** Install Apron as an app that opens without a connection. A "New version available" banner offers to reload when an update is deployed. (#7, #8)
- **New feature:** GitHub link previews, which you can leave out before sending or remove from your sent messages. (#11, #13, #19, #20)
- **New feature:** Messages render tables, strikethrough and highlighted code blocks, and bare web addresses become links. (#3, #6, #12, #16)
- **New feature:** The composer completes `:shortcode` emoji and `#` rooms and threads. A + beside Rooms creates a room, and a member list opens from the room header. (#28)
- **New feature:** Sign in with a token from the server, such as a bot token from `/invite-bot`. (#2)
- **New feature:** Back and Forward move between the rooms and threads you've opened, and joined threads show how many new replies they have. (#17, #30)
- **Changed:** React opens the full emoji picker, with your frequent emoji first. Select mode picks anyone's messages, and the server decides which moves it allows. Links in messages open in a new tab. (#6, #10, #14)
- **Improved:** Every message is cleaned of unsafe HTML after it's formatted, as a second guard against injected markup. (#12)
- **Fixed:** Emoji in messages and reactions showed as plain text symbols instead of color emoji. (#21)
