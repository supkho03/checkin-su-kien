// Trang quản trị: sự kiện, người đăng ký, thống kê, CSV, huỷ check-in

const $ = (id) => document.getElementById(id);
const EVENT_KEY = 'admin.eventId';

let events = [];
let selectedId = null;
let regs = [];          // toàn bộ người đăng ký của sự kiện đang chọn
let editingId = null;   // null = thêm mới

// =====================================================================
// Sự kiện
// =====================================================================
async function loadEvents() {
  const box = $('events-list');
  try {
    const { data, error } = await db
      .from('events')
      .select('id, name, event_date, location, description, is_open')
      .order('event_date', { ascending: false });
    if (error) throw error;
    events = data || [];
  } catch (err) {
    box.innerHTML = `<p class="muted">${escapeHtml(friendlyError(err))}</p>`;
    return;
  }

  renderEvents();

  if (!events.length) {
    $('reg-section').hidden = true;
    return;
  }
  // Giữ sự kiện đang chọn, nếu không thì lấy lần trước / sự kiện đầu tiên
  const saved = selectedId || safeGet(EVENT_KEY);
  const id = events.some((e) => e.id === saved) ? saved : events[0].id;
  if (id !== selectedId) selectEvent(id);
  else renderRegHeader();
}

function renderEvents() {
  const box = $('events-list');
  if (!events.length) {
    box.innerHTML = '<p class="muted">Chưa có sự kiện nào. Bấm “+ Thêm sự kiện” để tạo.</p>';
    return;
  }
  box.innerHTML = events.map((ev) => `
    <div class="event-row${ev.id === selectedId ? ' selected' : ''}" data-id="${ev.id}">
      <button type="button" class="event-row-main" data-action="select">
        <span class="event-row-name">${escapeHtml(ev.name)}</span>
        <span class="muted small">🕒 ${escapeHtml(formatShort(ev.event_date))}${ev.location ? ' · 📍 ' + escapeHtml(ev.location) : ''}</span>
      </button>
      <div class="event-row-actions">
        <span class="badge ${ev.is_open ? 'badge-success' : 'badge-muted'}">${ev.is_open ? 'Đang mở ĐK' : 'Đã đóng ĐK'}</span>
        <button type="button" class="btn btn-light btn-sm" data-action="toggle">${ev.is_open ? 'Đóng ĐK' : 'Mở ĐK'}</button>
        <button type="button" class="btn btn-light btn-sm" data-action="edit">Sửa</button>
      </div>
    </div>`).join('');
}

$('events-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.event-row').dataset.id;
  const ev = events.find((x) => x.id === id);
  if (!ev) return;

  if (btn.dataset.action === 'select') {
    selectEvent(id);
    $('reg-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (btn.dataset.action === 'edit') openDialog(ev);
  if (btn.dataset.action === 'toggle') toggleOpen(ev, btn);
});

async function toggleOpen(ev, btn) {
  btn.disabled = true;
  try {
    const { error } = await db.from('events').update({ is_open: !ev.is_open }).eq('id', ev.id);
    if (error) throw error;
    ev.is_open = !ev.is_open;
    toast(ev.is_open ? 'Đã mở đăng ký.' : 'Đã đóng đăng ký.', 'success');
    renderEvents();
  } catch (err) {
    toast(friendlyError(err), 'error');
    btn.disabled = false;
  }
}

// ---- Hộp thoại thêm/sửa ----
const dialog = $('event-dialog');

// ISO (UTC) → "YYYY-MM-DDTHH:mm" theo giờ máy, cho ô datetime-local
function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openDialog(ev = null) {
  editingId = ev ? ev.id : null;
  $('dialog-title').textContent = ev ? 'Sửa sự kiện' : 'Thêm sự kiện';
  $('ev-name').value = ev ? ev.name : '';
  $('ev-date').value = ev ? toLocalInput(ev.event_date) : '';
  $('ev-location').value = ev ? ev.location || '' : '';
  $('ev-description').value = ev ? ev.description || '' : '';
  $('ev-open').checked = ev ? ev.is_open : true;
  $('event-error').hidden = true;
  dialog.showModal();
  $('ev-name').focus();
}

