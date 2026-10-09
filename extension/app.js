const $ = id => document.getElementById(id);
let all = [];             // the whole archive
let byId = new Map();
let list = [];            // the list currently painted in the grid (cards and the player use it)
let computed = [];        // the latest filtered + sorted list (painted at the next redraw)
let shown = 60;
let settings = {};
let busy = 0;             // running searches
let myTabId = null;
let dataVersion = 0;      // bumps whenever videos are added or changed
let ui = { sort: "new", time: "", length: "", platform: "" };

const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = s => {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};
const compact = n => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
const DAY = 864e5;
const ago = iso => {
  if (!iso) return "";
  const d = (Date.now() - Date.parse(iso)) / DAY;
  if (isNaN(d)) return "";
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)} day${d >= 2 ? "s" : ""} ago`;
  if (d < 365) return `${Math.floor(d / 30)} month${d >= 60 ? "s" : ""} ago`;
  return `${Math.floor(d / 365)} year${d >= 730 ? "s" : ""} ago`;
};
const withAsmr = q => (/asmr/i.test(q) ? q.trim() : `asmr ${q.trim()}`);

// ---------- Video helpers ----------
// "ASMR" must be in the title or tags (Twitch/Reddit items come from ASMR-only sections and carry the tag).
const isAsmr = v => norm(v.title).includes("asmr") || (v.tags || []).some(t => t.includes("asmr"));
// Titles pointing at sexual content (hidden unless 18+ is on), and "leaked" private videos,
// which are always dropped since they're often shared without consent.
const ADULT_RE = /\b(nsfw|porn\w*|xxx|nude|nudes|naked|sexy|sex|lewd|erotic|onlyfans|fansly|18\+|explicit|hentai|joi)\b/i;
const LEAK_RE = /\b(leak|leaks|leaked)\b/i;
const isLeak = v => LEAK_RE.test(v.title || "") && (ADULT_RE.test(v.title || "") || /\b(video|patreon|tape)\b/i.test(v.title || ""));

// Per-video values that are expensive to recompute, cached on the video under symbol keys:
// symbols are never saved to the database and cost less memory than a separate lookup table.
const FLAGS = Symbol("flags"), TEXT = Symbol("text");
const ADULT = 1, ASMR = 2;
function flags(v) {
  let f = v[FLAGS];
  if (f === undefined) {
    f = (v.adult || ADULT_RE.test(`${v.title} ${v.channel}`) ? ADULT : 0) | (isAsmr(v) ? ASMR : 0);
    v[FLAGS] = f;
  }
  return f;
}
const textOf = v => (v[TEXT] ??= norm(`${v.title} ${v.channel || ""} ${(v.tags || []).join(" ")}`));
const isAdult = v => (flags(v) & ADULT) !== 0;
const forget = v => { delete v[FLAGS]; delete v[TEXT]; };

// Which sites found a video. Older saved videos don't have it, so derive it from the platform.
const PLATFORM_SRC = {
  Dailymotion: "dailymotion", PeerTube: "peertube", "Internet Archive": "archive", Odysee: "odysee",
  Niconico: "niconico", Rutube: "rutube", BitChute: "bitchute", "Wikimedia Commons": "commons", YouTube: "youtube",
  Vimeo: "vimeo", Twitch: "twitch", Eporner: "eporner", RedGifs: "redgifs", RedTube: "redtube", Pornhub: "pornhub",
  YouPorn: "youporn", Reddit: "reddit",
};
const srcOf = v => v.src || (v.via ? ["reddit"] : [PLATFORM_SRC[v.platform]]);
let activeKeys = new Set();
const computeActive = () => (activeKeys = new Set(
  SOURCES.filter(s => settings.enabled[s.key] && (!s.adult || settings.adult)).map(s => s.key)));

const sourceOf = v => SOURCES.find(s => s.name === v.platform);
const isDirect = v => !!v.files?.length || sourceOf(v)?.play === "direct";
const id3 = v => encodeURIComponent(v.id.slice(3));
const EMBED = {
  Dailymotion: v => `https://www.dailymotion.com/embed/video/${id3(v)}?autoplay=1`,
  Vimeo: v => `https://player.vimeo.com/video/${id3(v)}?autoplay=1&dnt=1`,
  YouTube: v => ytEmbed(v.id.slice(3)),
  Niconico: v => `https://embed.nicovideo.jp/watch/${id3(v)}?autoplay=1`,
  Rutube: v => `https://rutube.ru/play/embed/${id3(v)}`,
  BitChute: v => `https://www.bitchute.com/embed/${id3(v)}/`,
  Odysee: v => v.lbry && `https://odysee.com/$/embed/${encodeURIComponent(v.lbry.name)}/${v.lbry.claimId}?autoplay=true`,
  PeerTube: v => v.host && v.uuid && `https://${v.host}/videos/embed/${v.uuid}?autoplay=1`,
  Twitch: v => `https://player.twitch.tv/?video=${id3(v)}&parent=${location.hostname}&autoplay=true`,
  Eporner: v => `https://www.eporner.com/embed/${id3(v)}/`,
  RedTube: v => `https://embed.redtube.com/?id=${id3(v)}`,
  Pornhub: v => `https://www.pornhub.com/embed/${id3(v)}`,
  YouPorn: v => `https://www.youporn.com/embed/${id3(v)}`,
};
const embedFor = v => EMBED[v.platform]?.(v) || v.embed || null;

// Keeps saved records small: no empty fields, no derivable embed URL, a capped tag list.
function slim(v) {
  if (EMBED[v.platform]) delete v.embed;          // derivable for built-in platforms
  if (v.tags) v.tags = v.tags.filter(t => t.length < 40).slice(0, 12);
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x == null || x === "" || x === false || (Array.isArray(x) && !x.length)) delete v[k];
  }
  return v;
}

// ---------- Settings ----------
const DEFAULT_TERMS = "asmr, asmr whispering, asmr tapping, asmr sleep, asmr roleplay, asmr binaural, " +
  "asmr no talking, asmr mouth sounds, asmr ear cleaning, asmr massage, asmr scratching, asmr personal attention";
