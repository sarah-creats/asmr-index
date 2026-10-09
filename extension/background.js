importScripts("pip-core.js");

const APP_URL = chrome.runtime.getURL("app.html");

// Embedded players of the 18+ sites get the PiP button only after their permission was granted.
const OPTIONAL_PLAYER_HOSTS = [
  "https://www.eporner.com/*", "https://embed.redtube.com/*", "https://www.pornhub.com/*", "https://www.youporn.com/*",
];

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: APP_URL }));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "pip", title: "Picture-in-picture", contexts: ["video", "page", "frame"],
  }, () => void chrome.runtime.lastError);
  syncPipScripts();
});
chrome.runtime.onStartup.addListener(syncPipScripts);
chrome.permissions.onAdded.addListener(syncPipScripts);
chrome.permissions.onRemoved.addListener(syncPipScripts);

// Register the PiP button for granted optional hosts, or for every website when "<all_urls>" was granted.
async function syncPipScripts() {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.includes("<all_urls>")
    ? ["<all_urls>"]
    : OPTIONAL_PLAYER_HOSTS.filter(o => origins.includes(o));
  try { await chrome.scripting.unregisterContentScripts({ ids: ["pip-extra"] }); } catch {}
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([{
    id: "pip-extra", matches, js: ["pip-core.js", "pip.js"], allFrames: true, runAt: "document_idle",
  }]).catch(e => console.warn("PiP script:", e.message));
}

// Right-click "Picture-in-picture" and Alt+Shift+P work on any tab (activeTab).
async function pipInTab(tab, frameId) {
  if (!tab?.id) return;
  if (tab.url?.startsWith(APP_URL)) {           // our own page handles it itself
    chrome.runtime.sendMessage({ type: "app-pip", tabId: tab.id }).catch(() => {});
    return;
  }
  const tries = [
    frameId != null ? { tabId: tab.id, frameIds: [frameId] } : null,
    { tabId: tab.id, allFrames: true },
    { tabId: tab.id, frameIds: [0] },
  ].filter(Boolean);
  for (const target of tries) {
    try {
      const res = await chrome.scripting.executeScript({ target, func: asmrPipToggle });
      if (res.some(r => r.result === "entered" || r.result === "exited")) return;
    } catch {}
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "pip") pipInTab(tab, info.frameId);
});
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === "toggle-pip") pipInTab(tab);
});
