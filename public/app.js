const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  editingId: null,
  statsScope: 'family',
  statsCache: null,
  receiptFile: null,
  receiptPath: null,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData
      ? options.body
      : options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${id}`)?.classList.add('active');
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('show');
  }, 2800);
}

function formatEuro(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function monthLabel(month) {
  return new Date(month + '-01T12:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function fillBalanceCard(scope, stats) {
  const card = $(`[data-balance-card="${scope}"]`);
  if (!card) return;
  const bal = card.querySelector('[data-balance]');
  bal.textContent = formatEuro(stats.balance);
  bal.style.color = '';
  card.querySelector('[data-income]').textContent = `+${formatEuro(stats.income)}`;
  card.querySelector('[data-expense]').textContent = `−${formatEuro(stats.expense)}`;
}

function renderStatsBalanceSummary(stats, label) {
  const wrap = $('#stats-balance-summary');
  const scopeClass = state.statsScope === 'family' ? 'family' : 'personal';
  wrap.innerHTML = `
    <div class="stats-balance-mini stats-balance-mini--${scopeClass}">
      <span class="balance-tag">${escapeHtml(label)}</span>
      <div class="amount-md">${formatEuro(stats.balance)}</div>
      <div class="tx-meta">+${formatEuro(stats.income).replace('€', '').trim()} / −${formatEuro(stats.expense).replace('€', '').trim()} €</div>
    </div>
  `;
}

const EMPTY_STATS = { income: 0, expense: 0, balance: 0, byCategory: [], daily: [] };

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}

function currentMonth() {
  const statsMonth = $('#stats-month');
  const homeMonth = $('#filter-month');
  if ($('#panel-stats')?.classList.contains('active') && statsMonth?.value) {
    return statsMonth.value;
  }
  return homeMonth?.value || new Date().toISOString().slice(0, 7);
}

function syncMonthPickers(value) {
  const v = value || new Date().toISOString().slice(0, 7);
  if ($('#filter-month')) $('#filter-month').value = v;
  if ($('#stats-month')) $('#stats-month').value = v;
  state.statsCache = null;
}

function categoryIcon(cat) {
  const map = {
    Lebensmittel: '🛒', Restaurant: '🍽️', Transport: '🚌', Wohnen: '🏠',
    Gesundheit: '💊', Freizeit: '🎬', Shopping: '🛍️', Abos: '📱',
    Gehalt: '💼', Sonstiges: '•',
  };
  return map[cat] || '•';
}

// --- Auth ---

$('#login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    await api('/api/auth/login', { method: 'POST', body: { password: $('#app-password').value } });
    await boot();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

$('#btn-logout')?.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  showScreen('login');
});

async function boot() {
  const status = await api('/api/auth/status');
  if (!status.authenticated) {
    showScreen('login');
    return;
  }
  if (!status.user) {
    await loadUsers();
    showScreen('users');
    return;
  }
  state.user = status.user;
  $('#user-name').textContent = status.user.name;
  $('#personal-balance-tag').textContent = status.user.name;
  state.statsScope = `user:${status.user.id}`;
  initApp();
  showScreen('app');
}

async function loadUsers() {
  const users = await api('/api/users');
  const list = $('#user-list');
  list.innerHTML = users.map((u) => `
    <li><button type="button" data-user-id="${u.id}">${escapeHtml(u.name)}</button></li>
  `).join('');
  list.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = await api('/api/users/select', {
        method: 'POST',
        body: { userId: Number(btn.dataset.userId) },
      });
      state.user = user;
      $('#user-name').textContent = user.name;
      $('#personal-balance-tag').textContent = user.name;
      state.statsScope = `user:${user.id}`;
      initApp();
      showScreen('app');
    });
  });
}

$('#new-user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#new-user-name');
  try {
    await api('/api/users', { method: 'POST', body: { name: input.value } });
    input.value = '';
    await loadUsers();
    await buildStatsScopePicker();
    toast('Profil angelegt');
  } catch (ex) {
    toast(ex.message);
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Tabs ---

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    $$('.panel').forEach((p) => p.classList.remove('active'));
    $(`#panel-${name}`)?.classList.add('active');
    if (name === 'stats') requestAnimationFrame(() => drawStats());
    if (name === 'home') loadHome();
    if (name === 'add') {
      if (state.editingId) setAddMode('manual');
      else {
        resetTxForm();
        setAddMode('voice');
      }
    }
  });
});