const DEFAULTS = {
  terms: DEFAULT_TERMS, vimeoToken: "", ytKey: "", twitchId: "", twitchSecret: "",
  adult: false, directOnly: false, strict: true,
  enabled: Object.fromEntries(SOURCES.map(s => [s.key, !s.adult])),
};
const SITE_INFO = {
  dailymotion: "Large general video site.",
  peertube: "Hundreds of independent servers. Plays here directly.",
  archive: "archive.org, incl. many saved YouTube channels. Plays here directly.",
  odysee: "Independent video platform. Plays here directly.",
  reddit: "r/asmr posts – mostly YouTube links, so you get YouTube videos without a key.",
  niconico: "Japan's big video site, with a huge ASMR catalog.",
  rutube: "Russian video site.",
  bitchute: "Independent video site. Plays here directly.",
  commons: "Free-licensed videos from Wikimedia. Plays here directly.",
  youtube: "Needs a free YouTube Data API key.",
  vimeo: "Needs a free personal access token.",
  twitch: "Past broadcasts from the ASMR category. Needs a free client ID and secret.",
  eporner: "Adult videos tagged ASMR.",
  redgifs: "Short adult ASMR clips with sound. Plays here directly.",
  redtube: "Adult videos tagged ASMR.",
  pornhub: "Adult videos tagged ASMR.",
  youporn: "Adult videos tagged ASMR.",
};
const KEY_FIELDS = {
  youtube: [["ytKey", "YouTube API key", "password"]],
  vimeo: [["vimeoToken", "Vimeo access token", "password"]],
  twitch: [["twitchId", "Twitch client ID", "text"], ["twitchSecret", "Twitch client secret", "password"]],
};
const PERSISTED = ["terms", "vimeoToken", "ytKey", "twitchId", "twitchSecret", "adult", "directOnly", "strict", "enabled", "version"];

let saveSettingsTimer;
function saveSettings(soon) {
  clearTimeout(saveSettingsTimer);
  const go = async () => {
    await chrome.storage.local.set({ settings: Object.fromEntries(PERSISTED.map(k => [k, settings[k]])) });
    $("saved").textContent = "Saved.";
    setTimeout(() => ($("saved").textContent = "Changes save automatically."), 1500);
  };
  soon ? (saveSettingsTimer = setTimeout(go, 600)) : go();
}
function settingsChanged() {
  computeActive();
  searched.clear();
  shown = 60;
  render(true);
}

function buildDrawer() {
  $("strict").checked = settings.strict;
  $("adult").checked = settings.adult;
  $("directOnly").checked = settings.directOnly;

  const row = s => {
    const keys = (KEY_FIELDS[s.key] || []).map(([k, label, type]) => `
      <div class="keyfield" ${settings.enabled[s.key] ? "" : "hidden"} data-keyfor="${s.key}">
        <input type="${type}" data-key="${k}" placeholder="${esc(label)}" aria-label="${esc(label)}" value="${esc(settings[k] || "")}">
      </div>`).join("");
    return `
      <label class="row ${s.adult ? "adult" : ""}">
        <span><b>${esc(s.name)}</b><small>${esc(SITE_INFO[s.key] || customInfo(s))}</small></span>
        <input type="checkbox" class="switch" data-src="${s.key}" ${settings.enabled[s.key] ? "checked" : ""}>
      </label>${keys}`;
  };
  const builtIn = SOURCES.filter(s => !s.custom);
  const free = builtIn.filter(s => !s.needs && !s.adult);
  const keyed = builtIn.filter(s => s.needs);
  const adult = builtIn.filter(s => s.adult);
  const mine = SOURCES.filter(s => s.custom && (!s.adult || settings.adult));
  const hiddenMine = SOURCES.filter(s => s.custom && s.adult && !settings.adult).length;
  const mineRow = s => `
      <div class="mine">
        ${row(s)}
        <div class="mine-actions">
          <button data-edit="${s.custom.id}">Edit</button>
          <button data-share="${s.custom.id}">Copy setup</button>
          <button data-remove="${s.custom.id}" class="danger">Remove</button>
        </div>
      </div>`;
  $("siteGroups").innerHTML =
    `<h4>Your sites</h4>${mine.map(mineRow).join("") ||
      `<p class="hint">Add any site with a search page, a search API, an RSS feed, a YouTube channel or a PeerTube server.</p>`}` +
    (hiddenMine ? `<p class="hint">${hiddenMine} of your 18+ sites are hidden while "18+ content" is off.</p>` : "") +
    `<div class="mine-add"><button class="pill-btn primary" id="addSite">Add a site</button><button class="pill-btn" id="importSite">Import a setup</button></div>` +
    `<h4>Free, no account</h4>${free.map(row).join("")}` +
    `<h4>With a free key</h4>${keyed.map(row).join("")}` +
    (settings.adult ? `<h4>18+</h4>${adult.map(row).join("")}` : "");
  $("addSite").addEventListener("click", () => Wizard.open());
  $("importSite").addEventListener("click", () => Wizard.openImport());
  $("siteGroups").querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () =>
    Wizard.open(customSites.find(x => x.id === b.dataset.edit))));
  $("siteGroups").querySelectorAll("[data-share]").forEach(b => b.addEventListener("click", () => shareCustomSite(b.dataset.share)));
  $("siteGroups").querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => removeCustomSite(b.dataset.remove)));

  $("siteGroups").querySelectorAll("[data-src]").forEach(cb => cb.addEventListener("change", async () => {
    const s = SOURCES.find(x => x.key === cb.dataset.src);
    if (cb.checked && s.origins && !(await requestOrigins(s.origins))) {
      cb.checked = false;
      toast(`Chrome didn't allow access to ${s.name}, so it stays off.`);
      return;
    }
    settings.enabled[s.key] = cb.checked;
    if (!cb.checked) stopSource(s.key);
    const kf = $("siteGroups").querySelectorAll(`[data-keyfor="${s.key}"]`);
    kf.forEach(el => (el.hidden = !cb.checked));
    if (cb.checked && kf.length) kf[0].querySelector("input").focus();
    saveSettings();
    settingsChanged();
  }));
  $("siteGroups").querySelectorAll("[data-key]").forEach(inp => inp.addEventListener("input", () => {
    settings[inp.dataset.key] = inp.value.trim();
    saveSettings(true);
    searched.clear();
  }));
  buildTerms();
}

