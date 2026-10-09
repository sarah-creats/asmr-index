// ===================================================================
// Video sources. Each one turns a search query into a list of records:
//   { platform, id, title, url, thumb, channel, duration (s), published (ISO),
//     views, tags: [..], embed?, adult?, ... }
// play: "direct" = raw file in our own player, "embed" = site's player in a sandboxed frame
// needs: settings keys that must be filled in      adult: 18+ source
// origins: optional host permissions (Chrome asks for them when 18+ is switched on)
// live: false = can't search by text (only used by "Refresh archive")
// once: true = only run once per refresh, not once per search term
// ===================================================================

const isoFromUnix = ts => (ts ? new Date(ts * 1000).toISOString() : null);
const decode = t => new DOMParser().parseFromString(String(t ?? ""), "text/html").documentElement.textContent;
const norm = t => String(t ?? "").normalize("NFKC").toLowerCase();
const clock = t => {                       // "1:02:03" / "12:34" -> seconds
  if (t == null || t === "") return null;
  if (typeof t === "number") return t;
  const parts = String(t).split(":").map(Number);
  return parts.some(isNaN) ? null : parts.reduce((a, b) => a * 60 + b, 0);
};
const isoDur = t => {                      // "PT1H2M3S" -> seconds
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(t || "");
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
};
const hmsDur = t => {                      // "1h2m3s" -> seconds
  const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(t || "");
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
};
const toDate = t => {
  if (!t) return null;
  const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(t) ? t.replace(" ", "T") : t);
  return isNaN(d) ? null : d.toISOString();
};
const tagList = x => {
  if (!x) return [];
  if (typeof x === "string") return x.split(/[,\s]+/).map(norm).filter(Boolean);
  return [].concat(x).map(t => norm(typeof t === "string" ? t : t.tag_name || t.name || t.tag || "")).filter(Boolean);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = (ctx, deep, quick) => (ctx.deep ? deep : quick);

// During a daily refresh, stop paging a site once a whole page of its results is already in the
// archive: the rest is most likely known too. Call at the top of every page loop.
const pageMarks = new WeakMap();
function stalePage(ctx, out) {
  const from = pageMarks.get(out);
  pageMarks.set(out, out.length);
  if (!ctx.known || from === undefined || out.length === from) return false;
  for (let i = from; i < out.length; i++) if (!ctx.known(out[i].id)) return false;
  return true;
}

async function getJSON(url, params = {}, opts = {}) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    [].concat(v).forEach(x => u.searchParams.append(k, x));
  });
  const r = await fetch(u, { credentials: "omit", referrerPolicy: "no-referrer", ...opts });
  if (!r.ok) throw new Error(`${u.host} returned ${r.status}`);
  return r.json();
}

async function postJSON(url, body, opts = {}) {
  const r = await fetch(url, {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...opts,
  });
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}`);
  return r.json();
}

// RedGifs hands out anonymous tokens; cache one for the session.
let redgifsToken = null;
async function redgifsAuth(signal) {
  if (redgifsToken && redgifsToken.exp > Date.now()) return redgifsToken.token;
  const d = await getJSON("https://api.redgifs.com/v2/auth/temporary", {}, { signal });
  redgifsToken = { token: d.token, exp: Date.now() + 12 * 3600e3 };
  return d.token;
}
const redgifsRecord = g => ({
  platform: "RedGifs", id: "rg-" + g.id, rgId: g.id,
  title: g.description?.trim() || (g.tags || []).slice(0, 6).join(", ") || g.id,
  url: `https://www.redgifs.com/watch/${g.id}`, thumb: g.urls?.thumbnail || g.urls?.poster,
  channel: g.userName || "", duration: g.duration, published: isoFromUnix(g.createDate),
  views: g.views, tags: tagList(g.tags), adult: true,
  files: [g.urls?.hd && { url: g.urls.hd, label: "HD", h: g.height || 1080 },
          g.urls?.sd && { url: g.urls.sd, label: "SD", h: 480 }].filter(Boolean),
});
async function redgifsGif(id, signal) {
  const token = await redgifsAuth(signal);
  const d = await getJSON(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, {},
    { headers: { Authorization: "Bearer " + token }, signal });
  return redgifsRecord(d.gif);
}

