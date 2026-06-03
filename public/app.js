const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
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
  bal.style.color = stats.balance >= 0 ? 'var(--income-bg)' : '#ffb4a2';
  card.querySelector('[data-income]').textContent = `+${formatEuro(stats.income)}`;
  card.querySelector('[data-expense]').textContent = `−${formatEuro(stats.expense)}`;
}

function renderStatsBalanceSummary(personal, family) {
  const wrap = $('#stats-balance-summary');
  const name = escapeHtml(state.user?.name || 'Du');
  wrap.innerHTML = `
    <div class="stats-balance-mini stats-balance-mini--family">
      <span class="balance-tag">Haushalt</span>
      <div class="amount-md">${formatEuro(family.balance)}</div>
      <div class="tx-meta">+${formatEuro(family.income).replace('€', '').trim()} / −${formatEuro(family.expense).replace('€', '').trim()} €</div>
    </div>
    <div class="stats-balance-mini stats-balance-mini--personal">
      <span class="balance-tag">${name}</span>
      <div class="amount-md">${formatEuro(personal.balance)}</div>
      <div class="tx-meta">+${formatEuro(personal.income).replace('€', '').trim()} / −${formatEuro(personal.expense).replace('€', '').trim()} €</div>
    </div>
  `;
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}

function currentMonth() {
  return $('#filter-month')?.value || new Date().toISOString().slice(0, 7);
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
    if (name === 'stats') drawStats();
    if (name === 'home') loadHome();
  });
});

// --- Categories & form ---

