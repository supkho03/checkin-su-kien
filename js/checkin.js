// Trang check-in: đăng nhập → chọn sự kiện → quét QR / tìm thủ công

const $ = (id) => document.getElementById(id);

const PAUSE_MS = 2000;          // tạm dừng quét sau mỗi lần
const EVENT_KEY = 'checkin.eventId';

let eventId = null;
let scanner = null;             // Html5Qrcode
let scanning = false;
let busy = false;               // đang xử lý một lượt check-in
let searchTimer = null;
let counterTimer = null;

// =====================================================================
// Sự kiện & bộ đếm
// =====================================================================
async function loadEvents() {
  const select = $('event-select');
  select.innerHTML = '<option value="">Đang tải…</option>';
  select.disabled = true;

  try {
    const { data, error } = await db
      .from('events')
      .select('id, name, event_date, is_open')
      .order('event_date', { ascending: false });
    if (error) throw error;

    if (!data.length) {
      select.innerHTML = '<option value="">Chưa có sự kiện nào</option>';
      eventId = null;
      return;
    }

    select.innerHTML = data.map((ev) => {
      const d = new Date(ev.event_date).toLocaleDateString('vi-VN', { timeZone: TZ });
      return `<option value="${ev.id}">${escapeHtml(ev.name)} (${d})${ev.is_open ? '' : ' – đã đóng ĐK'}</option>`;
    }).join('');

    const saved = safeGet(EVENT_KEY);
    if (saved && data.some((ev) => ev.id === saved)) select.value = saved;
    select.disabled = false;
    selectEvent(select.value);
  } catch (err) {
    select.innerHTML = '<option value="">Không tải được sự kiện</option>';
    toast(friendlyError(err), 'error');
  }
}

$('event-select').addEventListener('change', (e) => selectEvent(e.target.value));

function selectEvent(id) {
  eventId = id || null;
  safeSet(EVENT_KEY, eventId || '');
  $('search-input').value = '';
  $('search-results').innerHTML = '';
  $('last-result').hidden = true;
  refreshCounter();
  clearInterval(counterTimer);
  // cập nhật định kỳ khi nhiều nhân viên cùng check-in
  counterTimer = setInterval(refreshCounter, 30000);
}

async function refreshCounter() {
  if (!eventId) return;
  try {
    const [total, checked] = await Promise.all([
      db.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
      db.from('registrations').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).not('checked_in_at', 'is', null),
    ]);
    if (total.error) throw total.error;
    if (checked.error) throw checked.error;
    const t = total.count || 0;
    const c = checked.count || 0;
    $('count-in').textContent = c;
    $('count-total').textContent = t;
    $('count-bar').style.width = t ? `${Math.round((c / t) * 100)}%` : '0%';
  } catch (err) {
    console.error(err);
  }
}

// =====================================================================
// Camera / quét QR
// =====================================================================
$('camera-btn').addEventListener('click', () => {
  unlockAudio();
  scanning ? stopCamera() : startCamera();
});

