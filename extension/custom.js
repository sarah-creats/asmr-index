// ===================================================================
// Your own sites, added with the "Add a site" wizard.
// A site is a small config object; customSource(site) turns it into a source
// that works exactly like the built-in ones.
//
//   { id, kind: "feed" | "peertube" | "json" | "html", name, url,
//     headers, maxPages, list, fields: { title, url, thumb, duration, views,
//     published, channel, tags, id, video, embed }, embedTemplate, idPattern,
//     allAsmr, adult }
//
// url placeholders: {q} search words, {page} 1,2,3…, {page0} 0,1,2…, {offset} 0,20,40…
// json fields are dot paths ("data.items", "thumbnails.0.url");
// html fields are "css selector@attribute" ("a@href", "img@src", ".title" for text).
// ===================================================================

const CUSTOM_KINDS = {
  youtube: "YouTube channel", peertube: "PeerTube server", feed: "RSS/Atom feed",
  json: "JSON search API", html: "Website search page",
};

// ---------- value helpers ----------
const getPath = (obj, path) => {
  if (!path) return undefined;
  let cur = obj;
  for (const part of String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
};
const absUrl = (u, base) => {
  if (typeof u !== "string" || !u.trim()) return null;
  try {
    const x = new URL(u.trim().split(/\s+/)[0], base);   // srcset-style "url 2x" → url
    return /^https?:$/.test(x.protocol) ? x.href : null;
  } catch { return null; }
};
const scalar = x => (x == null ? null : typeof x === "object"
  ? (x.name ?? x.displayName ?? x.title ?? x.text ?? x.label ?? x.url ?? x.href ?? null) : x);

function parseDuration(x) {
  x = scalar(x);
  if (x == null || x === "") return null;
  if (typeof x === "number") return x > 1e6 ? Math.round(x / 1000) : Math.round(x);
  const s = String(x).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseDuration(+s);
  if (/^P/i.test(s)) return isoDur(s);
  const c = /(\d+:)?\d{1,2}:\d\d/.exec(s);
  if (c) return clock(c[0]);
  const h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m(?!s)/i.exec(s), sec = /(\d+)\s*s/i.exec(s);
  return h || m || sec ? (+h?.[1] || 0) * 3600 + (+m?.[1] || 0) * 60 + (+sec?.[1] || 0) : null;
}
function parseCount(x) {
  x = scalar(x);
  if (x == null || x === "") return null;
  if (typeof x === "number") return x;
  const m = /(\d[\d.,]*)\s*([kmb])?/i.exec(String(x));
  if (!m) return null;
  const n = m[2] ? parseFloat(m[1].replace(",", ".")) : parseFloat(m[1].replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase()] || 1;
  return isNaN(n) ? null : Math.round(n * mult);
}
const REL_UNITS = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000, yr: 31536000 };
function parseDate(x) {
  x = scalar(x);
  if (x == null || x === "") return null;
  if (typeof x === "number" || /^\d{9,13}$/.test(String(x).trim())) {
    const n = +x;
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const s = String(x).trim();
  const rel = /(\d+|an?|one)\s*(second|sec|minute|min|hour|hr|day|week|month|year|yr)s?\s*ago/i.exec(s);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? +rel[1] : 1;
    return new Date(Date.now() - n * REL_UNITS[rel[2].toLowerCase()] * 1000).toISOString();
  }
  if (/^(today|just now)/i.test(s)) return new Date().toISOString();
  if (/^yesterday/i.test(s)) return new Date(Date.now() - 864e5).toISOString();
  const d = Date.parse(s);
  return isNaN(d) ? null : new Date(d).toISOString();
}
const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const hasQuery = site => site.kind === "peertube" || /\{q\}/.test(site.url || "");
const hasPaging = site => site.kind === "peertube" || /\{(page|page0|offset)\}/.test(site.url || "");
const PER_PAGE_GUESS = 20;
function fillTemplate(tpl, q, p) {
  return tpl.replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{page\}/g, p + 1)
    .replace(/\{page0\}/g, p).replace(/\{offset\}/g, p * PER_PAGE_GUESS);
}
function parseHeaders(text) {
  const h = {};
  for (const line of String(text || "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return h;
}
function siteOrigin(site) {
  try {
    if (site.kind === "peertube") return `https://${new URL("https://" + site.url.replace(/^https?:\/\//, "")).host}/*`;
    const u = new URL(fillTemplate(site.url, "asmr", 0));
    return `${u.protocol}//${u.host}/*`;
  } catch { return null; }
}

// ---------- reading one page ----------
async function fetchText(url, site, signal) {
  const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", headers: parseHeaders(site.headers), signal });
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}`);
  return { text: await r.text(), url: r.url || url };
}

// Returns the parsed response (kept by the wizard for live re-mapping) and the records.
async function customPage(site, q, p, signal) {
  if (site.kind === "peertube") {
    const host = site.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const raw = await getJSON(`https://${host}/api/v1/search/videos`,
      { search: q, start: p * 25, count: 25, searchTarget: "local", nsfw: site.adult ? "both" : "false" }, { signal });
    return { raw, base: `https://${host}/`, records: peertubeRecords(raw, host) };
  }
  const { text, url } = await fetchText(fillTemplate(site.url, q, p), site, signal);
  let raw;
  if (site.kind === "json") {
    try { raw = JSON.parse(text); } catch { throw new Error("the answer isn't JSON"); }
  } else if (site.kind === "feed" || site.kind === "youtube") {
    raw = new DOMParser().parseFromString(text, "application/xml");
    if (raw.getElementsByTagName("parsererror").length) throw new Error("this isn't an RSS or Atom feed");
  } else {
    raw = new DOMParser().parseFromString(text, "text/html");
  }
  return { raw, base: url, records: extractRecords(site, raw, url) };
}