async function initApp() {
  const monthInput = $('#filter-month');
  monthInput.value = new Date().toISOString().slice(0, 7);
  monthInput.addEventListener('change', loadHome);

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

  $('#month-label').textContent = monthLabel(month);
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
    <li class="tx-item ${tx.type}">
      <span class="tx-icon">${categoryIcon(tx.category)}</span>
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(tx.description || tx.category || 'Buchung')}</div>
        <div class="tx-meta">${formatDate(tx.date)} · ${escapeHtml(tx.category || '—')}${tx.source === 'ai' ? ' · KI' : ''}</div>
      </div>
      <span class="tx-amount">${tx.type === 'income' ? '+' : '−'}${formatEuro(tx.amount).replace('€', '').trim()} €</span>
      <button type="button" class="tx-delete" data-id="${tx.id}" aria-label="Löschen">×</button>
    </li>
  `).join('');

  list.querySelectorAll('.tx-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Buchung löschen?')) return;
      await api(`/api/transactions/${btn.dataset.id}`, { method: 'DELETE' });
      toast('Gelöscht');
      loadHome();
    });
  });
}

async function onSaveTx(e) {
  e.preventDefault();
  const type = $('input[name="type"]:checked').value;
  try {
    await api('/api/transactions', {
      method: 'POST',
      body: {
        type,
        amount: Number($('#tx-amount').value),
        category: $('#tx-category').value,
        description: $('#tx-description').value,
        date: $('#tx-date').value,
        source: $('#tx-source').value,
      },
    });
    toast('Gespeichert');
    $('#tx-amount').value = '';
    $('#tx-description').value = '';
    state.receiptFile = null;
    state.receiptPath = null;
    $('#receipt-preview-wrap').classList.add('hidden');
    $('#btn-parse-receipt').disabled = true;
    $$('.tab').find((t) => t.dataset.tab === 'home')?.click();
    loadHome();
  } catch (ex) {
    toast(ex.message);
  }
}

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
    btn.addEventListener('click', () => {
      $$('.mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      $('#tx-form').classList.toggle('hidden', mode !== 'manual');
      $('#voice-panel').classList.toggle('hidden', mode !== 'voice');
      $('#receipt-panel').classList.toggle('hidden', mode !== 'receipt');
      if (mode === 'manual') {
        $('#tx-form').classList.remove('hidden');
      }
    });
  });
}

// --- Voice ---

const SPEECH_ERRORS = {
  'not-allowed': 'Mikrofon blockiert – in den Browser-Einstellungen erlauben.',
  'service-not-allowed': 'Browser-Sprache nur mit https:// oder localhost (nicht per IP).',
  network: 'Netzwerk nötig – Chrome nutzt Google-Server für die Spracherkennung.',
  'no-speech': 'Nichts gehört – bitte erneut und deutlicher sprechen.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  aborted: null,
};

async function ensureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Mikrofon wird von diesem Browser nicht unterstützt');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

function pickAudioMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (!window.MediaRecorder) return null;
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function setupVoice() {
  const secureHint = $('#voice-hint-secure');
  if (!window.isSecureContext) {
    secureHint.textContent = 'Ohne HTTPS funktioniert die Browser-Sprache oft nicht – nutze „Aufnahme starten“.';
    secureHint.classList.remove('hidden');
  }

  setupVoiceRecording();
  setupBrowserSpeech();

  $('#btn-parse-voice').addEventListener('click', async () => {
    const text = $('#voice-text').value.trim();
    if (!text) return toast('Bitte sprechen, aufnehmen oder Text eingeben');
    setAiStatus('KI wertet aus…');
    try {
      const parsed = await api('/api/ai/parse-text', { method: 'POST', body: { text } });
      fillFormFromParsed(parsed);
      $$('.mode-btn').find((b) => b.dataset.mode === 'manual')?.click();
      $('#tx-form').classList.remove('hidden');
    } catch (ex) {
      toast(ex.message);
    } finally {
      setAiStatus('');
    }
  });
}

function setupVoiceRecording() {
  const btn = $('#btn-voice-record');
  const label = $('#record-label');
  let mediaRecorder = null;
  let chunks = [];
  let mimeType = '';

  btn.addEventListener('click', async () => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
      return;
    }

    try {
      await ensureMicrophone();
    } catch (ex) {
      toast(ex.message);
      return;
    }

    mimeType = pickAudioMimeType();
    if (!mimeType) {
      toast('Audio-Aufnahme wird von diesem Browser nicht unterstützt');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        btn.classList.remove('recording');
        label.textContent = 'Aufnahme starten (empfohlen)';

        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 500) {
          toast('Aufnahme zu kurz – bitte erneut sprechen');
          return;
        }

        setAiStatus('Gemini hört zu…');
        const fd = new FormData();
        fd.append('audio', blob, `voice.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
        try {
          const parsed = await api('/api/ai/parse-audio', { method: 'POST', body: fd });
          if (parsed.description) {
            $('#voice-text').value = parsed.description;
          }
          fillFormFromParsed(parsed);
          $$('.mode-btn').find((b) => b.dataset.mode === 'manual')?.click();
          $('#tx-form').classList.remove('hidden');
        } catch (ex) {
          toast(ex.message);
        } finally {
          setAiStatus('');
        }
      };
      mediaRecorder.start();
      btn.classList.add('recording');
      label.textContent = 'Stoppen & auswerten…';
      setTimeout(() => {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
      }, 15000);
    } catch (ex) {
      toast(ex.message || 'Aufnahme fehlgeschlagen');
    }
  });
}

function setupBrowserSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#btn-voice');
  const label = $('#voice-label');

  if (!SpeechRecognition) {
    label.textContent = 'Browser-Sprache nicht verfügbar (Firefox)';
    btn.disabled = true;
    return;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'de-DE';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let active = false;

  rec.onresult = (ev) => {
    let text = '';
    for (const r of ev.results) text += r[0].transcript;
    $('#voice-text').value = text.trim();
  };

  rec.onend = () => {
    active = false;
    btn.classList.remove('listening');
    label.textContent = 'Browser-Sprache (Chrome)';
  };

  rec.onerror = (ev) => {
    active = false;
    btn.classList.remove('listening');
    label.textContent = 'Browser-Sprache (Chrome)';
    const msg = SPEECH_ERRORS[ev.error];
    if (msg) toast(msg);
  };

  btn.addEventListener('click', async () => {
    if (active) {
      rec.stop();
      return;
    }

    if (!window.isSecureContext) {
      toast('Browser-Sprache braucht localhost oder HTTPS – nutze „Aufnahme starten“.');
      return;
    }

    try {
      await ensureMicrophone();
    } catch (ex) {
      toast(ex.message);
      return;
    }

    try {
      rec.start();
      active = true;
      btn.classList.add('listening');
      label.textContent = 'Hört zu… (nochmal tippen = Stopp)';
    } catch {
      rec.stop();
      setTimeout(() => {
        try {
          rec.start();
          active = true;
          btn.classList.add('listening');
          label.textContent = 'Hört zu…';
        } catch {
          toast('Spracherkennung konnte nicht gestartet werden');
        }
      }, 300);
    }
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
      $$('.mode-btn').find((b) => b.dataset.mode === 'manual')?.click();
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

async function drawStats() {
  const month = currentMonth();
  const [trends, { personal, family }] = await Promise.all([
    api('/api/stats/trends?months=6'),
    api(`/api/stats/monthly?month=${month}`),
  ]);
  renderStatsBalanceSummary(personal, family);
  drawTrendChart(trends);
  drawCategoryBars(personal.byCategory);
}

function drawTrendChart(rows) {
  const canvas = $('#chart-trend');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth - 8;
  const h = 140;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);

  const months = [...new Set(rows.map((r) => r.month))].sort();
  if (!months.length) {
    ctx.fillStyle = '#5c6b66';
    ctx.font = '13px DM Sans, sans-serif';
    ctx.fillText('Noch keine Daten', 12, h / 2);
    return;
  }

  const incomeByMonth = Object.fromEntries(rows.filter((r) => r.type === 'income').map((r) => [r.month, r.total]));
  const expenseByMonth = Object.fromEntries(rows.filter((r) => r.type === 'expense').map((r) => [r.month, r.total]));
  const max = Math.max(...months.map((m) => (incomeByMonth[m] || 0) + (expenseByMonth[m] || 0)), 1);

  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;
  const barW = chartW / months.length * 0.55;
  const gap = chartW / months.length;

  months.forEach((m, i) => {
    const x = pad.l + i * gap + (gap - barW) / 2;
    const exp = expenseByMonth[m] || 0;
    const inc = incomeByMonth[m] || 0;
    const expH = (exp / max) * chartH;
    const incH = (inc / max) * chartH;
    const baseY = pad.t + chartH;

    ctx.fillStyle = '#9b2226';
    ctx.fillRect(x, baseY - expH, barW / 2 - 1, expH);
    ctx.fillStyle = '#2d6a4f';
    ctx.fillRect(x + barW / 2 + 1, baseY - incH, barW / 2 - 1, incH);

    ctx.fillStyle = '#5c6b66';
    ctx.font = '10px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    const label = m.slice(5);
    ctx.fillText(label, x + barW / 2, h - 6);
  });

  ctx.font = '10px DM Sans, sans-serif';
  ctx.fillStyle = '#9b2226';
  ctx.fillText('Ausgaben', pad.l, 10);
  ctx.fillStyle = '#2d6a4f';
  ctx.fillText('Einnahmen', pad.l + 58, 10);
}

function drawCategoryBars(categories) {
  const wrap = $('#category-bars');
  if (!categories?.length) {
    wrap.innerHTML = '<p class="empty">Keine Ausgaben in diesem Monat.</p>';
    return;
  }
  const max = Math.max(...categories.map((c) => c.total));
  wrap.innerHTML = categories.map((c) => `
    <div class="cat-row">
      <span>${escapeHtml(c.category || 'Sonstiges')}</span>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${(c.total / max) * 100}%"></div>
      </div>
      <span class="cat-amount">${formatEuro(c.total)}</span>
    </div>
  `).join('');
}

boot().catch(() => showScreen('login'));