function setAddMode(mode) {
  $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#tx-form').classList.toggle('hidden', mode !== 'manual');
  $('#voice-panel').classList.toggle('hidden', mode !== 'voice');
  $('#receipt-panel').classList.toggle('hidden', mode !== 'receipt');
}

// --- Categories & form ---

async function initApp() {
  const month = new Date().toISOString().slice(0, 7);
  syncMonthPickers(month);
  $('#filter-month').addEventListener('change', (e) => {
    syncMonthPickers(e.target.value);
    loadHome();
  });
  $('#stats-month').addEventListener('change', (e) => {
    syncMonthPickers(e.target.value);
    if ($('#panel-stats').classList.contains('active')) drawStats();
    else loadHome();
  });

  setupStatsScope();
  await buildStatsScopePicker();

  const cats = await api('/api/categories');
  const sel = $('#tx-category');
  sel.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');

  $('#tx-date').value = new Date().toISOString().slice(0, 10);

  $('#tx-form').addEventListener('submit', onSaveTx);
  setupAddModes();
  setupVoice();
  setupReceipt();

  loadHome();
}

async function loadHome() {
  const month = currentMonth();
  const [{ personal, family }, txs] = await Promise.all([
    api(`/api/stats/monthly?month=${month}`),
    api(`/api/transactions?month=${month}&limit=100`),
  ]);

  $('#month-label').textContent = `Buchungen · ${monthLabel(month)}`;
  if (state.user?.name) $('#personal-balance-tag').textContent = state.user.name;
  fillBalanceCard('family', family);
  fillBalanceCard('personal', personal);

  const list = $('#tx-list');
  const empty = $('#tx-empty');
  if (!txs.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = txs.map((tx) => `
    <li class="tx-item ${tx.type}" data-id="${tx.id}">
      <button type="button" class="tx-open" data-id="${tx.id}" aria-label="Buchung bearbeiten">
        <span class="tx-icon">${categoryIcon(tx.category)}</span>
        <span class="tx-main">
          <span class="tx-title">${escapeHtml(tx.description || tx.category || 'Buchung')}</span>
          <span class="tx-meta">${formatDate(tx.date)} · ${escapeHtml(tx.category || '—')}${tx.source === 'ai' ? ' · KI' : ''}</span>
        </span>
        <span class="tx-amount">${tx.type === 'income' ? '+' : '−'}${formatEuro(tx.amount).replace('€', '').trim()} €</span>
      </button>
      <button type="button" class="tx-delete" data-id="${tx.id}" aria-label="Löschen">×</button>
    </li>
  `).join('');

  list.querySelectorAll('.tx-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = txs.find((t) => String(t.id) === btn.dataset.id);
      if (tx) openEditTx(tx);
    });
  });

  list.querySelectorAll('.tx-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Buchung löschen?')) return;
      await api(`/api/transactions/${btn.dataset.id}`, { method: 'DELETE' });
      toast('Gelöscht');
      state.statsCache = null;
      loadHome();
    });
  });
}

async function onSaveTx(e) {
  e.preventDefault();
  const type = $('input[name="type"]:checked').value;
  const body = {
    type,
    amount: Number($('#tx-amount').value),
    category: $('#tx-category').value,
    description: $('#tx-description').value,
    date: $('#tx-date').value,
  };
  try {
    if (state.editingId) {
      await api(`/api/transactions/${state.editingId}`, { method: 'PUT', body });
      toast('Aktualisiert');
    } else {
      await api('/api/transactions', {
        method: 'POST',
        body: { ...body, source: $('#tx-source').value },
      });
      toast('Gespeichert');
      $('#tx-amount').value = '';
      $('#tx-description').value = '';
      state.receiptFile = null;
      state.receiptPath = null;
      $('#receipt-preview-wrap').classList.add('hidden');
      $('#btn-parse-receipt').disabled = true;
    }
    resetTxForm();
    state.statsCache = null;
    $$('.tab').find((t) => t.dataset.tab === 'home')?.click();
    loadHome();
  } catch (ex) {
    toast(ex.message);
  }
}

function resetTxForm() {
  state.editingId = null;
  $('#tx-form-title').classList.add('hidden');
  $('#tx-cancel-edit').classList.add('hidden');
  $('#tx-submit-btn').textContent = 'Speichern';
  $('#tx-source').value = 'manual';
}