async function startCamera() {
  const errBox = $('camera-error');
  errBox.hidden = true;

  if (!eventId) {
    toast('Vui lòng chọn sự kiện trước.', 'warning');
    return;
  }
  if (!window.isSecureContext) {
    errBox.textContent = 'Camera chỉ hoạt động khi trang được mở qua HTTPS (hoặc localhost).';
    errBox.hidden = false;
    return;
  }

  const btn = $('camera-btn');
  btn.disabled = true;
  $('reader').hidden = false;
  $('camera-placeholder').hidden = true;

  try {
    scanner = scanner || new Html5Qrcode('reader', { verbose: false });
    await scanner.start(
      { facingMode: 'environment' },   // ưu tiên camera sau
      {
        fps: 10,
        qrbox: (w, h) => {
          const size = Math.floor(Math.min(w, h) * 0.7);
          return { width: size, height: size };
        },
      },
      onScan,
      () => {} // bỏ qua lỗi "không thấy QR" ở mỗi khung hình
    );
    scanning = true;
    btn.textContent = 'Tắt camera';
    btn.classList.add('btn-light');
  } catch (err) {
    console.error(err);
    $('reader').hidden = true;
    $('camera-placeholder').hidden = false;
    errBox.textContent = cameraErrorMessage(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function stopCamera() {
  if (scanner && scanning) {
    try { await scanner.stop(); } catch (_) { /* đã dừng */ }
  }
  scanning = false;
  $('reader').hidden = true;
  $('camera-placeholder').hidden = false;
  const btn = $('camera-btn');
  btn.textContent = 'Bật camera';
  btn.classList.remove('btn-light');
}

function cameraErrorMessage(err) {
  const s = String(err && (err.name || err.message || err));
  if (/NotAllowed|Permission/i.test(s)) {
    return 'Bạn chưa cho phép dùng camera. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ, cho phép Camera rồi thử lại.';
  }
  if (/NotFound|Requested device not found|OverconstrainedError/i.test(s)) {
    return 'Không tìm thấy camera trên thiết bị này.';
  }
  if (/NotReadable|in use/i.test(s)) {
    return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.';
  }
  return 'Không bật được camera. Vui lòng thử lại hoặc dùng ô tìm kiếm để check-in thủ công.';
}

async function onScan(text) {
  if (busy) return;
  busy = true;
  try { scanner.pause(true); } catch (_) { /* bỏ qua */ }

  try {
    await checkInByCode(String(text).trim());
  } finally {
    setTimeout(() => {
      busy = false;
      if (scanning) {
        try { scanner.resume(); } catch (_) { /* bỏ qua */ }
      }
    }, PAUSE_MS);
  }
}

// =====================================================================
// Logic check-in
// =====================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REG_FIELDS = 'id, event_id, full_name, organization, phone, checked_in_at';

async function checkInByCode(code) {
  if (!UUID_RE.test(code)) {
    showResult('error', { title: 'Mã QR không hợp lệ', detail: 'Đây không phải vé của hệ thống.' });
    return;
  }

  try {
    // Tìm theo ticket_code (không lọc event_id) để phân biệt "không tồn tại" và "sai sự kiện"
    const { data: reg, error } = await db
      .from('registrations')
      .select(REG_FIELDS)
      .eq('ticket_code', code)
      .maybeSingle();
    if (error) throw error;

    if (!reg) {
      showResult('error', { title: 'Vé không tồn tại', detail: 'Không tìm thấy mã vé này trong hệ thống.' });
      return;
    }
    if (reg.event_id !== eventId) {
      const { data: ev } = await db.from('events').select('name').eq('id', reg.event_id).maybeSingle();
      showResult('error', {
        title: 'Sai sự kiện',
        name: reg.full_name,
        detail: ev ? `Vé này thuộc sự kiện: ${ev.name}` : 'Vé này thuộc sự kiện khác.',
      });
      return;
    }
    await checkInRegistration(reg);
  } catch (err) {
    showResult('error', { title: 'Lỗi kết nối', detail: friendlyError(err) });
  }
}

// Dùng chung cho quét QR và check-in thủ công
async function checkInRegistration(reg) {
  if (reg.checked_in_at) {
    showAlready(reg);
    return;
  }

  // Chỉ cập nhật nếu vẫn chưa check-in (tránh 2 máy cùng check-in 1 vé)
  const { data, error } = await db
    .from('registrations')
    .update({ checked_in_at: new Date().toISOString() })
    .eq('id', reg.id)
    .is('checked_in_at', null)
    .select(REG_FIELDS);
  if (error) throw error;

  if (data && data.length) {
    const r = data[0];
    showResult('success', {
      title: 'Hợp lệ – Chào mừng!',
      name: r.full_name,
      org: r.organization,
      detail: `Check-in lúc ${formatTime(r.checked_in_at)}`,
    });
  } else {
    // Máy khác vừa check-in trước → đọc lại để lấy giờ
    const { data: fresh } = await db.from('registrations').select(REG_FIELDS).eq('id', reg.id).maybeSingle();
    showAlready(fresh || reg);
  }
  refreshCounter();
}

function showAlready(reg) {
  showResult('warning', {
    title: `Đã check-in lúc ${formatTime(reg.checked_in_at)}`,
    name: reg.full_name,
    org: reg.organization,
    detail: 'Vé này đã được sử dụng trước đó.',
  });
}

// =====================================================================
// Khung kết quả + âm thanh
// =====================================================================
const ICONS = { success: '✓', warning: '!', error: '✕' };
let overlayTimer = null;

function showResult(type, { title, name = '', org = '', detail = '' }) {
  beep(type);
  if (navigator.vibrate) navigator.vibrate(type === 'success' ? 120 : [120, 80, 120]);

  const overlay = $('result-overlay');
  overlay.className = `result-overlay result-${type}`;
  $('result-icon').textContent = ICONS[type];
  $('result-title').textContent = title;
  $('result-name').textContent = name;
  $('result-org').textContent = org || '';
  $('result-detail').textContent = detail;
  overlay.hidden = false;

  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => { overlay.hidden = true; }, PAUSE_MS);

  // Dòng "kết quả gần nhất" dưới camera
  const last = $('last-result');
  last.className = `last-result result-${type}`;
  last.textContent = [title, name].filter(Boolean).join(' – ');
  last.hidden = false;
}

$('result-overlay').addEventListener('click', () => { $('result-overlay').hidden = true; });

let audioCtx = null;

// Trình duyệt chỉ cho phát âm thanh sau khi người dùng chạm/bấm
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { /* không hỗ trợ âm thanh */ }
}

const SOUNDS = {
  success: [{ f: 1046, d: 0.12 }, { f: 1568, d: 0.18 }],          // 2 nốt cao, đi lên
  warning: [{ f: 660, d: 0.15 }, { f: 660, d: 0.15 }],            // 2 tiếng trung
  error:   [{ f: 220, d: 0.45, type: 'square' }],                 // 1 tiếng trầm dài
};

function beep(type) {
  if (!audioCtx) return;
  let t = audioCtx.currentTime;
  for (const { f, d, type: wave = 'sine' } of SOUNDS[type]) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + d + 0.02);
    t += d + 0.06;
  }
}

