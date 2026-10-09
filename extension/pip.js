// Content script: adds a small picture-in-picture button on videos (like PiP extensions do),
// and Alt+P as a shortcut. Runs inside the embedded players of the ASMR Index, and on every
// website if that option is switched on.
(() => {
  if (window.__asmrIndexPip) return;
  window.__asmrIndexPip = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      button{position:fixed;display:none;align-items:center;gap:6px;padding:6px 10px;border:0;border-radius:999px;
        background:rgba(28,20,44,.82);color:#efe8ff;font:500 12px/1 system-ui,sans-serif;cursor:pointer;
        box-shadow:0 2px 10px rgba(0,0,0,.35);backdrop-filter:blur(6px)}
      button:hover{background:rgba(48,34,74,.95)}
      button:focus-visible{outline:2px solid #f4b860;outline-offset:2px}
      svg{width:16px;height:16px}
    </style>
    <button type="button" title="Picture-in-picture (Alt+P)" aria-label="Picture-in-picture">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11.5" width="7" height="5.5" rx="1.2" fill="currentColor" stroke="none"/>
      </svg><span>Pop out</span>
    </button>`;
  const btn = root.querySelector("button");
  const label = root.querySelector("span");
  let target = null, hideTimer = null;

  const attach = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };

  function place(video) {
    const r = video.getBoundingClientRect();
    if (r.width < 160 || r.height < 90) return hide();
    target = video;
    attach();
    label.textContent = document.pictureInPictureElement ? "Back to page" : "Pop out";
    btn.style.display = "flex";
    btn.style.top = Math.max(8, r.top + 10) + "px";
    btn.style.left = Math.min(window.innerWidth - btn.offsetWidth - 8, r.right - btn.offsetWidth - 10) + "px";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 2500);
  }
  function hide() { btn.style.display = "none"; }

  document.addEventListener("pointermove", e => {
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return place(v);
    }
  }, { passive: true, capture: true });

  btn.addEventListener("click", e => {
    e.stopPropagation();
    asmrPipToggle(target);
    hide();
  });

  document.addEventListener("keydown", e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P" || e.code === "KeyP")) {
      e.preventDefault();
      e.stopPropagation();
      asmrPipToggle(target);
    }
  }, true);

  // Tell the ASMR Index page when its embedded player goes in or out of picture-in-picture.
  const report = active => { try { chrome.runtime.sendMessage({ type: "pip-state", active }).catch(() => {}); } catch {} };
  document.addEventListener("enterpictureinpicture", () => report(true), true);
  document.addEventListener("leavepictureinpicture", () => report(false), true);

  // Let the ASMR Index page know which of its frames hold a video (for its own PiP button).
  const announce = () => {
    if (document.querySelector("video")) {
      try { chrome.runtime.sendMessage({ type: "pip-frame" }).catch(() => {}); } catch {}
      return true;
    }
    return false;
  };
  if (!announce()) {
    const mo = new MutationObserver(() => { if (announce()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000);
  }
})();