// Must be called straight from a click/change (Chrome needs the user gesture for the prompt).
async function requestOrigins(origins) {
  try {
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch { return false; }
}

function buildTerms() {
  const terms = settings.terms.split(",").map(s => s.trim()).filter(Boolean);
  $("terms").innerHTML = terms.map((t, i) =>
    `<span class="term">${esc(t)}<button data-i="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join("");
  $("terms").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    terms.splice(+b.dataset.i, 1);
    settings.terms = terms.join(", ");
    saveSettings();
    buildTerms();
  }));
}
$("addTerm").addEventListener("submit", e => {
  e.preventDefault();
  const t = $("newTerm").value.trim();
  if (!t) return;
  settings.terms = [...settings.terms.split(",").map(s => s.trim()).filter(Boolean), withAsmr(t)].join(", ");
  $("newTerm").value = "";
  saveSettings();
  buildTerms();
});

$("strict").addEventListener("change", e => { settings.strict = e.target.checked; saveSettings(); settingsChanged(); });
$("directOnly").addEventListener("change", e => { settings.directOnly = e.target.checked; saveSettings(); settingsChanged(); });
$("adult").addEventListener("change", async e => {
  if (e.target.checked) {
    if (!confirm("Show 18+ content? Only continue if you are 18 or older.")) { e.target.checked = false; return; }
    const adultSources = SOURCES.filter(s => s.adult);
    const granted = await requestOrigins([...new Set(adultSources.flatMap(s => s.origins))]);
    adultSources.forEach(s => (settings.enabled[s.key] = granted));
    if (!granted) toast("Chrome didn't allow access to the adult sites. You can switch them on one by one below.");
  } else {
    SOURCES.filter(s => s.adult).forEach(s => { settings.enabled[s.key] = false; stopSource(s.key); });
  }
  settings.adult = e.target.checked;
  saveSettings();
  buildDrawer();
  settingsChanged();
});
$("pipEverywhere").addEventListener("change", async e => {
  if (e.target.checked) {
    e.target.checked = await requestOrigins(["<all_urls>"]);
    if (!e.target.checked) toast("Chrome didn't allow access to all sites, so the button stays limited to this app.");
  } else {
    await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch(() => {});
  }
});
$("clearArchive").addEventListener("click", async () => {
  if (!confirm(`Delete all ${all.length.toLocaleString()} saved videos? Settings are kept.`)) return;
  all = []; byId = new Map(); dirty.clear(); searched.clear(); dataVersion++;
  await DB.clear();
  updateArchiveInfo();
  render(true);
});
const updateArchiveInfo = () => ($("archiveInfo").textContent =
  `${all.length.toLocaleString()} videos saved in this browser` +
  (settings._lastUpdate ? `, last refreshed ${new Date(settings._lastUpdate).toLocaleString()}.` : "."));

function openSettings() {
  buildDrawer();
  updateArchiveInfo();
  $("drawer").hidden = $("scrim").hidden = false;
  $("closeSettings").focus();
}
function closeSettings() { $("drawer").hidden = $("scrim").hidden = true; }
$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("scrim").addEventListener("click", closeSettings);

// ---------- Your own sites (added with the wizard) ----------
let customSites = [];
const customInfo = s => `${CUSTOM_KINDS[s.custom?.kind] || "Your site"} · ${(siteOrigin(s.custom) || "").replace(/^https?:\/\/|\/\*$/g, "")}`;
function registerCustom(site) {
  const src = customSource(site);
  const i = SOURCES.findIndex(s => s.key === src.key);
  if (i >= 0) SOURCES[i] = src; else SOURCES.push(src);
  settings.enabled[src.key] ??= true;
}
async function saveCustomSite(site) {
  site.id ||= Date.now().toString(36);
  const i = customSites.findIndex(s => s.id === site.id);
  if (i >= 0) customSites[i] = site; else customSites.push(site);
  await chrome.storage.local.set({ customSites });
  registerCustom(site);
  settings.enabled["c-" + site.id] = true;
  saveSettings();
  settingsChanged();
  if (!$("drawer").hidden) buildDrawer();
  if (site.adult && !settings.adult) return;
  // Fill the archive from the new site right away.
  toast(`${site.name} ${i >= 0 ? "updated" : "added"}. Searching it now…`, [], 4000);
  const queries = [...new Set(settings.terms.split(",").map(t => t.trim()).filter(Boolean).map(withAsmr))];
  const summary = await runSearch(queries, { deep: true, archive: true, only: ["c-" + site.id], label: `Searching ${site.name}` });
  render(true);
  if (summary) $("status").textContent = summary;
}
async function removeCustomSite(id) {
  const site = customSites.find(s => s.id === id);
  if (!site) return;
  const key = "c-" + id;
  const only = all.filter(v => { const src = srcOf(v); return src.length === 1 && src[0] === key; });
  if (!confirm(`Remove ${site.name}${only.length ? ` and the ${only.length.toLocaleString()} videos only it found` : ""}?`)) return;
  stopSource(key);
  customSites = customSites.filter(s => s.id !== id);
  await chrome.storage.local.set({ customSites });
  SOURCES.splice(SOURCES.findIndex(s => s.key === key), 1);
  delete settings.enabled[key];
  saveSettings();
  // videos only this site found go; shared ones just forget it
  const gone = new Set(only.map(v => v.id));
  all = all.filter(v => !gone.has(v.id));
  for (const id2 of gone) byId.delete(id2);
  for (const v of all) if (v.src?.includes(key)) { v.src = v.src.filter(k => k !== key); dirty.add(v); }
  await DB.delete([...gone]);
  scheduleSave();
  dataVersion++;
  // give back the site access unless something else still needs it
  const origin = siteOrigin(site);
  const stillUsed = SOURCES.some(s => s.origins?.includes(origin)) ||
    chrome.runtime.getManifest().host_permissions.includes(origin);
  if (origin && !stillUsed) chrome.permissions.remove({ origins: [origin] }).catch(() => {});
  buildDrawer();
  settingsChanged();
}
function shareCustomSite(id) {
  const { id: _, headers, ...rest } = customSites.find(s => s.id === id) || {};
  navigator.clipboard.writeText(JSON.stringify(rest, null, 2))
    .then(() => toast(`Setup copied. Anyone can add it with "Import a setup"${headers ? " (the extra header with your key is left out)" : ""}.`))
    .catch(() => toast("Couldn't copy to the clipboard."));
}

// ---------- Collecting & saving results ----------
const dirty = new Set();          // videos that changed since the last save
function merge(v, key) {
  const old = byId.get(v.id);
  if (!old) {
    v.src = [key];
    slim(v);
    all.push(v); byId.set(v.id, v); dirty.add(v);
    dataVersion++;
    return true;
  }
  const src = srcOf(old);
  if (!src.includes(key)) { old.src = [...src, key]; dirty.add(old); dataVersion++; }
  if (v.weak && !old.weak) return false;            // keep richer data over a Reddit link
  slim(v);
  for (const k of Object.keys(v)) old[k] = v[k];
  if (!v.weak) delete old.weak;
  old.src = src.includes(key) ? src : [...src, key];
  forget(old);
  dirty.add(old);
  dataVersion++;
  return false;
}
const accept = v => !!v.title && !isLeak(v) && (!settings.strict || isAsmr(v));

let saveTimer;
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 1000); };
async function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty.size) return;
  const batch = [...dirty];
  dirty.clear();
  try { await DB.put(batch); }
  catch (e) { batch.forEach(v => dirty.add(v)); console.warn("Saving failed:", e); }
}
const touch = v => { dirty.add(v); forget(v); dataVersion++; scheduleSave(); };

let renderTimer;
const scheduleRender = () => {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; render(false, true); }, 700);
};

async function activeSources(forLive, only) {
  const active = [], skipped = [];
  for (const s of SOURCES) {
    if (!activeKeys.has(s.key) || (only && !only.includes(s.key))) continue;
    if (forLive && s.live === false) continue;
    if (s.needs && s.needs.some(k => !settings[k])) { skipped.push([s.name, "needs key"]); continue; }
    if (s.origins && !(await chrome.permissions.contains({ origins: s.origins }))) { skipped.push([s.name, "no access"]); continue; }
    active.push(s);
  }
  return { active, skipped };
}

// Running searches per site, so switching a site off stops it at once.
const sourceCtl = new Map();
function stopSource(key) {
  for (const c of sourceCtl.get(key) || []) c.abort();
  const name = SOURCES.find(s => s.key === key)?.name;
  const chip = chipState.get(name);
  if (chip && chip.state === "wait") { chip.state = "off"; renderChips(); }
}

// ----- the activity strip: one chip per site -----
let chipState = new Map();
function renderChips() {
  $("chips").innerHTML = [...chipState].map(([name, c]) => {
    const text = c.state === "wait" ? (c.count ? `<b>${c.count.toLocaleString()}</b>` : "")
      : c.state === "err" ? "failed" : c.state === "skip" ? c.note : c.state === "off" ? "switched off"
      : `<b>${c.count.toLocaleString()}</b>`;
    return `<span class="chip" data-state="${c.state}" title="${esc(c.err || c.note || "")}">${esc(name)} ${text}</span>`;
  }).join("");
  $("activity").hidden = chipState.size === 0;
}
function setBusy(delta) {
  busy += delta;
  $("searchbox").classList.toggle("busy", busy > 0);
}

// Every site runs in parallel and works through its search terms on its own,
// so one slow site doesn't hold up the others.
async function runSearch(queries, { deep, signal, label, forLive, archive, only }) {
  const { active, skipped } = await activeSources(forLive, only);
  chipState = new Map([...active.map(s => [s.name, { state: "wait", count: 0 }]),
    ...skipped.map(([name, note]) => [name, { state: "skip", note }])]);
  renderChips();
  // On a daily refresh, sites stop paging once they only return videos we already have.
  const known = archive && settings._lastUpdate && all.length ? id => byId.has(id) : null;
  const jobs = active.reduce((n, s) => n + (s.once ? 1 : queries.length), 0);
  let done = 0, added = 0;
  setBusy(1);
  $("status").textContent = `${label}…`;
  try {
    await Promise.all(active.map(async s => {
      const chip = chipState.get(s.name);
      const ctl = new AbortController();
      if (!sourceCtl.has(s.key)) sourceCtl.set(s.key, new Set());
      sourceCtl.get(s.key).add(ctl);
      const sig = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal;
      for (const q of s.once ? queries.slice(0, 1) : queries) {
        if (sig.aborted) break;
        try {
          const items = await s.fetch(q, { ...settings, deep, signal: sig, archive, known });
          if (sig.aborted || !activeKeys.has(s.key)) break;      // switched off meanwhile: drop the results
          for (const v of items) {
            if (!accept(v)) continue;
            chip.count++;
            if (merge(v, s.key)) added++;
          }
        } catch (e) {
          if (e.name === "AbortError" || sig.aborted) break;
          chip.state = "err"; chip.err = e.message;
        }
        done++;
        if (!signal?.aborted) {
          $("status").textContent = `${label} · ${done} of ${jobs} searches done · ${added.toLocaleString()} new videos`;
          renderChips();
          scheduleRender();
          scheduleSave();
        }
      }
      sourceCtl.get(s.key).delete(ctl);
      if (ctl.signal.aborted) chip.state = "off";
      else if (chip.state === "wait") chip.state = "ok";
      if (!signal?.aborted) renderChips();
    }));
  } finally {
    setBusy(-1);
  }
  if (signal?.aborted) return null;
  await flushSave();
  return `${label}: ${added.toLocaleString()} new videos, ${all.length.toLocaleString()} in your archive.`;
}

async function refresh() {
  $("refresh").disabled = true;
  $("refresh").classList.add("busy");
  const queries = [...new Set(settings.terms.split(",").map(s => s.trim()).filter(Boolean).map(withAsmr))];
  const summary = await runSearch(queries, { deep: true, archive: true, label: "Refreshing archive" });
  settings._lastUpdate = Date.now();
  await chrome.storage.local.set({ lastUpdate: settings._lastUpdate });
  $("refresh").disabled = false;
  $("refresh").classList.remove("busy");
  render(true);
  $("status").textContent = summary;
}

// ---------- Live search (when you type) ----------
const searched = new Map();      // query -> "quick" | "deep"
let liveCtl = null;

async function liveSearch(raw, deep) {
  const q = withAsmr(raw);
  const level = searched.get(q);
  if (level === "deep" || (level === "quick" && !deep)) return;
  liveCtl?.abort();
  const ctl = (liveCtl = new AbortController());
  searched.set(q, deep ? "deep" : "quick");
  const summary = await runSearch([q], {
    deep, signal: ctl.signal, forLive: true,
    label: `${deep ? "Searching deeper for" : "Searching all sites for"} "${raw.trim()}"`,
  });
  if (!summary || ctl.signal.aborted) return;
  render(true);
  $("status").textContent = summary;
}

let typeTimer, typeRenderTimer;
$("q").addEventListener("input", () => {
  shown = 60;
  clearTimeout(typeRenderTimer);
  typeRenderTimer = setTimeout(() => render(true), 60);
  clearTimeout(typeTimer);
  const q = $("q").value.trim();
  if (q.length >= 3) typeTimer = setTimeout(() => liveSearch(q, false), 1000);
});
$("q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  clearTimeout(typeTimer);
  const q = $("q").value.trim();
  if (q) liveSearch(q, searched.get(withAsmr(q)) === "quick");   // Enter again = search deeper
});

// ---------- Filtering & sorting ----------
let shuffleKeys = new WeakMap();
const shuffleKey = v => { let k = shuffleKeys.get(v); if (k === undefined) shuffleKeys.set(v, (k = Math.random())); return k; };

function sortList(arr) {
  switch (ui.sort) {
    case "views": return arr.sort((a, b) => (b.views || 0) - (a.views || 0));
    case "long": return arr.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    case "short": return arr.sort((a, b) => (a.duration || Infinity) - (b.duration || Infinity));
    case "random": return arr.sort((a, b) => shuffleKey(a) - shuffleKey(b));
    case "trending": {
      // views per day since upload: what's catching on right now
      const now = Date.now(), score = new Map();
      for (const v of arr) {
        const age = v.published ? Math.max(1, (now - Date.parse(v.published)) / DAY) : Infinity;
        score.set(v, (v.views || 0) / age);
      }
      return arr.sort((a, b) => score.get(b) - score.get(a));
    }
    default: return arr.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  }
}

// The filtered list is cached and only rebuilt when something it depends on changed.
let cacheKey = "", base = [];
function compute() {
  const raw = $("q").value.trim();
  const key = [dataVersion, raw, ui.platform, ui.sort, ui.time, ui.length, settings.strict, settings.adult,
    settings.directOnly, [...activeKeys].join()].join("|");
  if (key === cacheKey) return false;
  cacheKey = key;
  const words = norm(raw).split(/\s+/).filter(w => w && w !== "asmr");
  const cutoff = ui.time ? new Date(Date.now() - ui.time * DAY).toISOString() : null;
  const [lmin, lmax] = ui.length ? ui.length.split("-").map(x => (x === "" ? null : +x)) : [null, null];
  base = all.filter(v => {
    if (!srcOf(v).some(k => activeKeys.has(k))) return false;
    if (cutoff && !(v.published >= cutoff)) return false;
    if (lmin != null && !(v.duration >= lmin)) return false;
    if (lmax != null && !(v.duration < lmax)) return false;
    if (settings.directOnly && !isDirect(v)) return false;
    const f = flags(v);
    if (!settings.adult && (f & ADULT)) return false;
    if (settings.strict && !(f & ASMR)) return false;
    return !words.length || words.every(w => textOf(v).includes(w));
  });
  computed = sortList(ui.platform ? base.filter(v => v.platform === ui.platform) : base.slice());
  return true;
}

// ---------- Rendering ----------
let paintedIds = [];
function cardHTML(v, i) {
  const metaLine = [v.channel, v.views != null ? compact(v.views) + " views" : v.via, ago(v.published)].filter(Boolean);
  return `
    <article class="card" tabindex="0" data-i="${i}" aria-label="${esc(v.title)}">
      <div class="thumb">
        ${v.thumb ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" src="${esc(v.thumb)}">` : ""}
        <span class="tag ${isAdult(v) ? "adult" : isDirect(v) ? "direct" : ""}">${esc(v.platform)}</span>
        ${v.duration ? `<span class="dur">${fmt(v.duration)}</span>` : ""}
        <span class="play"><svg><use href="#i-play"/></svg></span>
      </div>
      <h4>${esc(v.title)}</h4>
      <p>${esc(metaLine.join(" · "))}</p>
    </article>`;
}

// Only touches the grid when the visible cards changed; "show more" just appends.
function paintGrid(force) {
  list = computed;
  const next = list.slice(0, shown);
  const same = n => { for (let i = 0; i < n; i++) if (paintedIds[i] !== next[i].id) return false; return true; };
  if (!force && next.length >= paintedIds.length && same(paintedIds.length)) {
    if (next.length > paintedIds.length) {
      $("grid").insertAdjacentHTML("beforeend",
        next.slice(paintedIds.length).map((v, j) => cardHTML(v, paintedIds.length + j)).join(""));
    }
  } else {
    $("grid").innerHTML = next.map(cardHTML).join("");
  }
  paintedIds = next.map(v => v.id);
}

// fromSearch: called while a search is running. If you've scrolled down, the grid is left alone
// (so it doesn't jump around) and a "Show new videos" button appears instead.
function render(force, fromSearch) {
  const changed = compute();
  const raw = $("q").value.trim();

  if (changed || force) renderPills();
  if (fromSearch && window.scrollY > 300) {
    if (changed) $("newPill").hidden = false;
  } else if (changed || force) {
    $("newPill").hidden = true;
    paintGrid(force);
  }

  // empty states
  const empty = $("empty");
  let msg = null;
  const filtered = ui.time || ui.length || ui.platform;
  if (!all.length) msg = busy
    ? ["Gathering your archive", "The first search across every site takes a few minutes. Videos show up here as they arrive."]
    : ["Your archive is empty", "Press Refresh to search every site, or type what you're in the mood for above."];
  else if (!computed.length && raw) msg = busy
    ? [`Searching for "${raw}"…`, "Results from each site appear here as soon as they arrive."]
    : [`No ASMR videos found for "${raw}"`, filtered
      ? "Try a wider time range or length, or clear the filters."
      : "Try other words, turn off \"ASMR only\" in Settings, or search directly on one of the sites above."];
  else if (!computed.length && filtered) msg = ["No videos match these filters", "Try a wider time range or length."];
  else if (!computed.length) msg = ["Nothing to show", "Your current settings hide every video. Check Settings → What to show and Sites."];
  empty.hidden = !msg;
  if (msg) empty.innerHTML = `<h2>${esc(msg[0])}</h2><p>${esc(msg[1])}</p>` +
    (filtered && !computed.length ? `<p><button class="pill-btn" id="clearFilters">Clear filters</button></p>` : "");
  $("clearFilters")?.addEventListener("click", () => applyPreset("all"));

  // At the end of the list: search the sites deeper for the current words.
  const more = $("more");
  more.hidden = !(computed.length <= shown && raw && searched.get(withAsmr(raw)) !== "deep" && !busy);
  if (!more.hidden) more.textContent = `Search every site deeper for "${raw}"`;

  renderElsewhere(raw);
  if (!busy && chipState.size === 0) {
    $("activity").hidden = false;
    $("status").textContent = `${computed.length.toLocaleString()} of ${all.length.toLocaleString()} videos`;
  }
}

function renderPills() {
  const counts = new Map();
  for (const v of base) counts.set(v.platform, (counts.get(v.platform) || 0) + 1);
  if (ui.platform && !counts.has(ui.platform)) { ui.platform = ""; }
  const dotFor = p => { const s = SOURCES.find(x => x.name === p); return s?.adult ? "adult" : s?.play === "direct" ? "direct" : ""; };
  $("platforms").innerHTML =
    `<button class="pill" role="tab" data-p="" aria-selected="${!ui.platform}">All sites <i>${base.length.toLocaleString()}</i></button>` +
    [...counts].sort((a, b) => b[1] - a[1]).map(([p, n]) => `<button class="pill" role="tab" data-p="${esc(p)}" aria-selected="${ui.platform === p}">
      <span class="dot ${dotFor(p)}"></span>${esc(p)} <i>${n.toLocaleString()}</i></button>`).join("");
  syncFilterControls();
}

// Infinite scroll: load the next cards when the end of the grid comes into view.
new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && computed.length > shown && $("newPill").hidden) {
    shown += 60;
    paintGrid();
  }
}, { rootMargin: "800px" }).observe($("sentinel"));

$("newPill").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("newPill").hidden = true;
  shown = 60;
  paintGrid(true);
});

// ---------- Filters & quick views ----------
const PRESETS = {
  all: { sort: "new", time: "", length: "" },
  today: { sort: "new", time: "1", length: "" },
  week: { sort: "views", time: "7", length: "" },
  month: { sort: "views", time: "30", length: "" },
  trending: { sort: "trending", time: "", length: "" },
  sleep: { sort: "views", time: "", length: "3600-" },
  random: { sort: "random", time: "", length: "" },
};
function applyPreset(name) {
  Object.assign(ui, PRESETS[name]);
  if (name === "random") shuffleKeys = new WeakMap();   // a fresh shuffle every click
  filtersChanged();
}
function filtersChanged() {
  shown = 60;
  if (ui.sort === "random") cacheKey = "";               // random needs a recompute even if nothing else changed
  saveUi();
  render(true);
  window.scrollTo({ top: 0 });
}
function syncFilterControls() {
  $("sort").value = ui.sort; $("time").value = ui.time; $("length").value = ui.length;
  for (const b of $("presets").querySelectorAll("button")) {
    const p = PRESETS[b.dataset.preset];
    b.setAttribute("aria-pressed", p.sort === ui.sort && p.time === ui.time && p.length === ui.length);
  }
}
const saveUi = () => chrome.storage.local.set({ ui });

$("presets").addEventListener("click", e => { const b = e.target.closest("button"); if (b) applyPreset(b.dataset.preset); });
for (const id of ["sort", "time", "length"]) $(id).addEventListener("change", e => { ui[id] = e.target.value; filtersChanged(); });
$("platforms").addEventListener("click", e => {
  const b = e.target.closest(".pill");
  if (!b) return;
  ui.platform = b.dataset.p;
  filtersChanged();
});

function renderElsewhere(raw) {
  const box = $("elsewhere");
  if (!raw) { box.hidden = true; return; }
  if (box.dataset.q === raw + settings.adult) { box.hidden = false; return; }
  box.dataset.q = raw + settings.adult;
  const q = withAsmr(raw);
  const sites = ELSEWHERE.filter(s => !s.adult || settings.adult);
  box.innerHTML = `Also search on` + sites.map((s, i) =>
    `<button data-k="${i}" class="${s.adult ? "adult" : ""}" title="Opens in a new tab">${esc(s.name)}</button>`).join("");
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => openTab(sites[+b.dataset.k].url(q))));
  box.hidden = false;
}

const openTab = url => chrome.tabs.create({ url, active: true });
const openOriginal = v => openTab(v.url);

let toastTimer;
function toast(text, actions = [], ms = 7000) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span>` + actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join("");
  t.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { t.hidden = true; actions[+b.dataset.i].fn(); }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Player ----------
let current = -1;         // index in list of the open video
let playing = null;       // the record that is loaded in the player
let hls = null;
let loadToken = 0;
let pipFrames = new Set();          // frames of the embedded player that hold a video
let embedPipActive = false;         // the embedded player's video is in picture-in-picture
let miniWin = null;                 // Document picture-in-picture window

// hls.js is only needed for streamed videos, so it's loaded the first time one plays.
let hlsLoading = null;
const loadHls = () => window.Hls ? Promise.resolve() : (hlsLoading ??= new Promise((res, rej) => {
  const s = document.createElement("script");
  s.src = "lib/hls.min.js"; s.onload = res; s.onerror = rej;
  document.head.append(s);
}));

const stageMedia = () => (miniWin?.document.querySelector("video, iframe")) || $("stage").querySelector("video, iframe");
const pipActive = () => !!document.pictureInPictureElement || embedPipActive || !!miniWin;

function stopPlayback() {
  loadToken++;
  if (miniWin) { const w = miniWin; miniWin = null; w.close(); }
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  if (hls) { hls.destroy(); hls = null; }
  const vid = $("stage").querySelector("video");
  if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); }
  $("stage").innerHTML = "";
  $("quality").hidden = true;
  $("quality").innerHTML = "";
  pipFrames.clear();
  embedPipActive = false;
  playing = null;
  updateNowPip();
}

function stageMsg(text, v) {
  $("stage").innerHTML = `<div class="msg"><div><p>${esc(text)}</p>${v ? `<button class="pill-btn" id="openSite"><svg><use href="#i-external"/></svg>Open on ${esc(v.platform)}</button>` : ""}</div></div>`;
  if (v) $("openSite").addEventListener("click", () => openOriginal(v));
}

function openPlayer(i) {
  if (i < 0 || i >= list.length) return;
  stopPlayback();
  current = i;
  const v = (playing = list[i]);
  $("ptitle").textContent = v.title || "";
  $("pmeta").textContent = [v.channel, v.platform, fmt(v.duration)].filter(Boolean).join(" · ");
  $("porig").querySelector("span").textContent = `Open on ${v.platform}`;
  $("prev").disabled = i === 0;
  $("next").disabled = i >= list.length - 1;
  $("player").hidden = false;
  $("close").focus();

  if (v.platform === "RedGifs") playRedGifs(v);
  else if (v.files?.length) playFiles(v.files, v);
  else if (v.platform === "PeerTube") playPeerTube(v);
  else if (v.platform === "Internet Archive") playArchive(v);
  else if (v.platform === "Odysee") playOdysee(v);
  else if (v.platform === "BitChute") playBitChute(v);
  else if (v.platform === "Reddit") playHls(v.hls, [], v);
  else playEmbed(v);
}

// Closing the player while picture-in-picture is running keeps it playing, so you can keep browsing.
function closePlayer() {
  $("player").hidden = true;
  if (!pipActive()) stopPlayback();
  current = -1;
  updateNowPip();
}
function updateNowPip() {
  const show = !!playing && $("player").hidden && pipActive();
  $("nowpip").hidden = !show;
  if (show) $("nowpipTitle").textContent = playing.title;
}
$("nowpipOpen").addEventListener("click", () => {
  current = list.indexOf(playing);
  $("player").hidden = false;
  updateNowPip();
});
$("nowpipStop").addEventListener("click", () => { stopPlayback(); updateNowPip(); });

function setMode(text, direct) {
  $("pmode").textContent = text;
  $("pmode").className = "mode" + (direct ? "" : " embed");
}

async function playPeerTube(v) {
  const token = loadToken;
  stageMsg("Loading the video file…");
  try {
    const u = new URL(v.url);
    const host = v.host || u.host;
    const id = v.uuid || u.pathname.split("/").filter(Boolean).pop();
    const d = await getJSON(`https://${host}/api/v1/videos/${encodeURIComponent(id)}`);
    if (token !== loadToken) return;
    const byRes = arr => (arr || []).filter(f => f.fileUrl && (f.resolution?.id || 0) > 0)
      .sort((a, b) => b.resolution.id - a.resolution.id)
      .map(f => ({ url: f.fileUrl, label: f.resolution.id + "p", h: f.resolution.id }));
    const mp4s = byRes(d.files);
    const playlist = (d.streamingPlaylists || []).find(sp => sp.playlistUrl);
    const hlsFiles = byRes(playlist?.files);
    if (mp4s.length) return playFiles(mp4s, v);
    if (playlist) return playHls(playlist.playlistUrl, hlsFiles, v);
    if (hlsFiles.length) return playFiles(hlsFiles, v);
    playEmbed(v, true);
  } catch {
    if (token === loadToken) playEmbed(v, true);
  }
}

async function playArchive(v) {
  const token = loadToken;
  stageMsg("Loading the video file…");
  try {
    const id = v.ia || v.id.slice(3);
    const d = await getJSON(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (token !== loadToken) return;
    const path = name => name.split("/").map(encodeURIComponent).join("/");
    const files = (d.files || [])
      .filter(f => /\.(mp4|m4v|webm)$/i.test(f.name) && !/thumb/i.test(f.format || ""))
      .map(f => ({
        url: `https://archive.org/download/${encodeURIComponent(id)}/${path(f.name)}`,
        h: +f.height || 0, len: +f.length || 0,
        label: (f.height ? f.height + "p " : "") + f.name.split(".").pop().toLowerCase(),
      }))
      .sort((a, b) => b.h - a.h);
    if (!files.length) return stageMsg("This Internet Archive item has no playable video file.", v);
    if (!v.duration && files[0].len) { v.duration = files[0].len; touch(v); }
    playFiles(files, v);
  } catch (e) {
    if (token === loadToken) stageMsg(`Couldn't load the file list (${e.message}).`, v);
  }
}

async function playOdysee(v) {
  const token = loadToken;
  stageMsg("Loading the video file…");
  try {
    const d = await postJSON("https://api.na-backend.odysee.com/api/v1/proxy?m=get", {
      jsonrpc: "2.0", method: "get", params: { uri: `lbry://${v.lbry.name}#${v.lbry.claimId}`, save_file: false },
    });
    if (token !== loadToken) return;
    const url = d.result?.streaming_url;
    if (!url) throw new Error("no stream");
    playFiles([{ url, label: "auto", h: 0 }], v);
  } catch {
    if (token === loadToken) playEmbed(v, true);
  }
}

async function playBitChute(v) {
  const token = loadToken;
  stageMsg("Loading the video file…");
  try {
    const d = await postJSON("https://api.bitchute.com/api/beta/video/media", { video_id: v.bcId || v.id.slice(3) });
    if (token !== loadToken) return;
    if (!d.media_url) throw new Error("no file");
    playFiles([{ url: d.media_url, label: "auto", h: 0 }], v);
  } catch {
    if (token === loadToken) playEmbed(v, true);
  }
}

async function playRedGifs(v) {
  const token = loadToken;
  stageMsg("Loading the clip…");
  try {
    const fresh = await redgifsGif(v.rgId || v.id.slice(3));
    if (token !== loadToken) return;
    const keepTitle = v.weak ? v.title : null;
    Object.assign(v, slim(fresh));
    if (keepTitle) v.title = keepTitle;
    touch(v);
    playFiles(v.files, v);
  } catch (e) {
    if (token !== loadToken) return;
    if (v.files?.length) playFiles(v.files, v);
    else stageMsg(`Couldn't load this clip (${e.message}).`, v);
  }
}

function makeVideo(v) {
  const vid = document.createElement("video");
  vid.controls = true;
  vid.autoplay = true;
  vid.playsInline = true;
  vid.preload = "auto";
  vid.setAttribute("controlsList", "nodownload");
  vid.addEventListener("leavepictureinpicture", () => { if ($("player").hidden) stopPlayback(); });
  vid.addEventListener("enterpictureinpicture", updateNowPip);
  // Media keys / OS media controls show the title; Chrome may also auto-PiP when you switch tabs.
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: v.title || "", artist: v.channel || v.platform, artwork: v.thumb ? [{ src: v.thumb }] : [],
    });
    navigator.mediaSession.setActionHandler("enterpictureinpicture", () => vid.requestPictureInPicture());
  } catch {}
  $("stage").innerHTML = "";
  $("stage").appendChild(vid);
  return vid;
}

