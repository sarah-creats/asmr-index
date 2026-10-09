ASMR Index – Chrome extension
=============================
Full documentation, screenshots and updates: see README.md on the
project's GitHub page.

INSTALL / UPDATE
1. Unzip. You get a folder called "asmr-index".
2. Open chrome://extensions and turn on "Developer mode" (top right).
3. New install: "Load unpacked" → select the "asmr-index" folder.
   Updating: replace the folder's contents with the new files, then
   press the reload arrow on the extension. Your archive and settings
   are kept. Chrome may ask to approve new permissions.
4. Click the extension icon. The first start builds the archive
   automatically – the chips under the search bar show each site's
   progress, and you can browse while it runs.

SEARCHING
- Type in the search bar: your archive filters instantly, and after a
  second (or on Enter) every site is searched live for "asmr + your words".
- Press Enter again, or the button at the end of the results, to search
  every site much deeper for the same words.
- "Refresh" searches every site for all the terms under Settings →
  Archive searches, and runs on its own once a day.
- "Also search on" opens the search on sites without a public API in a
  new tab.
- With "ASMR only" on (default), a video is kept only if "ASMR" is in its
  title or tags. Twitch and Reddit items come from ASMR-only sections.

FILTERS
- Quick views: Everything · New today · Top this week · Top this month ·
  Trending (most views per day since upload) · Long, for sleep (over an
  hour) · Surprise me (a fresh random mix every click).
- Or combine the dropdowns yourself: Sort (newest, most viewed, trending,
  longest, shortest, random) × Uploaded (24 h, 7 days, 30 days, year) ×
  Length (under 10 min … over 1 hour). Your choice is remembered.
  "Top this week" means: most viewed among videos uploaded in the last
  7 days (sites report total views, not views per week).
- The site pills below filter by site; switching a site off in Settings
  hides its videos immediately (and stops its running search). Switch it
  back on and they return – nothing is deleted.

SITES (Settings → Sites, each can be switched off)
Free, no account: Dailymotion · PeerTube · Internet Archive · Odysee ·
  Reddit r/asmr (mostly YouTube links) · Niconico · Rutube · BitChute ·
  Wikimedia Commons
With a free key:
  YouTube – Google Cloud console → enable "YouTube Data API v3" → API key.
  Vimeo   – developer.vimeo.com → create app → personal access token
            with "public" scope.
  Twitch  – dev.twitch.tv/console → register an application (redirect
            http://localhost) → client ID + new client secret.
18+ (turn on "18+ content"; Chrome asks once for access):
  Eporner · RedGifs (short clips with sound) · RedTube · Pornhub ·
  YouPorn · Reddit r/NSFWASMR

ADD YOUR OWN SITES (Settings → Sites → "Add a site")
The wizard adds a site that then works like the built-in ones: its own
switch, chip and filter pill, used by Refresh and by live search.
  1. Pick the kind of site:
     YouTube channel – paste the channel link or @handle. Uses the
       channel's free feed (newest 15 videos), no API key.
     PeerTube server – just the address, e.g. tilvids.com.
     RSS or Atom feed – Vimeo:  vimeo.com/USER/videos/rss
                        Odysee: odysee.com/$/rss/@CHANNEL
     JSON search API – an address with {q} for the search words and
       {page}, {page0} or {offset} for the page.
     Website search page – search on the site, paste the results page
       address and the words you searched; they become {q}.
  2. Press "Try it". Chrome asks once for access to that site.
  3. Check the results: the list and fields are detected for you, with a
     sample value next to each and a live preview. Adjust if needed.
  4. Name it, say whether everything there is ASMR or 18+, and add it.
     It's searched right away.
Edit, "Copy setup" (to share it) and Remove are under each of your sites;
"Import a setup" adds one someone shared. Removing a site also removes
the videos only it found.
Limits: website pages that build their results with JavaScript can't be
read this way (the wizard tells you) – look for a feed or API instead.
Reading a site's pages may be against its rules; that's your call.

PICTURE-IN-PICTURE
- In the player: "Picture-in-picture" (or Alt+P). While it's popped out
  you can close the player and keep browsing; a bar in the bottom-left
  lets you show or stop it.
- Embedded players (YouTube, Dailymotion, …): hover the video and click
  "Pop out" in its corner if the main button can't reach it.
- "Mini window" puts the whole player in a small always-on-top window
  (embedded players restart there).
- Any website: right-click → "Picture-in-picture", or Alt+Shift+P.
  Settings → "Pop-out button on every website" adds the hover button
  everywhere (Chrome asks for access to all sites; switch off to remove).
  Change the shortcut at chrome://extensions/shortcuts.

WATCHING
Click a video to play it. Sage dot = plays here directly as a plain video
file (no web page, scripts or ads from that site). Others use the site's
own player in a sandboxed frame that can't open pop-ups or redirect you.
Ctrl/Cmd-click or middle-click opens a video on its own site instead.
Keys: / search, Esc close, ← → previous/next, Alt+P picture-in-picture.

Videos whose titles say they're "leaked" private videos are always
filtered out.

STORAGE & SPEED
The archive lives in the extension's own database (IndexedDB) and only
new or changed videos are written, so it stays fast with tens of
thousands of videos. Daily refreshes stop early on each site once they
only find videos you already have. Settings → Archive → "Clear archive"
empties it.

TROUBLESHOOTING
A red chip under the search bar means that site failed – hover it for
the reason. Right-click inside the tab → Inspect → Console for details.

LICENSE & CREDITS
ASMR Index is released under the MIT License (see LICENSE).
lib/hls.min.js – hls.js 1.5.20 (github.com/video-dev/hls.js),
  Apache License 2.0, see lib/LICENSE-hls.js.txt.
fonts/fraunces.woff2 – Fraunces by Undercase Type, SIL Open Font
  License 1.1, see fonts/OFL.txt.
Not affiliated with any of the sites it searches.
