# Changelog

## 1.0.0 – 2026-10-08

First public release. Everything below, packaged for GitHub, plus:

- Bundled license texts for hls.js (Apache 2.0) and Fraunces (SIL OFL 1.1).
- In-extension README no longer tied to a version.

## 0.7 – 2026-10-07

- **Add a site wizard:** YouTube channels (via their public feed), PeerTube servers, RSS/Atom feeds,
  JSON search APIs and website search pages become sources that work like the built-in ones.
- Automatic detection of the result list and fields, with sample values and a live preview.
- Copy and import site setups as text; removing a site also removes the videos only it found.

## 0.6 – 2026-10-07

- Quick views: New today, Top this week, Top this month, Trending, Long for sleep, Surprise me.
- Sort, upload-date and length filters, remembered between visits.
- Switching a site off hides its videos immediately and stops its running search.
- Archive moved to IndexedDB with incremental saves; cached filtering, partial grid updates and
  infinite scroll; sites search their terms independently; daily refreshes stop early on known pages.
  With 30,000 videos: opening is about twice as fast, typing redraws 2–3× faster, and saves no longer freeze the page.

## 0.5 – 2026-10-07

- New design: settings drawer, per-site progress chips, platform pills, larger player.
- Picture-in-picture: in the player, on embedded players (hover *Pop out*), a mini window, and on any
  website via right-click or Alt+Shift+P.
- New sites: Rutube, BitChute, Wikimedia Commons, RedGifs, Reddit r/NSFWASMR.

## 0.4 – 2026-10-07

- ASMR-only filter (title or tags).
- Live search across all sites while typing; "search deeper" for more pages.
- New sites: Niconico, Reddit r/asmr, Twitch (ASMR category), YouPorn.
- "Also search on" links for sites without a public API.

## 0.3 – 2026-10-07

- New sites: Internet Archive, Odysee, YouTube (API key), Eporner, RedTube, Pornhub.
- Optional 18+ section with age confirmation; filter for "leaked" private videos.
- Fixed PeerTube stopping after its first small page of results.

## 0.2 – 2026-10-07

- Built-in player: direct video files for PeerTube, sandboxed official players elsewhere.

## 0.1 – 2026-10-07

- Chrome extension that searches Dailymotion, PeerTube and Vimeo, with search, platform filter and sorting.