function playFiles(files, v) {
  setMode("plays here directly", true);
  const vid = makeVideo(v);
  const pick = files.find(f => !f.h || f.h <= 1080) || files[files.length - 1];
  const q = $("quality");
  q.innerHTML = files.map(f => `<option value="${esc(f.url)}">${esc(f.label)}</option>`).join("");
  q.value = pick.url;
  q.hidden = files.length < 2;
  q.onchange = () => {
    const t = vid.currentTime, paused = vid.paused;
    vid.src = q.value;
    vid.addEventListener("loadedmetadata", () => { vid.currentTime = t; if (!paused) vid.play(); }, { once: true });
  };
  vid.addEventListener("error", () => stageMsg("This video file can't be played here.", v), { once: true });
  vid.src = pick.url;
}

async function playHls(url, fallbackFiles, v) {
  setMode("plays here directly", true);
  if (!url) return stageMsg("No stream available for this one.", v);
  const token = loadToken;
  try { await loadHls(); } catch {}
  if (token !== loadToken) return;
  const vid = makeVideo(v);
  if (!(window.Hls && Hls.isSupported())) {
    vid.addEventListener("error", () => stageMsg("This stream can't be played here.", v), { once: true });
    vid.src = url;
    return;
  }
  // Workers are off because extension pages don't allow blob: workers.
  hls = new Hls({ enableWorker: false, capLevelToPlayerSize: true });
  hls.loadSource(url);
  hls.attachMedia(vid);
  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    const q = $("quality");
    q.innerHTML = `<option value="-1">Auto</option>` +
      data.levels.map((l, i) => `<option value="${i}">${l.height}p</option>`).join("");
    q.hidden = data.levels.length < 2;
    q.onchange = () => { hls.currentLevel = Number(q.value); };
    vid.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    hls.destroy(); hls = null;
    if (fallbackFiles.length) playFiles(fallbackFiles, v);
    else playEmbed(v, true);
  });
}