// Turns a Reddit post into a video record, following links to YouTube, RedGifs and Pornhub.
function redditItem(x) {
  const base = { title: x.title, published: isoFromUnix(x.created_utc), tags: ["asmr"], adult: !!x.over_18, via: "r/" + x.subreddit };
  const preview = x.preview?.images?.[0]?.source?.url || (/^http/.test(x.thumbnail) ? x.thumbnail : null);
  const link = x.url_overridden_by_dest || x.url || "";
  const yt = YT_ID.exec(link) || YT_ID.exec(x.media?.oembed?.html || "");
  if (yt) return { ...base, platform: "YouTube", id: "yt-" + yt[1], weak: true,
    url: `https://www.youtube.com/watch?v=${yt[1]}`, thumb: `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`,
    channel: x.media?.oembed?.author_name || "", duration: null, views: null, embed: ytEmbed(yt[1]) };
  const rg = /redgifs\.com\/(?:watch|ifr|i)\/([a-z]+)/i.exec(link) || /redgifs\.com\/(?:watch|ifr)\/([a-z]+)/i.exec(x.media?.oembed?.html || "");
  if (rg) {
    const id = rg[1].toLowerCase();
    return { ...base, platform: "RedGifs", id: "rg-" + id, rgId: id, weak: true, adult: true,
      url: `https://www.redgifs.com/watch/${id}`, thumb: preview, channel: "", duration: null, views: null };
  }
  const ph = /pornhub\.com\/view_video\.php\?viewkey=(\w+)/i.exec(link);
  if (ph) return { ...base, platform: "Pornhub", id: "ph-" + ph[1], weak: true, adult: true, url: link, thumb: preview,
    channel: "", duration: null, views: null, embed: `https://www.pornhub.com/embed/${ph[1]}` };
  const rv = x.secure_media?.reddit_video;
  if (rv?.hls_url) return { ...base, platform: "Reddit", id: "rd-" + x.id, url: "https://www.reddit.com" + x.permalink,
    thumb: preview, channel: "u/" + x.author, duration: rv.duration, views: x.score, hls: rv.hls_url };
  return null;
}

const YT_ID = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;
const ytEmbed = id => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;

let twitchAuth = null;                    // cached app token