function openEditTx(tx) {
  state.editingId = tx.id;
  $(`input[name="type"][value="${tx.type}"]`).checked = true;
  $('#tx-amount').value = tx.amount;
  const catSel = $('#tx-category');
  if ([...catSel.options].some((o) => o.value === tx.category)) {
    catSel.value = tx.category;
  } else {
    catSel.value = 'Sonstiges';
  }
  $('#tx-description').value = tx.description || '';
  $('#tx-date').value = tx.date;
  $('#tx-source').value = tx.source || 'manual';
  $('#tx-form-title').classList.remove('hidden');
  $('#tx-cancel-edit').classList.remove('hidden');
  $('#tx-submit-btn').textContent = 'Änderung speichern';
  $$('.tab').find((t) => t.dataset.tab === 'add')?.click();
}

$('#tx-cancel-edit')?.addEventListener('click', () => {
  resetTxForm();
  $$('.tab').find((t) => t.dataset.tab === 'home')?.click();
});

function fillFormFromParsed(p) {
  $(`input[name="type"][value="${p.type}"]`).checked = true;
  $('#tx-amount').value = p.amount;
  const catSel = $('#tx-category');
  if ([...catSel.options].some((o) => o.value === p.category)) {
    catSel.value = p.category;
  }
  $('#tx-description').value = p.description || '';
  $('#tx-date').value = p.date;
  $('#tx-source').value = 'ai';
  toast(`KI-Vorschlag (${Math.round((p.confidence || 0.8) * 100)} % sicher) – bitte prüfen`);
}

// --- Add modes ---

function setupAddModes() {
  $$('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setAddMode(btn.dataset.mode));
  });
  setAddMode('voice');
}

// --- Voice ---

function pickAudioMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (!window.MediaRecorder) return null;
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function createWaveform(canvas, stream) {
  const ctx = canvas.getContext('2d');
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.82;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let raf = null;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 280;
    const h = 56;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    analyser.getByteFrequencyData(buffer);

    ctx.clearRect(0, 0, w, h);

    const bars = 38;
    const gap = 3;
    const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
    const center = (bars - 1) / 2;

    let energy = 0;
    for (let i = 0; i < buffer.length / 3; i += 1) energy += buffer[i];
    const avg = energy / (buffer.length / 3) / 255;

    for (let i = 0; i < bars; i += 1) {
      const dist = Math.abs(i - center) / center;
      const freqIdx = Math.min(
        Math.floor(dist * dist * buffer.length * 0.4),
        buffer.length - 1,
      );
      const v = buffer[freqIdx] / 255;
      const centerWeight = 1 - dist * 0.55;
      const amp = Math.min(1, v * centerWeight + avg * (1 - dist) * 0.4);
      const barH = Math.max(3, amp * h * 0.92);
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      const alpha = amp > 0.08 ? 0.45 + amp * 0.55 : 0.08 + avg * 0.12;
      ctx.fillStyle = amp > 0.08
        ? `rgba(232, 180, 168, ${alpha})`
        : `rgba(255, 255, 255, ${0.06 + avg * 0.14})`;
      ctx.fillRect(x, y, barW, barH);
    }
    raf = requestAnimationFrame(draw);
  }

  return {
    start() {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      draw();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      source.disconnect();
      audioCtx.close().catch(() => {});
    },
  };
}

function setupVoice() {
  setupVoiceRecording();
}