// =====================================================================
// Check-in thủ công
// =====================================================================
let searchResults = [];

$('search-input').addEventListener('input', (e) => {
  unlockAudio();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(e.target.value), 300);
});

async function search(raw) {
  const box = $('search-results');
  // Bỏ ký tự đặc biệt của bộ lọc Supabase (dấu phẩy, ngoặc, %, *…)
  const q = raw.trim().replace(/[,()%*\\:"']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!eventId || q.length < 2) {
    box.innerHTML = q ? '<p class="muted">Nhập ít nhất 2 ký tự.</p>' : '';
    return;
  }

  const digits = q.replace(/[\s.\-+]/g, '');
  const filters = [`full_name.ilike."%${q}%"`];
  if (/^\d{3,}$/.test(digits)) filters.push(`phone.ilike."%${digits}%"`);

  box.innerHTML = '<p class="muted">Đang tìm…</p>';
  try {
    const { data, error } = await db
      .from('registrations')
      .select(REG_FIELDS)
      .eq('event_id', eventId)
      .or(filters.join(','))
      .order('full_name')
      .limit(20);
    if (error) throw error;
    searchResults = data || [];
    renderSearch();
  } catch (err) {
    box.innerHTML = `<p class="muted">${escapeHtml(friendlyError(err))}</p>`;
  }
}

function renderSearch() {
  const box = $('search-results');
  if (!searchResults.length) {
    box.innerHTML = '<p class="muted">Không tìm thấy người đăng ký phù hợp.</p>';
    return;
  }
  box.innerHTML = searchResults.map((r) => `
    <div class="search-item">
      <div class="search-info">
        <div class="search-name">${escapeHtml(r.full_name)}</div>
        <div class="muted small">${escapeHtml(r.phone)}${r.organization ? ' · ' + escapeHtml(r.organization) : ''}</div>
      </div>
      ${r.checked_in_at
        ? `<span class="badge badge-warning">Đã check-in ${escapeHtml(formatTime(r.checked_in_at))}</span>`
        : `<button type="button" class="btn btn-sm" data-id="${r.id}">Check-in</button>`}
    </div>`).join('');
}

$('search-results').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn || busy) return;
  const reg = searchResults.find((r) => r.id === btn.dataset.id);
  if (!reg) return;

  busy = true;
  btn.disabled = true;
  try {
    await checkInRegistration(reg);
  } catch (err) {
    showResult('error', { title: 'Lỗi kết nối', detail: friendlyError(err) });
  } finally {
    busy = false;
    search($('search-input').value); // làm mới danh sách
  }
});

// =====================================================================
// Khởi động (đăng nhập, menu: xem common.js)
// =====================================================================
initStaffPage({
  onSignedIn: loadEvents,
  onSignedOut: async () => {
    await stopCamera();
    clearInterval(counterTimer);
  },
});