// Everything else: the site's own player in a sandboxed frame that can't open pop-ups or redirect.
function playEmbed(v, rawFailed) {
  const src = embedFor(v);
  if (!src) return stageMsg(`This one can't be played inside the app.`, v);
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
  f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
  f.setAttribute("allowfullscreen", "");
  f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  f.src = src;
  $("stage").innerHTML = "";
  $("stage").appendChild(f);
  setMode(rawFailed ? `${v.platform}'s player (direct file unavailable)` : `${v.platform}'s player`, false);
}

// ----- picture-in-picture -----
function togglePip() {
  if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
  const el = stageMedia();
  if (!el) return;
  if (el.tagName === "VIDEO") {
    el.requestPictureInPicture().catch(() => offerMini("Chrome refused picture-in-picture for this video."));
    return;
  }
  // Embedded player: run the PiP toggle inside its frame (the same trick PiP extensions use).
  const frameIds = [...pipFrames];
  if (myTabId == null || !frameIds.length) return offerMini();
  chrome.scripting.executeScript({ target: { tabId: myTabId, frameIds }, func: asmrPipToggle })
    .then(res => { if (!res.some(r => r.result === "entered" || r.result === "exited")) offerMini(); })
    .catch(() => offerMini());
}
function offerMini(reason) {
  toast(`${reason ? reason + " " : ""}Hover the video and click "Pop out" in its corner, or use a mini window.`,
    [{ label: "Mini window", fn: miniWindow }], 9000);
}