const SOURCES = [
  {
    key: "dailymotion", name: "Dailymotion", play: "embed",
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 3); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://api.dailymotion.com/videos", {
          search: q, limit: 100, page, sort: "recent", family_filter: ctx.adult ? "false" : "true",
          fields: "id,title,url,thumbnail_360_url,owner.screenname,duration,created_time,views_total,tags",
        }, { signal: ctx.signal });
        for (const v of d.list || []) out.push({
          platform: "Dailymotion", id: "dm-" + v.id, title: v.title, url: v.url,
          thumb: v.thumbnail_360_url, channel: v["owner.screenname"], duration: v.duration,
          published: isoFromUnix(v.created_time), views: v.views_total, tags: tagList(v.tags),
          embed: `https://www.dailymotion.com/embed/video/${v.id}?autoplay=1`,
        });
        if (!d.has_more) break;
      }
      return out;
    },
  },
  {
    key: "peertube", name: "PeerTube", play: "direct",
    async fetch(q, ctx) {
      // Sepia Search returns small pages (~10), so keep paging until it runs out.
      const out = [];
      const max = pages(ctx, 1000, 200);
      let start = 0, total = Infinity;
      while (start < Math.min(total, max)) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://sepiasearch.org/api/v1/search/videos", {
          search: q, start, count: 50, nsfw: ctx.adult ? undefined : "false",
        }, { signal: ctx.signal });
        const items = d.data || [];
        total = d.total ?? 0;
        if (!items.length) break;
        start += items.length;
        for (const v of items) {
          if (v.isLive) continue;
          let host = v.account?.host;
          try { host = new URL(v.url).host; } catch {}
          out.push({
            platform: "PeerTube", id: "pt-" + (v.uuid || v.url), title: v.name, url: v.url,
            thumb: v.thumbnailUrl, channel: v.account?.displayName, duration: v.duration,
            published: v.publishedAt, views: v.views, host, uuid: v.uuid, adult: !!v.nsfw,
            tags: tagList(v.tags), embed: v.embedUrl,
          });
        }
      }
      return out;
    },
  },
  {
    key: "archive", name: "Internet Archive", play: "direct",
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 2); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://archive.org/advancedsearch.php", {
          q: `(${q}) AND mediatype:(movies)`,
          "fl[]": ["identifier", "title", "creator", "publicdate", "downloads", "subject"],
          "sort[]": "publicdate desc", rows: 100, page, output: "json",
        }, { signal: ctx.signal });
        const docs = d.response?.docs || [];
        for (const v of docs) out.push({
          platform: "Internet Archive", id: "ia-" + v.identifier,
          title: [].concat(v.title || v.identifier)[0], url: `https://archive.org/details/${v.identifier}`,
          thumb: `https://archive.org/services/img/${encodeURIComponent(v.identifier)}`,
          channel: [].concat(v.creator || "")[0], duration: null,
          published: v.publicdate, views: v.downloads, ia: v.identifier,
          tags: [].concat(v.subject || []).flatMap(s => tagList(String(s).split(";"))),
        });
        if (docs.length < 100) break;
      }
      return out;
    },
  },
  {
    key: "odysee", name: "Odysee", play: "direct",
    async fetch(q, ctx) {
      const out = [];
      for (let p = 0; p < pages(ctx, 10, 3); p++) {
        if (stalePage(ctx, out)) break;
        const items = await getJSON("https://lighthouse.odysee.tv/search", {
          s: q, size: 50, from: p * 50, mediaType: "video", nsfw: ctx.adult ? undefined : "false",
          include: "channel,thumbnail_url,title,duration,release_time,view_cnt,tags",
        }, { signal: ctx.signal });
        if (!Array.isArray(items) || !items.length) break;
        for (const v of items) out.push({
          platform: "Odysee", id: "od-" + v.claimId, title: v.title || v.name,
          url: `https://odysee.com/${v.name}:${v.claimId}`,
          thumb: v.thumbnail_url, channel: v.channel, duration: v.duration,
          published: v.release_time, views: v.view_cnt, tags: tagList(v.tags),
          lbry: { name: v.name, claimId: v.claimId },
          embed: `https://odysee.com/$/embed/${encodeURIComponent(v.name)}/${v.claimId}?autoplay=true`,
        });
        if (items.length < 50) break;
      }
      return out;
    },
  },
  {
    // r/asmr is mostly YouTube links: this gets YouTube ASMR videos without an API key.
    // With 18+ on it also reads r/NSFWASMR (links to RedGifs, Pornhub, ...).
    key: "reddit", name: "Reddit", label: "Reddit r/asmr (incl. YouTube links)", play: "direct", once: true,
    async fetch(q, ctx) {
      const out = [];
      const subs = ["asmr", ...(ctx.adult ? ["NSFWASMR"] : [])];
      for (const sub of subs) {
        pageMarks.delete(out);
        let after;
        for (let p = 0; p < (ctx.archive ? 10 : pages(ctx, 6, 2)); p++) {
          if (stalePage(ctx, out)) break;
          await sleep(p ? 1200 : 300);            // Reddit rate-limits anonymous requests
          const d = ctx.archive
            ? await getJSON(`https://www.reddit.com/r/${sub}/new.json`, { limit: 100, after, raw_json: 1 }, { signal: ctx.signal })
            : await getJSON(`https://www.reddit.com/r/${sub}/search.json`, {
                q: sub === "asmr" ? q : q.replace(/\basmr\b/i, "").trim() || "asmr",
                restrict_sr: 1, sort: "new", limit: 100, after, raw_json: 1, include_over_18: ctx.adult ? "on" : undefined,
              }, { signal: ctx.signal });
          const kids = d.data?.children || [];
          for (const { data: x } of kids) {
            if (x.over_18 && !ctx.adult) continue;
            const item = redditItem(x);
            if (item) out.push(item);
          }
          after = d.data?.after;
          if (!after || !kids.length) break;
        }
      }
      return out;
    },
  },
  {
    key: "niconico", name: "Niconico", play: "embed",
    async fetch(q, ctx) {
      const out = [];
      const qq = q.replace(/\basmr\b/gi, "ASMR");
      for (let p = 0; p < pages(ctx, 10, 3); p++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search", {
          q: qq, targets: "title,tags", _sort: "-startTime", _limit: 100, _offset: p * 100, _context: "asmr-index",
          fields: "contentId,title,viewCounter,lengthSeconds,startTime,thumbnailUrl,tags",
        }, { signal: ctx.signal });
        const items = d.data || [];
        for (const v of items) out.push({
          platform: "Niconico", id: "nn-" + v.contentId, title: v.title,
          url: `https://www.nicovideo.jp/watch/${v.contentId}`, thumb: v.thumbnailUrl, channel: "",
          duration: v.lengthSeconds, published: toDate(v.startTime), views: v.viewCounter,
          tags: tagList(v.tags), embed: `https://embed.nicovideo.jp/watch/${v.contentId}?autoplay=1`,
        });
        if (items.length < 100) break;
      }
      return out;
    },
  },
  {
    key: "rutube", name: "Rutube", play: "embed",
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 3); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://rutube.ru/api/search/video/", { query: q, page }, { signal: ctx.signal });
        for (const v of d.results || []) {
          if (v.is_adult && !ctx.adult) continue;
          out.push({
            platform: "Rutube", id: "ru-" + v.id, title: v.title, url: v.video_url || `https://rutube.ru/video/${v.id}/`,
            thumb: v.thumbnail_url, channel: v.author?.name, duration: v.duration,
            published: toDate(v.publication_ts || v.created_ts), views: v.hits, adult: !!v.is_adult,
            embed: `https://rutube.ru/play/embed/${v.id}`,
          });
        }
        if (!d.has_next) break;
      }
      return out;
    },
  },
  {
    key: "bitchute", name: "BitChute", play: "direct",
    async fetch(q, ctx) {
      const out = [];
      for (let p = 0; p < pages(ctx, 8, 2); p++) {
        if (stalePage(ctx, out)) break;
        const d = await postJSON("https://api.bitchute.com/api/beta/search/videos", {
          offset: p * 50, limit: 50, query: q, sensitivity_id: ctx.adult ? "nsfw" : "normal", sort: "new",
        }, { signal: ctx.signal });
        const items = d.videos || [];
        for (const v of items) out.push({
          platform: "BitChute", id: "bc-" + v.video_id, bcId: v.video_id, title: v.video_name,
          url: `https://www.bitchute.com/video/${v.video_id}/`, thumb: v.thumbnail_url,
          channel: v.channel?.channel_name, duration: clock(v.duration), published: toDate(v.date_published),
          views: v.view_count, embed: `https://www.bitchute.com/embed/${v.video_id}/`,
          adult: !!v.sensitivity_id && v.sensitivity_id !== "normal",
        });
        if (items.length < 50) break;
      }
      return out;
    },
  },
  {
    key: "commons", name: "Wikimedia Commons", play: "direct",
    async fetch(q, ctx) {
      const out = [];
      let offset = 0;
      for (let p = 0; p < pages(ctx, 6, 2); p++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://commons.wikimedia.org/w/api.php", {
          action: "query", format: "json", origin: "*", generator: "search", gsrsearch: `${q} filetype:video`,
          gsrnamespace: 6, gsrlimit: 50, gsroffset: offset, prop: "imageinfo",
          iiprop: "url|size|mediatype|timestamp|user", iiurlwidth: 320,
        }, { signal: ctx.signal });
        for (const pg of Object.values(d.query?.pages || {})) {
          const ii = pg.imageinfo?.[0];
          if (!ii?.url) continue;
          out.push({
            platform: "Wikimedia Commons", id: "wc-" + pg.pageid,
            title: pg.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").replace(/_/g, " "),
            url: ii.descriptionurl, thumb: ii.thumburl, channel: ii.user, duration: ii.duration || null,
            published: ii.timestamp, views: null,
            files: [{ url: ii.url, label: ii.url.split(".").pop(), h: ii.height || 0 }],
          });
        }
        if (!d.continue?.gsroffset) break;
        offset = d.continue.gsroffset;
      }
      return out;
    },
  },
  {
    key: "youtube", name: "YouTube", play: "embed", needs: ["ytKey"],
    async fetch(q, ctx) {
      const out = [];
      let pageToken;
      for (let p = 0; p < pages(ctx, 2, 1); p++) {   // 100 of 10,000 free daily quota units per page
        if (stalePage(ctx, out)) break;
        const s = await getJSON("https://www.googleapis.com/youtube/v3/search", {
          key: ctx.ytKey, q, part: "snippet", type: "video", maxResults: 50, order: "date",
          safeSearch: ctx.adult ? "none" : "strict", pageToken,
        }, { signal: ctx.signal });
        const ids = (s.items || []).map(i => i.id.videoId).filter(Boolean);
        if (!ids.length) break;
        const d = await getJSON("https://www.googleapis.com/youtube/v3/videos", {
          key: ctx.ytKey, id: ids.join(","), part: "snippet,contentDetails,statistics",
        }, { signal: ctx.signal });
        for (const v of d.items || []) out.push({
          platform: "YouTube", id: "yt-" + v.id, title: decode(v.snippet.title),
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumb: v.snippet.thumbnails?.medium?.url, channel: decode(v.snippet.channelTitle),
          duration: isoDur(v.contentDetails?.duration), published: v.snippet.publishedAt,
          views: +v.statistics?.viewCount || 0, tags: tagList(v.snippet.tags), embed: ytEmbed(v.id),
        });
        pageToken = s.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
  },
  {
    key: "vimeo", name: "Vimeo", play: "embed", needs: ["vimeoToken"],
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 5, 2); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://api.vimeo.com/videos",
          { query: q, per_page: 100, page, ...(ctx.adult ? {} : { filter: "content_rating", filter_content_rating: "safe" }) },
          { headers: { Authorization: "bearer " + ctx.vimeoToken }, signal: ctx.signal });
        const items = d.data || [];
        for (const v of items) {
          const sizes = v.pictures?.sizes || [];
          const id = v.uri.split("/").pop();
          out.push({
            platform: "Vimeo", id: "vm-" + id, title: v.name, url: v.link,
            thumb: sizes.length ? sizes[Math.min(3, sizes.length - 1)].link : null,
            channel: v.user?.name, duration: v.duration, published: v.release_time,
            views: v.stats?.plays, tags: tagList(v.tags),
            embed: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`,
          });
        }
        if (items.length < 100) break;
      }
      return out;
    },
  },
  {
    // Twitch can't search videos by text, so this pulls past broadcasts from the ASMR category.
    key: "twitch", name: "Twitch", label: "Twitch (ASMR category VODs)", play: "embed",
    needs: ["twitchId", "twitchSecret"], live: false, once: true,
    async fetch(q, ctx) {
      if (!twitchAuth || twitchAuth.id !== ctx.twitchId || twitchAuth.exp < Date.now()) {
        const r = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST", credentials: "omit", signal: ctx.signal,
          body: new URLSearchParams({ client_id: ctx.twitchId, client_secret: ctx.twitchSecret, grant_type: "client_credentials" }),
        });
        if (!r.ok) throw new Error(`login failed (${r.status}), check client ID/secret`);
        const t = await r.json();
        twitchAuth = { id: ctx.twitchId, token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
      }
      const headers = { "Client-Id": ctx.twitchId, Authorization: "Bearer " + twitchAuth.token };
      const g = await getJSON("https://api.twitch.tv/helix/games", { name: "ASMR" }, { headers, signal: ctx.signal });
      const gameId = g.data?.[0]?.id;
      if (!gameId) throw new Error("ASMR category not found");
      const out = [];
      let after;
      for (let p = 0; p < 10; p++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://api.twitch.tv/helix/videos",
          { game_id: gameId, first: 100, sort: "time", after }, { headers, signal: ctx.signal });
        for (const v of d.data || []) out.push({
          platform: "Twitch", id: "tw-" + v.id, title: v.title, url: v.url,
          thumb: v.thumbnail_url ? v.thumbnail_url.replace("%{width}", "320").replace("%{height}", "180") : null,
          channel: v.user_name, duration: hmsDur(v.duration), published: v.created_at,
          views: v.view_count, tags: ["asmr"],
          embed: `https://player.twitch.tv/?video=${v.id}&parent=${location.hostname}&autoplay=true`,
        });
        after = d.pagination?.cursor;
        if (!after) break;
      }
      return out;
    },
  },

  // ----- 18+ sources (only used when "Include 18+ content" is on) -----
  {
    key: "eporner", name: "Eporner", play: "embed", adult: true, origins: ["https://www.eporner.com/*"],
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 3); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://www.eporner.com/api/v2/video/search/", {
          query: q, per_page: 100, page, thumbsize: "big", order: "latest", format: "json",
        }, { signal: ctx.signal });
        for (const v of d.videos || []) out.push({
          platform: "Eporner", id: "ep-" + v.id, title: v.title, url: v.url,
          thumb: v.default_thumb?.src, channel: "", duration: v.length_sec,
          published: v.added ? toDate(v.added + "Z") || toDate(v.added) : null,
          views: v.views, embed: v.embed, adult: true, tags: tagList(v.keywords),
        });
        if (page >= (d.total_pages || 1)) break;
      }
      return out;
    },
  },
  {
    // Short clips, many with sound; plays as a direct file.
    key: "redgifs", name: "RedGifs", play: "direct", adult: true, origins: ["https://api.redgifs.com/*"],
    async fetch(q, ctx) {
      const token = await redgifsAuth(ctx.signal);
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 3); page++) {
        if (stalePage(ctx, out)) break;
        const d = await getJSON("https://api.redgifs.com/v2/gifs/search", {
          search_text: q, order: "new", count: 80, page,
        }, { headers: { Authorization: "Bearer " + token }, signal: ctx.signal });
        for (const g of d.gifs || []) if (g.hasAudio !== false) out.push(redgifsRecord(g));
        if (page >= (d.pages || 1)) break;
      }
      return out;
    },
  },
  ...[
    // These three share the same "webmasters" API format.
    { key: "redtube", name: "RedTube", prefix: "rt", origins: ["https://api.redtube.com/*", "https://embed.redtube.com/*"],
      url: (q, page) => ["https://api.redtube.com/", { data: "redtube.Videos.searchVideos", output: "json", search: q, thumbsize: "big", page }],
      embed: id => `https://embed.redtube.com/?id=${id}` },
    { key: "pornhub", name: "Pornhub", prefix: "ph", origins: ["https://www.pornhub.com/*"],
      url: (q, page) => ["https://www.pornhub.com/webmasters/search", { search: q, page, thumbsize: "large" }],
      embed: id => `https://www.pornhub.com/embed/${id}` },
    { key: "youporn", name: "YouPorn", prefix: "yp", origins: ["https://www.youporn.com/*"],
      url: (q, page) => ["https://www.youporn.com/api/webmasters/search/", { search: q, page, thumbsize: "large" }],
      embed: id => `https://www.youporn.com/embed/${id}` },
  ].map(s => ({
    key: s.key, name: s.name, play: "embed", adult: true, origins: s.origins,
    async fetch(q, ctx) {
      const out = [];
      for (let page = 1; page <= pages(ctx, 10, 3); page++) {
        if (stalePage(ctx, out)) break;
        const [url, params] = s.url(q, page);
        const d = await getJSON(url, params, { signal: ctx.signal });
        const items = (d.videos || d.video || []).map(x => x.video || x);
        for (const v of items) {
          if (!v.video_id) continue;
          out.push({
            platform: s.name, id: s.prefix + "-" + v.video_id, title: v.title, url: v.url,
            thumb: v.default_thumb || v.thumb, channel: "", duration: clock(v.duration),
            published: toDate(v.publish_date), views: +v.views || 0, tags: tagList(v.tags),
            embed: v.embed_url || s.embed(v.video_id), adult: true,
          });
        }
        if (items.length < 10) break;
      }
      return out;
    },
  })),
];

