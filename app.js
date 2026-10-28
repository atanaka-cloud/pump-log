/* 画面の動き */
(function () {
  const S = window.PumpStore;
  const $ = (id) => document.getElementById(id);
  let lastRef = null;   // 前回の記録（サーバー最新 or この端末の最新、新しい方）
  let syncing = false;

  /* ---------- 表示用ヘルパー ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function fmt(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function parseMeter(s) {
    const t = String(s).trim()
      .replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[,，\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Number(t);
  }
  // 日本語・ベトナム語の併記
  const T = (ja, vi) => [ja, vi];
  const html = (m) => `${esc(m[0])}<span class="vi">${esc(m[1])}</span>`;
  const plain = (m) => `${m[0]}\n${m[1]}`;
  function toast(msg, isErr) {
    const t = $('toast');
    t.innerHTML = html(msg);
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = isErr ? 'err' : ''; }, 3200);
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 前回値と画面更新 ---------- */
  async function refresh() {
    const [pending, sent, serverLast, cfg] = await Promise.all([
      S.pending(), S.recentSent(10), S.getLast(), S.getConfig()
    ]);

    const candidates = [serverLast, pending[pending.length - 1], sent[0]].filter(Boolean);
    candidates.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    lastRef = candidates[0] || null;

    if (lastRef) {
      $('lastVal').innerHTML = `${Number(lastRef.meter).toFixed(1)}<small>h</small>`;
      $('lastMeta').textContent = `${fmt(lastRef.recordedAt)}　${lastRef.recorder || ''}`;
    } else {
      $('lastVal').innerHTML = '—<small>h</small>';
      $('lastMeta').innerHTML = html(T('まだ記録がありません', 'Chưa có dữ liệu'));
    }

    $('pendingList').innerHTML = pending.length
      ? pending.slice().reverse().map(r =>
          `<li><span><span class="v">${Number(r.meter).toFixed(1)} h</span><br><span class="m">${esc(r.recorder)}${r.note ? '・' + esc(r.note) : ''}</span></span><span class="m">${fmt(r.recordedAt)}</span></li>`
        ).join('')
      : `<li class="empty">${html(T('ありません', 'Không có'))}</li>`;

    $('sentList').innerHTML = sent.length
      ? sent.map(r =>
          `<li><span class="v">${Number(r.meter).toFixed(1)} h</span><span class="m">${fmt(r.recordedAt)}　${esc(r.recorder)}</span></li>`
        ).join('')
      : `<li class="empty">${html(T('まだありません', 'Chưa có'))}</li>`;

    const st = $('status');
    if (pending.length) { st.innerHTML = html(T(`未送信 ${pending.length}件`, `Chưa gửi ${pending.length}`)); st.className = 'pill pending'; }
    else { st.innerHTML = html(T('送信済み', 'Đã gửi')); st.className = 'pill'; }

    $('setupBanner').style.display = (cfg.url && cfg.token) ? 'none' : 'block';
    updateCalc();
  }

  function updateCalc() {
    const box = $('calc');
    const v = parseMeter($('meter').value);
    box.className = 'calc';
    if ($('meter').value.trim() === '') { box.innerHTML = html(T('数値を入れると、前回からの稼働時間が出ます', 'Nhập số để xem thời gian chạy từ lần trước')); return; }
    if (isNaN(v)) { box.className = 'calc warn'; box.innerHTML = html(T('数字で入力してください', 'Hãy nhập bằng số')); return; }
    if (!lastRef) { box.innerHTML = html(T('初回の記録です（次回から稼働時間が出ます）', 'Lần ghi đầu tiên (từ lần sau sẽ hiện thời gian chạy)')); return; }

    const run = v - Number(lastRef.meter);
    const at = new Date($('at').value);
    const elapsed = (at - new Date(lastRef.recordedAt)) / 3600000;

    if (run < 0) {
      box.className = 'calc warn';
      const p = Number(lastRef.meter).toFixed(1);
      box.innerHTML = html(T(`前回（${p}）より小さい値です。見間違いがないか確認してください`, `Nhỏ hơn lần trước (${p}). Hãy kiểm tra lại số.`));
      return;
    }
    if (elapsed > 0 && run > elapsed + 0.2) {
      box.className = 'calc warn';
      box.innerHTML = `稼働 <b>${run.toFixed(1)}h</b> が経過時間 ${elapsed.toFixed(1)}h を超えています。値を確認してください` +
        `<span class="vi">Thời gian chạy ${run.toFixed(1)}h lớn hơn thời gian đã qua ${elapsed.toFixed(1)}h. Hãy kiểm tra lại số.</span>`;
      return;
    }
    const rate = elapsed > 0 ? Math.round(run / elapsed * 100) : null;
    box.innerHTML = `前回から 稼働 <b>${run.toFixed(1)}h</b>　/ 経過 ${elapsed.toFixed(1)}h` + (rate !== null ? `（稼働率 ${rate}%）` : '') +
      `<span class="vi">Từ lần trước: chạy ${run.toFixed(1)}h / đã qua ${elapsed.toFixed(1)}h` + (rate !== null ? ` (tỷ lệ chạy ${rate}%)` : '') + `</span>`;
  }

  /* ---------- 記録 ---------- */
  async function onSubmit(ev) {
    ev.preventDefault();
    const meter = parseMeter($('meter').value);
    const at = new Date($('at').value);
    const recorder = $('recorder').value.trim();

    if (isNaN(meter)) { toast(T('メーター値を数字で入れてください', 'Hãy nhập số đồng hồ bằng số'), true); $('meter').focus(); return; }
    if (isNaN(at.getTime())) { toast(T('記録時刻を入れてください', 'Hãy nhập thời gian ghi'), true); return; }
    if (!recorder) { toast(T('記録者を入れてください', 'Hãy nhập tên người ghi'), true); $('recorder').focus(); return; }
    if (at - Date.now() > 10 * 60000) { toast(T('未来の時刻になっています', 'Thời gian ghi đang ở tương lai'), true); return; }

    if (lastRef) {
      const run = meter - Number(lastRef.meter);
      const elapsed = (at - new Date(lastRef.recordedAt)) / 3600000;
      const p = Number(lastRef.meter).toFixed(1);
      if (run < 0 && !confirm(plain(T(`前回の値（${p}）より小さいです。このまま記録しますか？`, `Nhỏ hơn lần trước (${p}). Vẫn lưu?`)))) return;
      if (elapsed > 0 && run > elapsed + 0.2 && !confirm(plain(T('稼働時間が経過時間より長くなっています。このまま記録しますか？', 'Thời gian chạy dài hơn thời gian đã qua. Vẫn lưu?')))) return;
    }

    const cfg = await S.getConfig();
    const rec = {
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)),
      recordedAt: at.toISOString(),
      meter: meter,
      recorder: recorder,
      device: cfg.device || '',
      note: $('note').value.trim(),
      createdAt: new Date().toISOString()
    };
    await S.enqueue(rec);
    await rememberRecorder(recorder);

    $('meter').value = '';
    $('note').value = '';
    $('at').value = toLocalInput(new Date());
    toast(T('端末に保存しました。WiFiで自動送信します', 'Đã lưu trong máy. Sẽ tự gửi khi có WiFi.'));
    await refresh();
    requestSync();
  }

  async function rememberRecorder(name) {
    const cfg = await S.getConfig();
    const names = [name].concat((cfg.recorders || []).filter(n => n !== name)).slice(0, 10);
    await S.setConfig({ recorder: name, recorders: names });
    fillRecorders(names);
  }
  function fillRecorders(names) {
    $('recorderList').innerHTML = (names || []).map(n => `<option value="${esc(n)}">`).join('');
  }

  /* ---------- 送信 ---------- */
  async function requestSync(manual) {
    // Android Chrome：Background Sync に任せる（アプリを閉じても電波復帰で送信）
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'sync' in reg) await reg.sync.register('send-records');
    } catch (e) { /* 非対応なら下で直接送る */ }
    // 画面が開いている間は自分でも送る
    await syncNow(manual);
  }

  async function syncNow(manual) {
    if (syncing) return;
    const cfg = await S.getConfig();
    if (!cfg.url || !cfg.token) { if (manual) toast(T('先に設定を入れてください', 'Hãy cài đặt trước'), true); return; }
    syncing = true;
    $('syncBtn').disabled = true; $('syncBtn').innerHTML = html(T('送信中…', 'Đang gửi…'));
    try {
      const r = await S.syncPending();
      if (r.sent) toast(T(`${r.sent}件 送信しました`, `Đã gửi ${r.sent} bản ghi`));
      else if (manual) toast(T('送信するものはありません（最新値を更新しました）', 'Không có gì để gửi (đã cập nhật số mới nhất)'));
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === 'TOKEN_INVALID') toast(T('合言葉が違います。設定を確認してください', 'Sai mật mã. Hãy kiểm tra cài đặt.'), true);
      else if (manual) toast(T('送信できませんでした。WiFiを確認してください', 'Không gửi được. Hãy kiểm tra WiFi.'), true);
    } finally {
      syncing = false;
      $('syncBtn').disabled = false; $('syncBtn').innerHTML = html(T('今すぐ送信', 'Gửi ngay'));
      await refresh();
    }
  }

  /* ---------- 設定 ---------- */
  async function loadSettings() {
    const cfg = await S.getConfig();
    $('cfgUrl').value = cfg.url || '';
    $('cfgToken').value = cfg.token || '';
    $('cfgDevice').value = cfg.device || '';
    $('recorder').value = cfg.recorder || '';
    fillRecorders(cfg.recorders);
  }

  async function saveSettings() {
    const url = $('cfgUrl').value.trim();
    const token = $('cfgToken').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast(T('送信先URLが正しくありません', 'URL không đúng'), true); return; }
    if (!token) { toast(T('合言葉を入れてください', 'Hãy nhập mật mã'), true); return; }
    await S.setConfig({ url, token, device: $('cfgDevice').value.trim() });
    toast(T('保存しました。接続テスト中…', 'Đã lưu. Đang kiểm tra kết nối…'));
    try {
      const data = await S.post({ url, token }, { action: 'last' }, 15000);
      if (data.last) await S.setLast(data.last);
      toast(T('接続OK！', 'Kết nối OK!'));
    } catch (e) {
      toast(String(e.message) === 'TOKEN_INVALID' ? T('合言葉が違います', 'Sai mật mã') : T('接続できませんでした（WiFiで再試行してください）', 'Không kết nối được (thử lại khi có WiFi)'), true);
    }
    await refresh();
  }

  async function copySetupLink() {
    const cfg = await S.getConfig();
    if (!cfg.url || !cfg.token) { toast(T('先にこの端末の設定を保存してください', 'Hãy lưu cài đặt máy này trước'), true); return; }
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ url: cfg.url, token: cfg.token }))));
    const link = location.origin + location.pathname + '#setup=' + payload;
    try { await navigator.clipboard.writeText(link); toast(T('設定リンクをコピーしました', 'Đã sao chép link cài đặt')); }
    catch (e) { prompt(plain(T('このリンクを他のスマホに送ってください', 'Hãy gửi link này cho máy khác')), link); }
  }

  /** 設定リンク（#setup=...）から開いたとき */
  async function applySetupFromHash() {
    const m = location.hash.match(/setup=([^&]+)/);
    if (!m) return;
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (obj.url && obj.token) {
        await S.setConfig({ url: obj.url, token: obj.token });
        toast(T('設定を読み込みました。端末の名前を入れてください', 'Đã nhận cài đặt. Hãy nhập tên máy.'));
        $('settings').open = true;
      }
    } catch (e) { toast(T('設定リンクが読み取れませんでした', 'Không đọc được link cài đặt'), true); }
    history.replaceState(null, '', location.pathname);
  }

  /* ---------- 起動 ---------- */
  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'synced') {
          const d = e.data.detail || {};
          if (d.sent) toast(T(`${d.sent}件 送信しました`, `Đã gửi ${d.sent} bản ghi`));
          refresh();
        }
      });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    $('at').value = toLocalInput(new Date());
    $('form').addEventListener('submit', onSubmit);
    $('meter').addEventListener('input', updateCalc);
    $('at').addEventListener('input', updateCalc);
    $('nowBtn').addEventListener('click', () => { $('at').value = toLocalInput(new Date()); updateCalc(); });
    $('syncBtn').addEventListener('click', () => requestSync(true));
    $('saveCfg').addEventListener('click', saveSettings);
    $('copyLink').addEventListener('click', copySetupLink);

    window.addEventListener('online', () => requestSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!$('meter').value) $('at').value = toLocalInput(new Date());
        requestSync();
      }
    });

    await applySetupFromHash();
    await loadSettings();
    await refresh();
    requestSync();
  }

  init();
})();
