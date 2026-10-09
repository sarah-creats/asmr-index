# Contributing to ASMR Index

Thanks for helping keep this working. The original author has finished the project, so fixes from anyone
are what keep it alive – especially updates to site adapters when a site changes its API.

## Ground rules

- **No build step, no dependencies.** Plain JavaScript, HTML and CSS that Chrome loads as-is. Please keep it
  that way so anyone can read exactly what runs.
- **Official or public APIs first.** Prefer documented APIs and feeds over reading web pages.
- **Privacy stays local.** No servers, analytics or remote code. Requests go straight from the browser to
  the sites, without cookies.
- **Safety defaults stay on.** 18+ sources stay off by default behind the age confirmation, and the filter
  that drops "leaked" private videos stays.

## Running it

1. Clone the repository.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick the
   `extension` folder.
3. After changing files, click the reload arrow on the extension and reopen its tab.
4. Debug with right-click → **Inspect** in the ASMR Index tab. The background service worker has its own
   *Inspect views* link on `chrome://extensions`.

## How the code is organised

| File | What it does |
|---|---|
| `manifest.json` | Permissions, the content scripts for the PiP button, the keyboard shortcut |
| `background.js` | Opens the app tab, right-click menu and shortcut for picture-in-picture, registers optional PiP scripts |
| `app.html`, `app.css` | The page and its styles. Design tokens are CSS variables on `:root` |
| `sources.js` | **Every built-in site**: one adapter per site in the `SOURCES` array, plus shared helpers. `ELSEWHERE` lists the "Also search on" links |
| `custom.js` | Turns a site config from the wizard into a source (`customSource`) and auto-detects JSON fields and HTML result cards |
| `wizard.js` | The four-step *Add a site* dialog |
| `app.js` | Everything else: settings, searching, merging and saving results, filtering, the grid, the player, picture-in-picture |
| `store.js` | The archive in IndexedDB (`DB.getAll`, `DB.put`, `DB.delete`, `DB.clear`) |
| `pip-core.js`, `pip.js` | Picture-in-picture toggle and the *Pop out* hover button (shared with embedded players and other sites) |
| `lib/hls.min.js` | hls.js, loaded on demand for streamed videos |

### How a search flows

1. `runSearch()` in `app.js` starts every active source in parallel. Each source works through the search
   terms on its own and can be stopped through its `AbortController` (that's how switching a site off
   stops it immediately).
2. A source's `fetch(q, ctx)` returns plain video records (format below).
3. `accept()` drops untitled, "leaked" and – with *ASMR only* on – non-ASMR records. `merge()` adds new ones
   to `all` / `byId`, records which source found them in `src`, and marks them dirty.
4. `flushSave()` writes only dirty records to IndexedDB.
5. `compute()` filters and sorts into `computed` – cached until something it depends on changes
   (`dataVersion`, search words, filters, enabled sites). `paintGrid()` only touches the DOM when the
   visible cards change and appends when you scroll.

### The video record

```js
{
  platform: "PeerTube",          // display name, also used to pick the player
  id: "pt-<uuid>",               // unique, prefixed per site
  title, url,                    // required
  thumb, channel,                // optional strings
  duration: 1234,                // seconds
  published: "2026-10-01T…Z",    // ISO date
  views: 5678,
  tags: ["asmr", "whisper"],     // lower-case
  adult: true,                   // optional
  src: ["peertube"],             // source keys that found it (set by merge)
  // optional playback hints:
  files: [{ url, label, h }],    // direct video files
  hls: "…m3u8",                  // a stream
  embed: "https://…",            // embed player (built-in platforms build it in EMBED instead)
  host, uuid, lbry, ia, bcId, rgId // site-specific ids used by the players
}
```

`slim()` removes empty fields before saving to keep the archive small.

## Fixing or adding a site

A source is an object in `SOURCES` (`sources.js`):

```js
{
  key: "examplesite",            // stable id, stored in settings and in each record's src
  name: "Example Site",          // shown in the UI; must match the records' platform
  play: "embed",                 // "direct" if records carry files/hls, otherwise "embed"
  needs: ["exampleKey"],         // optional: settings that must be filled in (add a field in KEY_FIELDS)
  adult: false,                  // true = only with 18+ on; then also set origins
  origins: ["https://api.example.com/*"], // optional permissions, requested when switched on
  once: false,                   // true = run once per refresh instead of once per search term
  live: true,                    // false = skip in live searches (e.g. can't search by text)
  async fetch(q, ctx) {
    const out = [];
    for (let page = 1; page <= pages(ctx, 10, 3); page++) {   // 10 pages deep, 3 for a quick search
      if (stalePage(ctx, out)) break;                         // stop when a page held only known videos
      const d = await getJSON("https://api.example.com/search", { q, page }, { signal: ctx.signal });
      for (const v of d.items || []) out.push({
        platform: "Example Site", id: "ex-" + v.id, title: v.title, url: v.link,
        thumb: v.thumbnail, duration: v.seconds, published: toDate(v.date), views: v.views,
        tags: tagList(v.tags),
      });
      if (!d.has_more) break;
    }
    return out;
  },
}
```

Then, for a new site:

- `manifest.json`: add the API host to `host_permissions` (or to `optional_host_permissions` plus `origins`
  for adult sites). If its player should get the *Pop out* button, add it to `content_scripts.matches`.
- `app.js`: add a description to `SITE_INFO`, the platform name to `PLATFORM_SRC`, and an embed URL builder to
  `EMBED` if it uses an embedded player. For direct files that need an extra lookup, add a `play…()`
  function and a branch in `openPlayer()`.
- Use the helpers: `getJSON`, `postJSON`, `pages`, `stalePage`, `toDate`, `isoFromUnix`, `clock`, `isoDur`,
  `tagList`.
- If the site can't be searched through an API, consider adding it to `ELSEWHERE` instead, or describing it
  as a shareable wizard setup.

### What was verified against live sites

During development these adapters were checked against real responses: Dailymotion, PeerTube (Sepia
Search), Internet Archive, Odysee search and Eporner. The others – Niconico, Reddit, Rutube, BitChute,
Wikimedia Commons, YouTube, Vimeo, Twitch, RedGifs, RedTube, Pornhub, YouPorn – and the direct-file lookups
for Odysee and BitChute were written from their documented formats and tested against simulated responses.
If one of them fails for you, the chip's tooltip shows the error; that's the best place to start.

## Testing your change

There's no test suite. Before opening a pull request, please:

- run `node --check` on every changed `.js` file (CI does this too, and validates `manifest.json`),
- load the extension and run a **Refresh** – every chip should end green, grey ("needs key") or show a
  meaningful error,
- search for something, switch a site off and on, open a few videos from different sites,
- if you touched the wizard, add one site of each kind.

## Making a release

1. Raise `version` in `extension/manifest.json` (e.g. `1.0.1`).
2. Add a section for it at the top of `CHANGELOG.md`.
3. On GitHub, **Releases → Draft a new release**, create the tag `v1.0.1`, and publish.
   The *Release* workflow builds `asmr-index-1.0.1.zip` and attaches it to the release.