function extractRecords(site, raw, base) {
  let rows;
  if (site.kind === "json") rows = jsonRows(site, raw);
  else if (site.kind === "html") rows = htmlRows(site, raw);
  else return feedRecords(site, raw, base);
  return rows.map(r => customRecord(site, r, base)).filter(Boolean);
}

function jsonRows(site, json) {
  const items = site.list ? getPath(json, site.list) : json;
  if (!Array.isArray(items)) return [];
  const f = site.fields || {};
  return items.filter(x => x && typeof x === "object").map(it => {
    const row = {};
    for (const [k, path] of Object.entries(f)) if (path) row[k] = getPath(it, path);
    return row;
  });
}

// "selector@attr": text of the element if no attr; "@attr" reads the item itself.
function pickHTML(el, spec) {
  if (!spec) return null;
  const at = spec.lastIndexOf("@");
  const sel = (at >= 0 ? spec.slice(0, at) : spec).trim();
  const attr = at >= 0 ? spec.slice(at + 1).trim() : "";
  let t;
  try { t = sel ? el.querySelector(sel) : el; } catch { return null; }
  if (!t) return null;
  if (!attr) return t.textContent.replace(/\s+/g, " ").trim();
  if (attr === "src") {                       // lazy-loaded images keep the real address elsewhere
    for (const a of ["data-src", "data-original", "data-lazy-src", "data-thumb", "data-poster", "data-srcset", "srcset", "src", "poster"]) {
      const v = t.getAttribute(a);
      if (v && !v.startsWith("data:")) return v.split(",")[0];
    }
    return null;
  }
  return t.getAttribute(attr);
}
function htmlRows(site, doc) {
  if (!site.list) return [];
  let items;
  try { items = doc.querySelectorAll(site.list); } catch { return []; }
  const f = site.fields || {};
  return [...items].map(it => {
    const row = {};
    for (const [k, spec] of Object.entries(f)) if (spec) row[k] = pickHTML(it, spec);
    return row;
  });
}

function customRecord(site, r, base) {
  const url = absUrl(scalar(r.url), base);
  const title = scalar(r.title);
  if (!url || !title) return null;
  const rawId = scalar(r.id);
  const rec = {
    platform: site.name, id: `c-${site.id}-${rawId != null && rawId !== "" ? String(rawId).slice(0, 80) : hashStr(url)}`,
    title: String(title).replace(/\s+/g, " ").trim().slice(0, 300), url,
    thumb: absUrl(scalar(r.thumb), base), channel: scalar(r.channel) ? String(scalar(r.channel)).trim().slice(0, 100) : null,
    duration: parseDuration(r.duration), views: parseCount(r.views), published: parseDate(r.published),
    tags: Array.isArray(r.tags) ? tagList(r.tags.map(scalar)) : tagList(r.tags),
    adult: !!site.adult,
  };
  if (site.allAsmr) rec.tags = [...(rec.tags || []), "asmr"];
  const video = absUrl(scalar(r.video), base);
  if (video) rec.files = [{ url: video, label: (video.match(/\.(\w{3,4})(\?|$)/) || [])[1] || "file", h: 0 }];
  const embed = absUrl(scalar(r.embed), base) || embedFromTemplate(site, url, rawId);
  if (embed) rec.embed = embed;
  return rec;
}
function embedFromTemplate(site, url, rawId) {
  if (!site.embedTemplate) return null;
  let id = rawId;
  if (site.idPattern) {
    try { id = new RegExp(site.idPattern).exec(url)?.[1] ?? null; } catch { id = null; }
  }
  return id != null ? absUrl(site.embedTemplate.replace(/\{id\}/g, encodeURIComponent(id)), url) : null;
}