function setupVoiceRecording() {
  const ui = $('#recorder-ui');
  const processing = $('#recorder-processing');
  const btn = $('#btn-voice-record');
  const btnIcon = $('#recorder-btn-icon');
  const hint = $('#recorder-hint');
  const sub = $('#recorder-sub');
  const meter = $('#recorder-meter');
  const timerEl = $('#record-timer');
  const canvas = $('#waveform-canvas');

  let mediaRecorder = null;
  let stream = null;
  let waveform = null;
  let chunks = [];
  let mimeType = '';
  let timerInterval = null;
  let maxTimer = null;
  let startTime = 0;
  let isRecording = false;

  function setRecordingUI(active) {
    isRecording = active;
    btn.classList.toggle('recording', active);
    btn.setAttribute('aria-label', active ? 'Aufnahme beenden' : 'Aufnahme starten');
    btnIcon.textContent = active ? '⏹' : '🎙';
    hint.textContent = active ? 'Erneut tippen zum Beenden' : 'Tippen zum Aufnehmen';
    sub.textContent = active
      ? 'Sprich jetzt deine Buchung …'
      : 'Max. 15 Sek. · erneut tippen zum Beenden';
    meter.classList.toggle('hidden', !active);
  }

  function showProcessing(active) {
    ui.classList.toggle('hidden', active);
    processing.classList.toggle('hidden', !active);
    btn.disabled = active;
  }

  function clearTimers() {
    if (timerInterval) clearInterval(timerInterval);
    if (maxTimer) clearTimeout(maxTimer);
    timerInterval = null;
    maxTimer = null;
  }

  function updateTimer() {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function releaseMedia() {
    clearTimers();
    waveform?.stop();
    waveform = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function processBlob(blob) {
    if (blob.size < 500) {
      toast('Aufnahme zu kurz – bitte etwas länger sprechen');
      setRecordingUI(false);
      timerEl.textContent = '0:00';
      return;
    }

    showProcessing(true);
    const fd = new FormData();
    fd.append('audio', blob, `voice.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
    try {
      const parsed = await api('/api/ai/parse-audio', { method: 'POST', body: fd });
      fillFormFromParsed(parsed);
      setAddMode('manual');
      $('#tx-form').classList.remove('hidden');
    } catch (ex) {
      toast(ex.message);
    } finally {
      showProcessing(false);
      setRecordingUI(false);
      timerEl.textContent = '0:00';
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  }

  async function startRecording() {
    try {
      mimeType = pickAudioMimeType();
      if (!mimeType) {
        toast('Audio-Aufnahme wird von diesem Browser nicht unterstützt');
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: 16000 },
        },
      });
      chunks = [];
      const recorderOpts = { mimeType, audioBitsPerSecond: 24000 };
      try {
        mediaRecorder = new MediaRecorder(stream, recorderOpts);
      } catch {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        releaseMedia();
        mediaRecorder = null;
        setRecordingUI(false);
        await processBlob(blob);
      };

      mediaRecorder.start(250);
      startTime = Date.now();
      timerEl.textContent = '0:00';
      setRecordingUI(true);
      timerInterval = setInterval(updateTimer, 200);
      waveform = createWaveform(canvas, stream);
      waveform.start();
      maxTimer = setTimeout(stopRecording, 15000);
    } catch (ex) {
      releaseMedia();
      mediaRecorder = null;
      setRecordingUI(false);
      toast(ex.message || 'Mikrofon-Zugriff fehlgeschlagen');
    }
  }

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (isRecording) stopRecording();
    else startRecording();
  });
}

// --- Receipt ---

function setupReceipt() {
  const input = $('#receipt-input');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    state.receiptFile = file;
    const url = URL.createObjectURL(file);
    $('#receipt-preview').src = url;
    $('#receipt-preview-wrap').classList.remove('hidden');
    $('#btn-parse-receipt').disabled = false;
  });

  $('#btn-parse-receipt').addEventListener('click', async () => {
    if (!state.receiptFile) return;
    setAiStatus('Beleg wird analysiert…');
    const fd = new FormData();
    fd.append('receipt', state.receiptFile);
    try {
      const parsed = await api('/api/ai/parse-receipt', { method: 'POST', body: fd });
      state.receiptPath = parsed.receipt_path;
      fillFormFromParsed(parsed);
      setAddMode('manual');
      $('#tx-form').classList.remove('hidden');
    } catch (ex) {
      toast(ex.message);
    } finally {
      setAiStatus('');
    }
  });
}

function setAiStatus(msg) {
  const el = $('#ai-status');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

// --- Charts ---

async function buildStatsScopePicker() {
  const users = await api('/api/users');
  const scopes = [
    { id: 'family', label: 'Haushalt' },
    ...users.map((u) => ({ id: `user:${u.id}`, label: u.name })),
  ];
  if (!scopes.some((s) => s.id === state.statsScope)) {
    state.statsScope = state.user ? `user:${state.user.id}` : 'family';
  }
  const container = $('#stats-scope');
  container.innerHTML = scopes.map((s) => `
    <button type="button" class="segment-btn stats-scope-btn${s.id === state.statsScope ? ' active' : ''}" data-scope="${s.id}">${escapeHtml(s.label)}</button>
  `).join('');
}

let statsScopeEventsBound = false;

function setupStatsScope() {
  if (statsScopeEventsBound) return;
  statsScopeEventsBound = true;
  $('#stats-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.stats-scope-btn');
    if (!btn) return;
    state.statsScope = btn.dataset.scope;
    $$('.stats-scope-btn').forEach((b) => b.classList.toggle('active', b === btn));
    drawStats();
  });
}

function getScopeData(cache) {
  if (state.statsScope === 'family') {
    return { stats: cache.monthly.family, trends: cache.trends.family, label: 'Haushalt' };
  }
  const userId = Number(String(state.statsScope).replace('user:', ''));
  const u = cache.monthly.users.find((x) => x.userId === userId);
  const t = cache.trends.users.find((x) => x.userId === userId);
  return {
    stats: u?.stats || EMPTY_STATS,
    trends: t?.rows || [],
    label: u?.name || '—',
  };
}

async function drawStats() {
  const month = currentMonth();
  if (!state.statsCache || state.statsCache.month !== month) {
    const [trends, monthly] = await Promise.all([
      api('/api/stats/trends?months=6'),
      api(`/api/stats/monthly?month=${month}`),
    ]);
    state.statsCache = { month, trends, monthly };
  }

  const { stats, trends, label } = getScopeData(state.statsCache);
  renderStatsBalanceSummary(stats, label);
  drawTrendChart(trends);
  drawCategoryBars(stats.byCategory);
}

function drawTrendChart(rows) {
  const canvas = $('#chart-trend');
  const wrap = canvas.closest('.trend-wrap');
  const labelsEl = $('#chart-trend-labels');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, wrap.clientWidth);
  const h = 120;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const months = [...new Set(rows.map((r) => r.month))].sort();
  labelsEl.innerHTML = '';
  labelsEl.style.gridTemplateColumns = '';

  if (!months.length) {
    ctx.fillStyle = '#6b7c77';
    ctx.font = '13px Plus Jakarta Sans, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Noch keine Daten', 12, h / 2);
    return;
  }

  labelsEl.style.gridTemplateColumns = `repeat(${months.length}, 1fr)`;
  labelsEl.innerHTML = months.map((m) => `<span class="trend-label">${m.slice(5)}</span>`).join('');

  const incomeByMonth = Object.fromEntries(rows.filter((r) => r.type === 'income').map((r) => [r.month, r.total]));
  const expenseByMonth = Object.fromEntries(rows.filter((r) => r.type === 'expense').map((r) => [r.month, r.total]));
  const max = Math.max(...months.map((m) => Math.max(incomeByMonth[m] || 0, expenseByMonth[m] || 0)), 1);

  const pad = { l: 0, r: 0, t: 16, b: 4 };
  const chartW = w;
  const chartH = h - pad.t - pad.b;
  const slotW = chartW / months.length;
  const barW = Math.max(6, slotW * 0.48);

  months.forEach((m, i) => {
    const slotCenter = slotW * i + slotW / 2;
    const x = slotCenter - barW / 2;
    const exp = expenseByMonth[m] || 0;
    const inc = incomeByMonth[m] || 0;
    const expH = (exp / max) * chartH;
    const incH = (inc / max) * chartH;
    const baseY = pad.t + chartH;
    const half = barW / 2 - 1;

    ctx.fillStyle = '#b84a3a';
    ctx.fillRect(x, baseY - expH, half, expH);
    ctx.fillStyle = '#2f6b57';
    ctx.fillRect(x + half + 2, baseY - incH, half, incH);
  });

  ctx.textAlign = 'left';
  ctx.font = '10px Plus Jakarta Sans, sans-serif';
  ctx.fillStyle = '#b84a3a';
  ctx.fillText('Ausgaben', 0, 11);
  ctx.fillStyle = '#2f6b57';
  ctx.fillText('Einnahmen', 58, 11);
}

function drawCategoryBars(categories) {
  const wrap = $('#category-bars');
  if (!categories?.length) {
    wrap.innerHTML = '<p class="empty">Keine Ausgaben in diesem Monat.</p>';
    return;
  }
  const max = Math.max(...categories.map((c) => c.total));
  wrap.innerHTML = categories.map((c) => {
    const pct = Math.round((c.total / max) * 100);
    return `
    <div class="cat-item">
      <span class="cat-label" title="${escapeHtml(c.category || 'Sonstiges')}">${escapeHtml(c.category || 'Sonstiges')}</span>
      <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
      <span class="cat-amount">${formatEuro(c.total)}</span>
    </div>`;
  }).join('');
}

boot().catch(() => showScreen('login'));
