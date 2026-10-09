// "Add a site" wizard: kind → address → check results → finish.
const Wizard = (() => {
  let st = null;   // { step, site, q, page: {raw, base, records}, busy, editing }

  const KINDS = [
    ["youtube", "YouTube channel", "Follow a creator through the channel's feed. No API key needed; shows their newest 15 videos."],
    ["peertube", "PeerTube server", "Search one PeerTube server directly. Videos play here as files."],
    ["feed", "RSS or Atom feed", "Any feed with videos – Vimeo, Odysee and BitChute channels, podcasts, blogs."],
    ["json", "JSON search API", "A site that answers searches with JSON. The fields are detected for you."],
    ["html", "Website search page", "Any site with a search page. The results are read from the page and the parts detected for you."],
  ];
  const FIELD_LABELS = {
    title: "Title", url: "Link to the video", thumb: "Thumbnail", duration: "Length", views: "Views",
    published: "Upload date", channel: "Channel", tags: "Tags", id: "ID", video: "Video file (plays here)",
    embed: "Embed player link",
  };
  const STEPS = ["Kind of site", "Address", "Check results", "Finish"];

  const $w = id => document.getElementById(id);
  const host = u => { try { return new URL(u.includes("://") ? u : "https://" + u).host.replace(/^www\./, ""); } catch { return ""; } };

  function open(site) {
    st = {
      step: site ? 2 : 1, editing: !!site, q: "asmr", page: null,
      site: site ? JSON.parse(JSON.stringify(site)) : { fields: {}, maxPages: 5 },
    };
    $w("wizTitle").textContent = site ? `Edit ${site.name}` : "Add a site";
    $w("wizard").hidden = false;
    show();
  }
  function openImport() {
    st = { step: 0, editing: false, q: "asmr", page: null, site: { fields: {}, maxPages: 5 } };
    $w("wizTitle").textContent = "Import a site";
    $w("wizard").hidden = false;
    show();
  }
  function close() { $w("wizard").hidden = true; st = null; }

  function error(msg) { $w("wizError").textContent = msg || ""; }
  function busy(on, label) {
    st.busy = on;
    $w("wizNext").disabled = on;
    if (label) $w("wizNext").textContent = label;
  }

  function show() {
    error("");
    $w("wizSteps").innerHTML = STEPS.map((s, i) =>
      `<li class="${i + 1 === st.step ? "now" : i + 1 < st.step ? "done" : ""}">${s}</li>`).join("");
    $w("wizSteps").hidden = st.step === 0;
    $w("wizBack").hidden = st.step <= 1 || (st.editing && st.step === 2);
    $w("wizNext").disabled = false;
    $w("wizBack").onclick = () => { st.step--; show(); };
    $w("wizBody").onkeydown = null;
    if (st.step === 0) step0(); else [null, step1, step2, step3, step4][st.step]();
  }

  // ----- 0: import -----
  function step0() {
    $w("wizBody").innerHTML = `
      <p class="hint">Paste a site setup someone shared with you (it starts with a "{").</p>
      <textarea id="wImport" rows="10" spellcheck="false" aria-label="Site setup"></textarea>`;
    $w("wizNext").textContent = "Continue";
    $w("wizNext").onclick = () => {
      try {
        const s = JSON.parse($w("wImport").value);
        if (!CUSTOM_KINDS[s.kind] || typeof s.url !== "string" || !s.url) throw 0;
        const str = x => (typeof x === "string" ? x.slice(0, 500) : "");
        st.site = {
          kind: s.kind === "youtube" ? "feed" : s.kind, name: str(s.name), url: str(s.url), list: str(s.list),
          fields: Object.fromEntries(Object.keys(FIELD_LABELS).map(k => [k, str(s.fields?.[k])])),
          maxPages: Math.min(20, Math.max(1, +s.maxPages || 5)), embedTemplate: str(s.embedTemplate),
          idPattern: str(s.idPattern), allAsmr: !!s.allAsmr, adult: !!s.adult,
        };
        st.step = 2; show();
      } catch { error("That isn't a site setup. Copy the whole text, including the curly braces."); }
    };
  }

  // ----- 1: kind -----
  function step1() {
    $w("wizBody").innerHTML = `<div class="kinds">${KINDS.map(([k, name, desc]) => `
      <button class="kind" data-kind="${k}" aria-pressed="${st.site.kind === k}">
        <b>${esc(name)}</b><span>${esc(desc)}</span></button>`).join("")}</div>`;
    $w("wizBody").querySelectorAll(".kind").forEach(b => b.addEventListener("click", () => {
      st.site = { fields: {}, maxPages: 5, kind: b.dataset.kind };
      st.step = 2; show();
    }));
    $w("wizNext").textContent = "Next";
    $w("wizNext").onclick = () => error("Pick the kind of site first.");
  }

  // ----- 2: address -----
  function step2() {
    const s = st.site;
    const k = s.kind;
    const field = (id, label, value, placeholder, hint, type = "text") => `
      <label class="wf"><span>${label}</span>
        <input id="${id}" type="${type}" value="${esc(value || "")}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">
        ${hint ? `<small>${hint}</small>` : ""}</label>`;
    let html = "";
    if (k === "youtube") html = field("wUrl", "Channel link, @handle or channel ID", s.url, "https://www.youtube.com/@SomeASMRChannel");
    else if (k === "peertube") html = field("wUrl", "Server address", s.url, "tilvids.com");
    else if (k === "feed") html = field("wUrl", "Feed address", s.url, "https://example.com/videos.rss",
      "Vimeo: vimeo.com/<i>user</i>/videos/rss · Odysee: odysee.com/$/rss/@<i>channel</i>");
    else if (k === "json") html = field("wUrl", "Search address", s.url, "https://api.example.com/search?q={q}&page={page}",
      "Put <code>{q}</code> where the search words go and <code>{page}</code>, <code>{page0}</code> or <code>{offset}</code> where the page number goes.") +
      `<label class="wf"><span>Extra request header (optional)</span>
        <textarea id="wHeaders" rows="2" spellcheck="false" placeholder="Authorization: Bearer your-key">${esc(s.headers || "")}</textarea>
        <small>Only for APIs that need a key. Not included when you share the setup.</small></label>`;
    else if (k === "html") html =
      field("wUrl", "Address of a search results page", s.url, "https://example.com/search?q=asmr+whisper&page=2",
        "Search for something on the site, then copy the address of the results page.") +
      field("wWords", "The words you searched for there", /\{q\}/.test(s.url || "") ? "" : st.searchedWords || "", "asmr whisper",
        "They're replaced by <code>{q}</code>, so the app can search the site with other words. A page number in the address (like <code>page=2</code>) can be replaced with <code>{page}</code> by hand.");
    html += field("wQ", "Test search", st.q, "asmr", "Used to check the site in the next step.");
    $w("wizBody").innerHTML = html;
    $w("wUrl").focus();
    $w("wizNext").textContent = "Try it";
    $w("wizNext").onclick = tryIt;
    $w("wizBody").onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT") tryIt(); };
  }

  async function tryIt() {
    if (st.busy) return;
    const s = st.site;
    let url = $w("wUrl").value.trim();
    st.q = $w("wQ").value.trim() || "asmr";
    if (!url) return error("Fill in the address first.");
    if (s.kind === "html") {
      const words = $w("wWords").value.trim();
      st.searchedWords = words;
      if (!/\{q\}/.test(url) && words) {
        const variants = [encodeURIComponent(words), words.replace(/ /g, "+"), encodeURIComponent(words).replace(/%20/g, "+"),
          words.replace(/ /g, "-"), words.replace(/ /g, "%20"), words];
        const hit = variants.find(v => url.includes(v));
        if (hit) url = url.replace(hit, "{q}");
        else return error("Those words don't appear in the address. Check them, or put {q} into the address yourself.");
      }
    }
    if (s.kind === "json") s.headers = $w("wHeaders").value.trim();
    if (s.kind !== "peertube" && !/^https?:\/\//.test(url) && s.kind !== "youtube") url = "https://" + url;

    busy(true, "Checking…");
    error("");
    try {
      if (s.kind === "youtube") {
        if (!(await requestOrigins(["https://www.youtube.com/*"]))) throw new Error("Chrome didn't allow access to youtube.com.");
        const channelId = await resolveYouTube(url);
        s.kind = "feed";
        s.url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        s.allAsmr ??= true;
        st.fromYouTube = true;
      } else {
        s.url = s.kind === "peertube" ? url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : url;
      }
      const origin = siteOrigin(s);
      if (!origin) throw new Error("That address doesn't look right.");
      if (!(await requestOrigins([origin]))) throw new Error(`Chrome didn't allow access to ${host(s.url)}, so the app can't read it.`);
      st.page = await customPage({ ...s, id: "test", name: s.name || host(s.url) }, st.q, 0);
      if ((s.kind === "json" || s.kind === "html") && (!s.list || !st.editing)) autodetect();
      if (s.kind === "feed" && !s.name) {
        const t = st.page.raw.getElementsByTagName("title")[0]?.textContent?.trim();
        s.name = t ? t.slice(0, 40) : "";
      }
      st.step = 3; busy(false); show();
    } catch (e) {
      busy(false, "Try it");
      error(e.name === "TypeError" ? `Couldn't reach ${host(s.url || url)}. Check the address.` : e.message);
    }
  }

  async function resolveYouTube(input) {
    const direct = /(UC[\w-]{22})/.exec(input);
    if (direct) return direct[1];
    let u = input.trim();
    if (/^@/.test(u)) u = "https://www.youtube.com/" + u;
    else if (!/^https?:\/\//.test(u)) u = "https://www.youtube.com/@" + u.replace(/^@/, "");
    // The page can be a cookie-consent screen in the EU; with your YouTube cookies it usually isn't.
    for (const credentials of ["omit", "include"]) {
      try {
        const html = await (await fetch(u, { credentials })).text();
        const id = /"(?:channelId|externalId)":"(UC[\w-]{22})"/.exec(html)?.[1] ||
          /channel\/(UC[\w-]{22})/.exec(html)?.[1];
        if (id) return id;
      } catch {}
    }
    throw new Error("Couldn't find that channel. On YouTube open the channel → About → Share channel → Copy channel ID, and paste the ID here.");
  }

  // a page number already in the address, e.g. "?q={q}&page=2" → ["page=2", "page", "2"]
  function pageParam(url) {
    const m = /[?&]((page|p|pg|pagenum|pn|paged)=(\d+))(?=&|$)/i.exec(url || "");
    return m ? [m[1], m[2], m[3]] : null;
  }

  function autodetect() {
    const d = st.site.kind === "json" ? autoJSON(st.page.raw) : autoHTML(st.page.raw);
    if (d) { st.site.list = d.list; st.site.fields = d.fields; }
    rerun();
  }
  function rerun() {
    st.page.records = st.page.raw && (st.site.kind === "json" || st.site.kind === "html")
      ? extractRecords({ ...st.site, id: "test", name: st.site.name || host(st.site.url) }, st.page.raw, st.page.base)
      : st.page.records;
  }

  // ----- 3: check results -----
  function step3() {
    const s = st.site;
    const mappable = s.kind === "json" || s.kind === "html";
    let html = "";
    if (mappable) {
      const rows = s.kind === "json" ? jsonRows(s, st.page.raw) : htmlRows(s, st.page.raw);
      const sample = k => { const v = rows[0]?.[k]; const x = scalar(v); return x == null ? "" : String(Array.isArray(v) ? v.join(", ") : x).slice(0, 80); };
      html += `<div class="map">
        <label class="wf"><span>${s.kind === "json" ? "Where the list of results is" : "One result on the page (CSS selector)"}</span>
          <input id="wList" value="${esc(s.list || "")}" spellcheck="false"></label>
        <table class="fields"><tbody>${Object.entries(FIELD_LABELS).map(([k, label]) => `
          <tr><th scope="row"><label for="wf-${k}">${label}</label></th>
            <td><input id="wf-${k}" data-f="${k}" value="${esc(s.fields?.[k] || "")}" spellcheck="false"
              placeholder="${s.kind === "json" ? "path, e.g. data.title" : "selector@attribute"}"></td>
            <td class="sample" title="${esc(sample(k))}">${esc(sample(k))}</td></tr>`).join("")}
        </tbody></table>
        <p class="hint">${s.kind === "json"
          ? "Paths go through the JSON with dots: <code>owner.name</code>, <code>thumbnails.0.url</code>."
          : "Write <code>selector@attribute</code> to read an attribute (<code>a@href</code>, <code>img@src</code>) or just a selector for its text. <code>@href</code> alone reads the result element itself."}
          <button class="linklike" id="wDetect">Detect again</button></p>
      </div>`;
    }
    const n = st.page.records.length;
    html += `<p class="found">${n ? `Found <b>${n}</b> video${n > 1 ? "s" : ""} for "${esc(st.q)}" on the first page.`
      : mappable ? "No videos yet – the fields above don't match. Try <b>Detect again</b> or adjust them."
      : "This didn't return any videos. Check the address in the previous step."}</p>
      <div class="grid preview">${st.page.records.slice(0, 8).map((v, i) => cardHTML(v, i)).join("")}</div>`;
    if (s.kind === "html" && !n && st.page.raw.querySelectorAll("script").length > 10 && st.page.raw.querySelectorAll("img").length < 5)
      html += `<p class="hint">This site seems to build its results with JavaScript after loading, so they aren't in the page the app can read. Look for an RSS feed or an API on the site instead.</p>`;
    $w("wizBody").innerHTML = html;

    if (mappable) {
      let t;
      const onEdit = () => {
        s.list = $w("wList").value.trim();
        $w("wizBody").querySelectorAll("[data-f]").forEach(inp => (s.fields[inp.dataset.f] = inp.value.trim()));
        clearTimeout(t);
        t = setTimeout(() => { const pos = document.activeElement?.id; rerun(); step3(); if (pos) { const el = $w(pos); el?.focus(); el?.setSelectionRange?.(el.value.length, el.value.length); } }, 450);
      };
      $w("wizBody").querySelectorAll("input").forEach(i => i.addEventListener("input", onEdit));
      $w("wDetect").addEventListener("click", () => { autodetect(); step3(); });
    }
    $w("wizNext").textContent = "Next";
    $w("wizNext").disabled = !n;
    $w("wizNext").onclick = () => { st.step = 4; show(); };
  }

  // ----- 4: finish -----
  function step4() {
    const s = st.site;
    const mappable = s.kind === "json" || s.kind === "html";
    const first = st.page.records[0];
    s.name ||= st.fromYouTube ? first?.channel || "YouTube channel"
      : s.kind === "peertube" ? host(s.url)
      : host(s.url).split(".").slice(-2, -1)[0]?.replace(/^./, c => c.toUpperCase()) || "My site";
    s.allAsmr ??= s.kind === "feed";
    const playable = !mappable || s.fields.video || s.fields.embed;
    $w("wizBody").innerHTML = `
      <label class="wf"><span>Name</span><input id="wName" value="${esc(s.name)}" maxlength="40"></label>
      <label class="row"><span><b>Every video here is ASMR</b><small>Keeps all its videos, even when the title doesn't say "ASMR". Good for ASMR creators and ASMR-only sites.</small></span>
        <input type="checkbox" class="switch" id="wAll" ${s.allAsmr ? "checked" : ""}></label>
      <label class="row adult"><span><b>18+ site</b><small>Only shown when "18+ content" is on.</small></span>
        <input type="checkbox" class="switch" id="wAdult" ${s.adult ? "checked" : ""}></label>
      ${hasPaging(s) ? `<label class="wf"><span>Pages to read per search when refreshing</span>
        <input id="wPages" type="number" min="1" max="20" value="${s.maxPages || 5}"></label>`
        : mappable ? (pageParam(s.url)
          ? `<p class="hint">Only the first page of results is read right now. <button class="linklike" id="wUsePage">Read more pages (use <code>${esc(pageParam(s.url)[0])}</code> as the page number)</button></p>`
          : `<p class="hint">The address has no page number, so only the first page of results is read. Add <code>{page}</code> or <code>{offset}</code> to the address to read more.</p>`) : ""}
      ${mappable && !playable ? `
      <details class="adv"><summary>Play videos inside the app (optional)</summary>
        <p class="hint">Without this, videos from this site open on the site in a new tab. If the site offers an embed player, describe its address here:</p>
        <label class="wf"><span>Embed address</span><input id="wEmbed" value="${esc(s.embedTemplate || "")}" placeholder="https://${esc(host(s.url))}/embed/{id}" spellcheck="false"></label>
        <label class="wf"><span>ID in the video link (regular expression)</span><input id="wIdPat" value="${esc(s.idPattern || "")}" placeholder="/video/(\\d+)" spellcheck="false">
          <small>Example link: ${esc(first?.url || "")}</small></label>
        <p class="hint" id="wEmbedTest"></p>
      </details>` : ""}`;
    $w("wUsePage")?.addEventListener("click", () => {
      const [, key, n] = pageParam(s.url);
      s.url = s.url.replace(new RegExp(`([?&]${key}=)${n}`), `$1${+n === 0 ? "{page0}" : "{page}"}`);
      step4();
    });
    const testEmbed = () => {
      if (!$w("wEmbed")) return;
      s.embedTemplate = $w("wEmbed").value.trim();
      s.idPattern = $w("wIdPat").value.trim();
      const e = first && embedFromTemplate(s, first.url, first.id?.split("-").slice(2).join("-"));
      $w("wEmbedTest").textContent = s.embedTemplate ? (e ? `First video would play from: ${e}` : "The pattern doesn't find an ID in the example link.") : "";
    };
    $w("wEmbed")?.addEventListener("input", testEmbed);
    $w("wIdPat")?.addEventListener("input", testEmbed);
    testEmbed();
    $w("wizNext").textContent = st.editing ? "Save changes" : "Add site";
    $w("wizNext").onclick = async () => {
      s.name = $w("wName").value.trim().slice(0, 40);
      if (!s.name) return error("Give the site a name.");
      if (SOURCES.some(x => x.name.toLowerCase() === s.name.toLowerCase() && x.key !== "c-" + s.id)) return error("A site with that name already exists. Pick another name.");
      s.allAsmr = $w("wAll").checked;
      s.adult = $w("wAdult").checked;
      if ($w("wPages")) s.maxPages = Math.min(20, Math.max(1, +$w("wPages").value || 5));
      testEmbed();
      if (s.adult && !settings.adult) toast(`${s.name} is marked 18+, so it only shows up while "18+ content" is on.`);
      busy(true, "Saving…");
      await saveCustomSite(s);
      close();
    };
  }

  // shared buttons
  document.getElementById("wizClose").addEventListener("click", close);
  document.getElementById("wizard").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); } });

  return { open, openImport, close, get isOpen() { return !!st; } };
})();