$('add-event-btn').addEventListener('click', () => openDialog());
$('cancel-event-btn').addEventListener('click', () => dialog.close());

$('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('event-error');
  errBox.hidden = true;

  const name = $('ev-name').value.trim().replace(/\s+/g, ' ');
  const dateVal = $('ev-date').value;
  if (!name || !dateVal) {
    errBox.textContent = 'Vui lòng nhập tên sự kiện và thời gian.';
    errBox.hidden = false;
    return;
  }

  const payload = {
    name,
    event_date: new Date(dateVal).toISOString(),
    location: $('ev-location').value.trim() || null,
    description: $('ev-description').value.trim() || null,
    is_open: $('ev-open').checked,
  };

  const btn = $('save-event-btn');
  btn.disabled = true;
  try {
    const q = editingId
      ? db.from('events').update(payload).eq('id', editingId).select('id').single()
      : db.from('events').insert(payload).select('id').single();
    const { data, error } = await q;
    if (error) throw error;

    dialog.close();
    toast(editingId ? 'Đã lưu thay đổi.' : 'Đã thêm sự kiện.', 'success');
    selectedId = data.id;
    safeSet(EVENT_KEY, data.id);
    await loadEvents();
    await loadRegistrations();
  } catch (err) {
    errBox.textContent = friendlyError(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
// Người đăng ký
// =====================================================================
function selectEvent(id) {
  selectedId = id;
  safeSet(EVENT_KEY, id);
  $('reg-search').value = '';
  $('reg-filter').value = 'all';
  renderEvents();
  renderRegHeader();
  loadRegistrations();
}

function renderRegHeader() {
  const ev = events.find((e) => e.id === selectedId);
  $('reg-section').hidden = !ev;
  if (ev) $('reg-title').textContent = ev.name;
}

async function loadRegistrations() {
  if (!selectedId) return;
  const eventAtStart = selectedId;
  $('reg-body').innerHTML = '<tr><td colspan="8" class="muted center">Đang tải…</td></tr>';

  try {
    // Supabase trả tối đa 1000 dòng/lần → tải theo từng trang
    const PAGE = 1000;
    let all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('registrations')
        .select('id, full_name, email, phone, organization, ticket_code, checked_in_at, created_at')
        .eq('event_id', eventAtStart)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < PAGE) break;
    }
    if (eventAtStart !== selectedId) return; // người dùng đã chọn sự kiện khác
    regs = all;
    renderStats();
    renderRegs();
  } catch (err) {
    $('reg-body').innerHTML = `<tr><td colspan="8" class="muted center">${escapeHtml(friendlyError(err))}</td></tr>`;
  }
}

function renderStats() {
  const total = regs.length;
  const checked = regs.filter((r) => r.checked_in_at).length;
  $('stat-total').textContent = total.toLocaleString('vi-VN');
  $('stat-in').textContent = checked.toLocaleString('vi-VN');
  $('stat-rate').textContent = total ? `${((checked / total) * 100).toFixed(1).replace('.0', '')}%` : '0%';
}

function filteredRegs() {
  const q = normalizeText($('reg-search').value.trim());
  const qDigits = q.replace(/[\s.\-+()]/g, '');
  const status = $('reg-filter').value;

  return regs.filter((r) => {
    if (status === 'in' && !r.checked_in_at) return false;
    if (status === 'out' && r.checked_in_at) return false;
    if (!q) return true;
    const hay = normalizeText(`${r.full_name} ${r.email} ${r.organization || ''}`);
    return hay.includes(q) || (qDigits.length >= 3 && /^\d+$/.test(qDigits) && r.phone.includes(qDigits));
  });
}

function renderRegs() {
  const list = filteredRegs();
  const body = $('reg-body');
  $('reg-count').textContent = regs.length
    ? `Hiển thị ${list.length.toLocaleString('vi-VN')} / ${regs.length.toLocaleString('vi-VN')} người`
    : '';

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted center">${regs.length ? 'Không có người phù hợp.' : 'Chưa có ai đăng ký sự kiện này.'}</td></tr>`;
    return;
  }

  body.innerHTML = list.map((r, i) => `
    <tr>
      <td data-label="#">${i + 1}</td>
      <td data-label="Họ tên"><strong>${escapeHtml(r.full_name)}</strong></td>
      <td data-label="Email">${escapeHtml(r.email)}</td>
      <td data-label="SĐT">${escapeHtml(r.phone)}</td>
      <td data-label="Đơn vị">${escapeHtml(r.organization || '')}</td>
      <td data-label="Đăng ký lúc">${escapeHtml(formatShort(r.created_at))}</td>
      <td data-label="Trạng thái">${r.checked_in_at
        ? `<span class="badge badge-success">Có mặt ${escapeHtml(formatTime(r.checked_in_at))}</span>`
        : '<span class="badge badge-muted">Chưa đến</span>'}</td>
      <td class="cell-action">${r.checked_in_at
        ? `<button type="button" class="btn btn-danger-light btn-sm" data-undo="${r.id}">Huỷ check-in</button>`
        : ''}</td>
    </tr>`).join('');
}