// RSS / Atom / Media RSS, including YouTube channel feeds (which get proper YouTube records).
function feedRecords(site, doc, base) {
  const one = (el, name) => el.getElementsByTagName(name)[0];
  const feedTitle = one(doc, "title")?.textContent?.trim();
  const out = [];
  for (const it of doc.querySelectorAll("item, entry")) {
    const title = one(it, "title")?.textContent?.trim();
    const linkEl = [...it.getElementsByTagName("link")].find(l => !l.getAttribute("rel") || l.getAttribute("rel") === "alternate") || one(it, "link");
    const link = linkEl?.getAttribute("href") || linkEl?.textContent?.trim();
    const published = one(it, "published")?.textContent || one(it, "pubDate")?.textContent ||
      one(it, "dc:date")?.textContent || one(it, "updated")?.textContent;
    const author = one(it, "author");
    const channel = author?.getElementsByTagName("name")[0]?.textContent || one(it, "dc:creator")?.textContent ||
      (author?.textContent || "").trim() || feedTitle;
    const ytId = one(it, "yt:videoId")?.textContent?.trim();
    const views = one(it, "media:statistics")?.getAttribute("views");
    const tags = [...it.getElementsByTagName("category")].map(c => c.getAttribute("term") || c.textContent)
      .concat((one(it, "media:keywords")?.textContent || "").split(","));
    if (ytId) {
      const rec = {
        platform: "YouTube", id: "yt-" + ytId, title, url: `https://www.youtube.com/watch?v=${ytId}`,
        thumb: `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`, channel, published: parseDate(published),
        views: parseCount(views), tags: tagList(tags), adult: !!site.adult,
      };
      if (site.allAsmr) rec.tags = [...rec.tags, "asmr"];
      if (title) out.push(rec);
      continue;
    }
    const media = [...it.getElementsByTagName("media:content"), ...it.getElementsByTagName("enclosure")]
      .find(m => /^video\//.test(m.getAttribute("type") || "") || m.getAttribute("medium") === "video" ||
        /\.(mp4|webm|m3u8|mov)(\?|$)/i.test(m.getAttribute("url") || ""));
    const desc = one(it, "description")?.textContent || one(it, "content")?.textContent || one(it, "summary")?.textContent || "";
    const imgInDesc = /<img[^>]+src=["']([^"']+)/i.exec(desc)?.[1];
    const thumb = one(it, "media:thumbnail")?.getAttribute("url") || one(it, "itunes:image")?.getAttribute("href") ||
      [...it.getElementsByTagName("enclosure")].find(e => /^image\//.test(e.getAttribute("type") || ""))?.getAttribute("url") || imgInDesc;
    const rec = customRecord(site, {
      title, url: link, thumb, published, channel, tags,
      id: one(it, "guid")?.textContent?.trim() || one(it, "id")?.textContent?.trim(),
      duration: one(it, "itunes:duration")?.textContent || media?.getAttribute("duration"),
      video: media?.getAttribute("url"),
    }, base);
    if (rec) out.push(rec);
  }
  return out;
}

function peertubeRecords(raw, host) {
  return (raw.data || []).filter(v => !v.isLive).map(v => ({
    platform: "PeerTube", id: "pt-" + v.uuid, title: v.name, url: v.url || `https://${host}/w/${v.shortUUID || v.uuid}`,
    thumb: absUrl(v.thumbnailUrl || v.thumbnailPath, `https://${host}/`), channel: v.account?.displayName,
    duration: v.duration, published: v.publishedAt, views: v.views, host, uuid: v.uuid, adult: !!v.nsfw,
    tags: tagList(v.tags),
  }));
}

// ---------- the source ----------
function customSource(site) {
  const direct = site.kind === "peertube" || !!site.fields?.video ||
    ((site.kind === "feed" || site.kind === "youtube") && !/youtube\.com/.test(site.url));
  return {
    key: "c-" + site.id, name: site.name, custom: site, adult: !!site.adult,
    origins: [siteOrigin(site)].filter(Boolean),
    once: !hasQuery(site),            // feeds and lists without {q} are read once per refresh
    play: direct ? "direct" : "embed",
    async fetch(q, ctx) {
      // Sources that can't search get filtered here by the typed words.
      const words = hasQuery(site) || ctx.archive ? [] : norm(q).split(/\s+/).filter(w => w && w !== "asmr");
      const out = [];
      let lastFirst = null;
      const maxP = hasPaging(site) ? pages(ctx, Math.max(1, site.maxPages || 5), 1) : 1;
      for (let p = 0; p < maxP; p++) {
        if (stalePage(ctx, out)) break;
        const { records } = await customPage(site, q, p, ctx.signal);
        if (!records.length || records[0].url === lastFirst) break;      // empty, or the site ignores {page}
        lastFirst = records[0].url;
        for (const r of records) {
          if (words.length && !words.every(w => norm(`${r.title} ${(r.tags || []).join(" ")}`).includes(w))) continue;
          out.push(r);
        }
      }
      return out;
    },
  };
}

// ---------- automatic detection (used by the wizard) ----------
const looksUrl = v => typeof v === "string" && (/^https?:\/\//.test(v) || /^\/[^/]/.test(v) || /^\/\//.test(v));
const looksImage = v => looksUrl(v) && /\.(jpe?g|png|webp|gif|avif)(\?|$)|\/(thumb|image|img|poster|preview|vi\/)/i.test(v);
const looksVideoFile = v => looksUrl(v) && /\.(mp4|webm|m3u8|mov|m4v)(\?|$)/i.test(v);

// JSON: find the biggest list of objects, then guess each field from key names and values.
function autoJSON(json) {
  const lists = [];
  (function walk(o, path, depth) {
    if (depth > 6 || o == null || typeof o !== "object") return;
    if (Array.isArray(o)) {
      const objs = o.filter(x => x && typeof x === "object" && !Array.isArray(x));
      if (objs.length && objs.length >= o.length / 2) lists.push({ path, n: objs.length, sample: objs[0] });
      o.slice(0, 2).forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i), depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  })(json, "", 0);
  if (!lists.length) return null;
  const score = l => l.n * (1 + Object.values(l.sample).filter(v => typeof v === "string").length) *
    (/\.\d+(\.|$)/.test(l.path) ? 0.2 : 1);
  const best = lists.sort((a, b) => score(b) - score(a))[0];

  const flat = [];
  (function walk(o, path, depth) {
    if (depth > 3 || o == null) return;
    if (Array.isArray(o)) {
      if (o.length && o.every(x => typeof x !== "object")) flat.push({ path, value: o });
      else o.slice(0, 1).forEach((x, i) => walk(x, `${path}.${i}`, depth + 1));
      return;
    }
    if (typeof o === "object") { for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, depth + 1); return; }
    flat.push({ path, value: o });
  })(best.sample, "", 0);

  const last = p => p.split(".").filter(x => !/^\d+$/.test(x)).pop() || "";
  // keyRe is tried on the last key, then on the whole path ("thumbnail.url" is a thumbnail)
  const find = (keyRe, test, avoid) => flat
    .filter(c => (keyRe.test(last(c.path)) || keyRe.test(c.path.replace(/\.\d+/g, ""))) && (!avoid || !avoid.test(c.path)) && test(c.value))
    .sort((a, b) => a.path.length - b.path.length)[0]?.path || "";
  const isStr = v => typeof v === "string" && v.trim().length > 1;
  const fields = {
    title: find(/^(title|name|video_?name|headline|caption|video_?title)$/i, isStr),
    url: find(/(^|_)(url|link|href|permalink|share_?url|watch_?url|page_?url|video_?url|webpage_?url)$/i,
      v => looksUrl(v) && !looksImage(v) && !looksVideoFile(v), /(thumb|image|img|poster|avatar|picture|preview|embed|icon|banner|logo)/i),
    thumb: find(/(thumb|poster|image|img|preview|cover|picture|still)/i, v => looksUrl(v) && !looksVideoFile(v), /(avatar|icon|logo|banner)/i),
    duration: find(/(duration|length|runtime|seconds)/i, v => parseDuration(v) != null),
    views: find(/(^views?$|view_?count|views_?total|^plays?$|play_?count|^hits$|watch_?count)/i, v => parseCount(v) != null),
    published: find(/(publish|created|upload|added|date|release|timestamp)/i, v => parseDate(v) != null, /(update|modified)/i),
    channel: find(/(author|channel|uploader|owner|creator|user)(_?name|displayname|\.name)?$/i, isStr, /(id|url|avatar)$/i) ||
      find(/(name|displayname)$/i, isStr, /^(title|name)$/i),
    tags: find(/(tags|keywords|categories)$/i, v => isStr(v) || Array.isArray(v)),
    id: find(/^(id|uuid|video_?id|vid|key|slug|guid|short_?uuid)$/i, v => typeof v === "string" || typeof v === "number"),
    video: flat.find(c => looksVideoFile(c.value))?.path || "",
    embed: find(/embed/i, looksUrl),
  };
  if (!fields.url && fields.id) fields.url = "";       // the wizard explains how to build links then
  return { list: best.path, fields };
}

// HTML: find the repeated "card" that holds a linked thumbnail, then the parts inside it.
function autoHTML(doc) {
  const sig = el => {
    const cls = [...el.classList].filter(c => !/\d/.test(c) && c.length < 40).slice(0, 2);
    return el.tagName.toLowerCase() + cls.map(c => "." + CSS.escape(c)).join("");
  };
  const counts = new Map();
  for (const a of doc.querySelectorAll("a[href]")) {
    if (!a.querySelector("img")) continue;
    let el = a;
    for (let up = 0; up < 4 && el && el !== doc.body; up++, el = el.parentElement) {
      const s = sig(el);
      if (!s.includes(".") && up > 0) continue;          // plain <div>s are too vague
      const c = counts.get(s) || { n: 0, up, els: new Set() };
      if (!c.els.has(el)) { c.els.add(el); c.n++; }
      c.up = Math.max(c.up, up);
      counts.set(s, c);
    }
  }
  const candidates = [...counts].filter(([, c]) => c.n >= 4).sort((a, b) => (b[1].n - a[1].n) || (b[1].up - a[1].up));
  if (!candidates.length) return null;
  // prefer the biggest wrapper that still repeats almost as often (holds title, duration, …)
  const topN = candidates[0][1].n;
  const [list] = candidates.filter(([, c]) => c.n >= topN * 0.8).sort((a, b) => b[1].up - a[1].up)[0];
  const item = doc.querySelector(list);
  const inner = el => (el === item ? "" : sig(el));
  const a = item.matches("a[href]") ? item : item.querySelector("a[href]");
  const img = item.querySelector("img");
  const texts = [...item.querySelectorAll("*")].filter(e => !e.children.length && e.textContent.trim());
  const textMatch = re => { const e = texts.find(t => re.test(t.textContent.trim())); return e ? inner(e) : ""; };
  const titleEl = [...item.querySelectorAll("a[title], [title]")].find(e => e.getAttribute("title")?.length > 5);
  const longest = texts.filter(e => !/^\s*[\d:.,]+\s*$/.test(e.textContent)).sort((x, y) => y.textContent.trim().length - x.textContent.trim().length)[0];
  const chanEl = [...item.querySelectorAll("a[href]")].find(e => /\/(channel|channels|user|users|profile|model|models|pornstar|creator|c)\/|\/@/i.test(e.getAttribute("href")));
  return {
    list,
    fields: {
      url: a ? (a === item ? "@href" : `${inner(a) || "a"}@href`) : "",
      thumb: img ? `${inner(img) || "img"}@src` : "",
      title: titleEl ? `${inner(titleEl)}@title` : longest ? inner(longest) : img?.getAttribute("alt") ? `${inner(img) || "img"}@alt` : "",
      duration: textMatch(/^(\d+:)?\d{1,2}:\d\d$/),
      views: textMatch(/(views?|aufrufe|vues|visualizaciones)\b/i),
      published: textMatch(/\bago\b|^vor\s+\d|^il y a/i),
      channel: chanEl ? inner(chanEl) || "a" : "",
    },
  };
}