// Document picture-in-picture: an always-on-top mini window that holds the player itself.
async function miniWindow() {
  if (miniWin) { miniWin.focus(); return; }
  if (!window.documentPictureInPicture) return toast("This Chrome version has no mini window. Use Picture-in-picture instead.");
  if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
  const el = $("stage").querySelector("video, iframe");
  if (!el) return;
  const isVideo = el.tagName === "VIDEO";
  const t = isVideo ? el.currentTime : 0;
  const wasPlaying = isVideo && !el.paused;
  const w = await documentPictureInPicture.requestWindow({ width: 640, height: 360 });
  miniWin = w;
  const style = w.document.createElement("style");
  style.textContent = "html,body{margin:0;height:100%;background:#000;overflow:hidden}video,iframe{width:100%;height:100%;border:0;display:block}";
  w.document.head.append(style);
  w.document.title = playing?.title || "ASMR Index";
  w.document.body.append(el);
  if (isVideo) { el.currentTime = t; if (wasPlaying) el.play().catch(() => {}); }
  else toast("The embedded player restarts in the mini window.", [], 4000);
  $("stage").innerHTML = `<div class="msg"><div><p>Playing in the mini window.</p><button class="pill-btn" id="bringBack">Bring it back here</button></div></div>`;
  $("bringBack").addEventListener("click", () => w.close());
  w.addEventListener("pagehide", () => {
    if (miniWin !== w) return;            // stopped on purpose
    miniWin = null;
    const media = w.document.querySelector("video, iframe");
    if (media && playing) {
      const t2 = media.tagName === "VIDEO" ? media.currentTime : 0;
      const p2 = media.tagName === "VIDEO" && !media.paused;
      $("stage").innerHTML = "";
      $("stage").append(media);
      if (media.tagName === "VIDEO") { media.currentTime = t2; if (p2) media.play().catch(() => {}); }
    }
    if ($("player").hidden) stopPlayback();
    updateNowPip();
  });
  updateNowPip();
}

