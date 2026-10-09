// Video archive in IndexedDB: saves only new/changed videos instead of rewriting the whole archive.
const DB = (() => {
  let dbp = null;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open("asmr-index", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("videos", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("videos", mode);
      const out = fn(t.objectStore("videos"));
      t.oncomplete = () => res(out?.result ?? out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };
  return {
    getAll: () => tx("readonly", s => s.getAll()),
    put: records => records.length ? tx("readwrite", s => { for (const r of records) s.put(r); }) : Promise.resolve(),
    clear: () => tx("readwrite", s => s.clear()),
    delete: ids => ids.length ? tx("readwrite", s => { for (const id of ids) s.delete(id); }) : Promise.resolve(),
  };
})();
