/*
 * 端末内の保存（IndexedDB）と送信処理。
 * 画面（app.js）とService Worker（sw.js）の両方から使います。
 */
(function (global) {
  const DB_NAME = 'pump-log';
  const DB_VER = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sent')) db.createObjectStore('sent', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(store, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => { db.close(); resolve(result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const Store = {
    getAll: (store) => tx(store, 'readonly', s => reqP(s.getAll())),
    put: (store, val, key) => tx(store, 'readwrite', s => reqP(key === undefined ? s.put(val) : s.put(val, key))),
    del: (store, key) => tx(store, 'readwrite', s => reqP(s.delete(key))),
    get: (store, key) => tx(store, 'readonly', s => reqP(s.get(key))),

    async getConfig() {
      return (await Store.get('kv', 'config')) || {};
    },
    async setConfig(cfg) {
      const cur = await Store.getConfig();
      return Store.put('kv', Object.assign(cur, cfg), 'config');
    },
    async getLast() { return (await Store.get('kv', 'last')) || null; },
    async setLast(last) { return Store.put('kv', last, 'last'); },

    async enqueue(rec) { return Store.put('queue', rec); },
    async pending() {
      const all = await Store.getAll('queue');
      return all.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    },
    async recentSent(limit) {
      const all = await Store.getAll('sent');
      return all.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, limit || 10);
    },

    /** GASへPOST（text/plain にしてCORSの事前確認を避ける） */
    async post(cfg, payload, timeoutMs) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ token: cfg.token }, payload)),
          redirect: 'follow',
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'ERROR');
        return data;
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * 未送信分をまとめて送る。成功したものだけ「送信済み」に移す。
     * 戻り値: { sent: 件数, remaining: 件数 }
     */
    async syncPending() {
      const cfg = await Store.getConfig();
      if (!cfg.url || !cfg.token) throw new Error('NOT_CONFIGURED');
      const items = await Store.pending();
      if (!items.length) {
        // 送るものがなくても最新値だけ取りに行く
        const data = await Store.post(cfg, { action: 'last' }, 10000);
        if (data.last) await Store.setLast(data.last);
        return { sent: 0, remaining: 0 };
      }
      const data = await Store.post(cfg, { action: 'add', records: items });
      const done = new Set([].concat(data.accepted || [], data.duplicated || []));
      for (const it of items) {
        if (done.has(it.id)) {
          await Store.put('sent', Object.assign({}, it, { sentAt: new Date().toISOString() }));
          await Store.del('queue', it.id);
        }
      }
      if (data.last) await Store.setLast(data.last);
      const left = await Store.pending();
      return { sent: done.size, remaining: left.length };
    }
  };

  global.PumpStore = Store;
})(typeof self !== 'undefined' ? self : window);