// Messages from the PiP helper inside embedded players (and Alt+Shift+P from the background).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "app-pip" && msg.tabId === myTabId) togglePip();
  if (sender.tab?.id !== myTabId || myTabId == null) return;
  if (msg.type === "pip-frame") pipFrames.add(sender.frameId);
  if (msg.type === "pip-state") {
    embedPipActive = !!msg.active;
    if (!embedPipActive && $("player").hidden && !miniWin) stopPlayback();
    updateNowPip();
  }
});

// ---------- Events ----------
$("more").addEventListener("click", () => { if ($("q").value.trim()) liveSearch($("q").value.trim(), true); });
$("refresh").addEventListener("click", refresh);

$("grid").addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  const v = list[Number(card.dataset.i)];
  if (e.ctrlKey || e.metaKey || e.shiftKey) openOriginal(v);
  else openPlayer(Number(card.dataset.i));
});
$("grid").addEventListener("auxclick", e => {
  const card = e.target.closest(".card");
  if (card && e.button === 1) { e.preventDefault(); openOriginal(list[Number(card.dataset.i)]); }
});
$("grid").addEventListener("keydown", e => {
  const card = e.target.closest(".card");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPlayer(Number(card.dataset.i)); }
});

$("pipBtn").addEventListener("click", togglePip);
$("popBtn").addEventListener("click", miniWindow);
$("porig").addEventListener("click", () => playing && openOriginal(playing));
$("close").addEventListener("click", closePlayer);
$("prev").addEventListener("click", () => openPlayer(current - 1));
$("next").addEventListener("click", () => openPlayer(current + 1));
$("player").addEventListener("click", e => { if (e.target === $("player")) closePlayer(); });