// Sites without a usable public API: offered as "search there in a new tab" links.
const ELSEWHERE = [
  { name: "YouTube", url: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { name: "Bilibili", url: q => `https://search.bilibili.com/video?keyword=${encodeURIComponent(q)}` },
  { name: "Rumble", url: q => `https://rumble.com/search/video?q=${encodeURIComponent(q)}` },
  { name: "TikTok", url: q => `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}` },
  { name: "Twitch", url: q => `https://www.twitch.tv/search?term=${encodeURIComponent(q)}` },
  { name: "Kick", url: q => `https://kick.com/search?query=${encodeURIComponent(q)}` },
  { name: "VK Video", url: q => `https://vkvideo.ru/?q=${encodeURIComponent(q)}` },
  { name: "SoundCloud", url: q => `https://soundcloud.com/search?q=${encodeURIComponent(q)}` },
  { name: "xHamster", adult: true, url: q => `https://xhamster.com/search/${encodeURIComponent(q)}` },
  { name: "SpankBang", adult: true, url: q => `https://spankbang.com/s/${encodeURIComponent(q).replace(/%20/g, "+")}/` },
  { name: "XVideos", adult: true, url: q => `https://www.xvideos.com/?k=${encodeURIComponent(q)}` },
  { name: "XNXX", adult: true, url: q => `https://www.xnxx.com/search/${encodeURIComponent(q)}` },
  { name: "Erome", adult: true, url: q => `https://www.erome.com/search?q=${encodeURIComponent(q)}` },
  { name: "Motherless", adult: true, url: q => `https://motherless.com/term/videos/${encodeURIComponent(q)}` },
  { name: "Tube8", adult: true, url: q => `https://www.tube8.com/searches.html?q=${encodeURIComponent(q)}` },
  { name: "ThisVid", adult: true, url: q => `https://thisvid.com/search/?q=${encodeURIComponent(q)}` },
];