let searchTimer = null;
$('reg-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderRegs, 200);
});
$('reg-filter').addEventListener('change', renderRegs);
$('refresh-btn').addEventListener('click', loadRegistrations);

// ---- Huỷ check-in nhầm ----
$('reg-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-undo]');
  if (!btn) return;
  const reg = regs.find((r) => r.id === btn.dataset.undo);
  if (!reg) return;
  if (!confirm(`Huỷ check-in của "${reg.full_name}"?\nNgười này sẽ trở về trạng thái chưa có mặt và có thể quét vé lại.`)) return;

  btn.disabled = true;
  try {
    const { error } = await db.from('registrations').update({ checked_in_at: null }).eq('id', reg.id);
    if (error) throw error;
    reg.checked_in_at = null;
    toast(`Đã huỷ check-in của ${reg.full_name}.`, 'success');
    renderStats();
    renderRegs();
  } catch (err) {
    toast(friendlyError(err), 'error');
    btn.disabled = false;
  }
});

// =====================================================================
// Xuất CSV (UTF-8 có BOM để Excel hiển thị đúng tiếng Việt)
// =====================================================================
function csvCell(value) {
  let s = String(value ?? '');
  // Chặn Excel hiểu nhầm thành công thức (CSV injection)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

$('export-btn').addEventListener('click', () => {
  const ev = events.find((e) => e.id === selectedId);
  if (!ev) return;
  if (!regs.length) {
    toast('Sự kiện chưa có người đăng ký để xuất.', 'warning');
    return;
  }

  const header = ['STT', 'Họ tên', 'Email', 'Số điện thoại', 'Đơn vị', 'Đăng ký lúc', 'Trạng thái', 'Giờ check-in', 'Mã vé'];
  const rows = regs.map((r, i) => [
    i + 1,
    r.full_name,
    r.email,
    r.phone,
    r.organization || '',
    formatShort(r.created_at),
    r.checked_in_at ? 'Có mặt' : 'Chưa đến',
    formatShort(r.checked_in_at),
    r.ticket_code,
  ]);

  const lines = [header, ...rows].map((row, idx) => row.map((v, col) => {
    // Số điện thoại: bọc ="..." để Excel giữ số 0 ở đầu
    if (idx > 0 && col === 3 && /^[0-9+]+$/.test(String(v))) return `"=""${v}"""`;
    return csvCell(v);
  }).join(','));

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).replace(/-/g, '');
  a.href = url;
  a.download = `dang-ky-${slugify(ev.name)}-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Đã xuất ${regs.length} người đăng ký.`, 'success');
});

// =====================================================================
// Khởi động (đăng nhập, menu: xem common.js)
// =====================================================================
initStaffPage({
  onSignedIn: loadEvents,
  onSignedOut: () => {
    dialog.open && dialog.close();
    regs = [];
    $('reg-body').innerHTML = '';
  },
});