document.addEventListener("keydown", e => {
  if (e.altKey && (e.code === "KeyP") && playing) { e.preventDefault(); togglePip(); return; }
  if (e.key === "Escape" && !$("drawer").hidden) { closeSettings(); return; }
  if ($("player").hidden || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) {
    if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) { e.preventDefault(); $("q").focus(); }
    return;
  }
  if (e.key === "Escape") closePlayer();
  else if (e.key === "ArrowLeft" && e.target.tagName !== "VIDEO") openPlayer(current - 1);
  else if (e.key === "ArrowRight" && e.target.tagName !== "VIDEO") openPlayer(current + 1);
});
window.addEventListener("pagehide", () => { flushSave(); });

// ---------- Start ----------
(async () => {
  try { myTabId = (await chrome.tabs.getCurrent())?.id ?? null; } catch {}
  const stored = await chrome.storage.local.get(["lastUpdate", "settings", "ui", "vimeoToken", "directOnly"]);
  const old = stored.settings || {};
  settings = { ...DEFAULTS, vimeoToken: stored.vimeoToken ?? "", directOnly: stored.directOnly ?? false, ...old };
  settings.enabled = { ...DEFAULTS.enabled, ...(old.enabled || {}) };
  if (!old.terms || old.terms.trim().toLowerCase() === "asmr") settings.terms = DEFAULT_TERMS;
  settings._lastUpdate = stored.lastUpdate || 0;
  ui = { ...ui, ...(stored.ui || {}) };
  customSites = (await chrome.storage.local.get("customSites")).customSites || [];
  for (const site of customSites) registerCustom(site);
  computeActive();

  // Archive: IndexedDB. Versions up to 0.5 kept it in chrome.storage – move it over once.
  let videos = await DB.getAll().catch(() => []);
  if (!videos.length) {
    const legacy = (await chrome.storage.local.get("videos")).videos;
    if (legacy?.length) {
      videos = legacy.map(slim);
      await DB.put(videos);
      await chrome.storage.local.remove("videos");
    }
  }
  for (const v of videos) if (!isLeak(v) && !byId.has(v.id)) { all.push(v); byId.set(v.id, v); }
  dataVersion++;
  try { $("pipEverywhere").checked = await chrome.permissions.contains({ origins: ["<all_urls>"] }); } catch {}

  render(true);
  $("q").focus();

  // Rebuild the archive the first time this version runs (new sites), otherwise once a day.
  const firstRun = (old.version || 0) < 5;
  if (firstRun) { settings.version = 6; saveSettings(); }
  else if (old.version !== 6) { settings.version = 6; saveSettings(); }
  if (firstRun || Date.now() - settings._lastUpdate > DAY) refresh();
})();
