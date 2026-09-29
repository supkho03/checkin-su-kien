// Trang đăng ký: danh sách sự kiện → form → vé QR

const views = {
  events: document.getElementById('events-view'),
  form: document.getElementById('form-view'),
  ticket: document.getElementById('ticket-view'),
};

let events = [];          // sự kiện đang mở
let currentEvent = null;  // sự kiện đang chọn
let currentTicket = null; // vé vừa tạo
let ticketSaved = false;  // người dùng đã tải vé chưa

function showView(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================================
// 1. Danh sách sự kiện
// =====================================================================
async function loadEvents() {
  const state = document.getElementById('events-state');
  const grid = document.getElementById('event-grid');

  if (!db) {
    state.textContent = 'Trang chưa được cấu hình kết nối. Vui lòng liên hệ ban tổ chức.';
    return;
  }

  state.hidden = false;
  grid.hidden = true;
  state.textContent = 'Đang tải danh sách sự kiện…';

  try {
    const { data, error } = await db
      .from('events')
      .select('id, name, event_date, location, description')
      .eq('is_open', true)
      .order('event_date', { ascending: true });
    if (error) throw error;
    events = data || [];
  } catch (err) {
    state.textContent = friendlyError(err);
    return;
  }

  if (events.length === 0) {
    state.textContent = 'Hiện chưa có sự kiện nào mở đăng ký. Vui lòng quay lại sau.';
    return;
  }

  grid.innerHTML = events.map((ev) => {
    const { day, month } = dateParts(ev.event_date);
    return `
      <article class="card event-card">
        <div class="event-top">
          <div class="date-badge"><span class="day">${day}</span><span class="month">${month}</span></div>
          <div>
            <h3>${escapeHtml(ev.name)}</h3>
          </div>
        </div>
        <div class="meta">
          <div>🕒 <span>${escapeHtml(formatDateTime(ev.event_date))}</span></div>
          ${ev.location ? `<div>📍 <span>${escapeHtml(ev.location)}</span></div>` : ''}
        </div>
        ${ev.description ? `<p class="event-desc">${escapeHtml(ev.description)}</p>` : ''}
        <button type="button" class="btn btn-block" data-id="${ev.id}">Đăng ký</button>
      </article>`;
  }).join('');

  state.hidden = true;
  grid.hidden = false;
}

document.getElementById('event-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  const ev = events.find((x) => x.id === btn.dataset.id);
  if (ev) openForm(ev);
});

// =====================================================================
// 2. Form đăng ký
// =====================================================================
const form = document.getElementById('register-form');
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');

function openForm(ev) {
  currentEvent = ev;
  document.getElementById('event-summary').innerHTML = `
    <h2>${escapeHtml(ev.name)}</h2>
    <div class="meta">
      <div>🕒 <span>${escapeHtml(formatDateTime(ev.event_date))}</span></div>
      ${ev.location ? `<div>📍 <span>${escapeHtml(ev.location)}</span></div>` : ''}
    </div>`;
  form.reset();
  clearErrors();
  showView('form');
  setTimeout(() => document.getElementById('full_name').focus(), 300);
}

document.getElementById('back-to-list').addEventListener('click', () => showView('events'));

function setFieldError(name, message) {
  const field = form.elements[name].closest('.field');
  field.classList.toggle('invalid', !!message);
  field.querySelector('.error').textContent = message || '';
}

function clearErrors() {
  ['full_name', 'email', 'phone', 'organization'].forEach((n) => setFieldError(n, ''));
  formError.hidden = true;
}

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Đọc + chuẩn hoá + kiểm tra dữ liệu. Trả về null nếu có lỗi.
function readForm() {
  const fullName = form.full_name.value.trim().replace(/\s+/g, ' ');
  const email = form.email.value.trim().toLowerCase();
  const phone = form.phone.value.replace(/[\s.\-()]/g, '');
  const organization = form.organization.value.trim().replace(/\s+/g, ' ');

  let ok = true;
  if (!fullName) { setFieldError('full_name', 'Vui lòng nhập họ và tên.'); ok = false; }
  if (!email) { setFieldError('email', 'Vui lòng nhập email.'); ok = false; }
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFieldError('email', 'Email chưa đúng định dạng.'); ok = false; }
  if (!phone) { setFieldError('phone', 'Vui lòng nhập số điện thoại.'); ok = false; }
  else if (!/^(0|\+84)\d{9,10}$/.test(phone)) { setFieldError('phone', 'Số điện thoại chưa đúng (VD: 0912345678).'); ok = false; }

  return ok ? { full_name: fullName, email, phone, organization: organization || null } : null;
}

// Mã vé ngẫu nhiên. randomUUID cần HTTPS hoặc localhost; có dự phòng cho trình duyệt cũ.
function newTicketCode() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  if (!db || !currentEvent) return;

  const values = readForm();
  if (!values) return;

  const ticketCode = newTicketCode();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang gửi…';

  try {
    // KHÔNG dùng .select(): khách không có quyền đọc bảng registrations
    const { error } = await db.from('registrations').insert({
      event_id: currentEvent.id,
      ticket_code: ticketCode,
      ...values,
    });

    if (error) {
      if (error.code === '23505') {
        setFieldError('email', 'Email này đã đăng ký sự kiện.');
        showFormError('Email này đã đăng ký sự kiện.');
      } else if (error.code === '42501') {
        showFormError('Sự kiện này đã đóng đăng ký. Vui lòng chọn sự kiện khác.');
        loadEvents();
      } else {
        showFormError(friendlyError(error));
      }
      return;
    }

    currentTicket = { ...values, ticket_code: ticketCode, event: currentEvent };
    await showTicket(currentTicket);
  } catch (err) {
    showFormError(friendlyError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đăng ký';
  }
});

// =====================================================================
// 3. Vé
// =====================================================================
async function showTicket(t) {
  ticketSaved = false;
  document.getElementById('t-event').textContent = t.event.name;
  document.getElementById('t-date').textContent = '🕒 ' + formatDateTime(t.event.event_date);
  document.getElementById('t-location').textContent = t.event.location ? '📍 ' + t.event.location : '';
  document.getElementById('t-name').textContent = t.full_name;
  document.getElementById('t-org').textContent = t.organization || '';
  document.getElementById('t-code').textContent = t.ticket_code;

  // QR chứa ĐÚNG ticket_code
  document.getElementById('t-qr').src = await QRCode.toDataURL(t.ticket_code, {
    width: 440, margin: 1, errorCorrectionLevel: 'M',
  });

  showView('ticket');
}

document.getElementById('download-btn').addEventListener('click', async () => {
  if (!currentTicket) return;
  const btn = document.getElementById('download-btn');
  btn.disabled = true;
  try {
    const canvas = await drawTicketCanvas(currentTicket);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ve-${slugify(currentTicket.event.name)}-${slugify(currentTicket.full_name)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    ticketSaved = true;
    toast('Đã tải vé. Hãy kiểm tra thư mục Tải về / Ảnh.', 'success');
  } catch (err) {
    console.error(err);
    toast('Không tải được vé. Vui lòng chụp màn hình để lưu vé.', 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('done-btn').addEventListener('click', () => {
  if (!ticketSaved && !confirm('Vé sẽ không hiển thị lại. Bạn đã chụp màn hình hoặc lưu vé chưa?')) return;
  currentTicket = null;
  ticketSaved = false;
  showView('events');
});

// Cảnh báo khi rời/tải lại trang mà chưa lưu vé
window.addEventListener('beforeunload', (e) => {
  if (currentTicket && !ticketSaved) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------------
// Vẽ toàn bộ thẻ vé lên canvas (giống giao diện trên trang) để lưu PNG
// ---------------------------------------------------------------------
const FONT = '"Be Vietnam Pro", "Segoe UI", Arial, sans-serif';

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawTicketCanvas(t) {
  try {
    await Promise.all([
      document.fonts.load(`700 40px "Be Vietnam Pro"`),
      document.fonts.load(`600 40px "Be Vietnam Pro"`),
      document.fonts.load(`400 40px "Be Vietnam Pro"`),
    ]);
  } catch (_) { /* dùng font dự phòng */ }

  const W = 1080;
  const M = 60;             // lề ngoài
  const CW = W - M * 2;     // rộng thẻ
  const PAD = 64;           // lề trong
  const TW = CW - PAD * 2;  // rộng vùng chữ
  const QR = 520;

  // --- Đo chữ để tính chiều cao ---
  const m = document.createElement('canvas').getContext('2d');
  m.font = `700 56px ${FONT}`;
  const titleLines = wrapText(m, t.event.name, TW);
  m.font = `400 32px ${FONT}`;
  const metaLines = [
    ...wrapText(m, 'Thời gian: ' + formatDateTime(t.event.event_date), TW),
    ...(t.event.location ? wrapText(m, 'Địa điểm: ' + t.event.location, TW) : []),
  ];
  m.font = `700 56px ${FONT}`;
  const nameLines = wrapText(m, t.full_name, TW);
  m.font = `400 34px ${FONT}`;
  const orgLines = t.organization ? wrapText(m, t.organization, TW) : [];

  const headH = 64 + 30 + 24 + titleLines.length * 70 + 20 + metaLines.length * 46 + 52;
  const cutH = 70;
  const bodyH = 10 + 28 + 16 + nameLines.length * 68 + (orgLines.length ? 8 + orgLines.length * 46 : 0)
    + 44 + QR + 28 + 32 + 20 + 34 + 64;
  const CH = headH + cutH + bodyH;
  const H = CH + M * 2;

  // --- Vẽ ---
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = '#eef2ff';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // thẻ trắng có bóng
  ctx.save();
  ctx.shadowColor = 'rgba(30, 27, 75, 0.18)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  roundRectPath(ctx, M, M, CW, CH, 48);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // phần đầu màu gradient
  ctx.save();
  roundRectPath(ctx, M, M, CW, CH, 48);
  ctx.clip();
  const grad = ctx.createLinearGradient(M, M, M + CW, M + headH);
  grad.addColorStop(0, '#4f46e5');
  grad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(M, M, CW, headH);
  ctx.restore();

  const X = M + PAD;
  let y = M + 64;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 26px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  ctx.fillText('VÉ THAM DỰ', X, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += 30 + 24;

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 56px ${FONT}`;
  titleLines.forEach((l) => { ctx.fillText(l, X, y); y += 70; });
  y += 20;

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `400 32px ${FONT}`;
  metaLines.forEach((l) => { ctx.fillText(l, X, y); y += 46; });

  // đường xé + 2 khuyết tròn
  const cutY = M + headH + cutH / 2;
  ctx.fillStyle = bg;
  [M, M + CW].forEach((cx) => {
    ctx.beginPath();
    ctx.arc(cx, cutY, 30, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(M + 50, cutY);
  ctx.lineTo(M + CW - 50, cutY);
  ctx.stroke();
  ctx.setLineDash([]);

  // phần thân (căn giữa)
  const CX = W / 2;
  ctx.textAlign = 'center';
  y = M + headH + cutH + 10;

  ctx.fillStyle = '#64748b';
  ctx.font = `600 24px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillText('HỌ VÀ TÊN', CX, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += 28 + 16;

  ctx.fillStyle = '#1e1b4b';
  ctx.font = `700 56px ${FONT}`;
  nameLines.forEach((l) => { ctx.fillText(l, CX, y); y += 68; });

  if (orgLines.length) {
    y += 8;
    ctx.fillStyle = '#64748b';
    ctx.font = `400 34px ${FONT}`;
    orgLines.forEach((l) => { ctx.fillText(l, CX, y); y += 46; });
  }
  y += 44;

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, t.ticket_code, { width: QR, margin: 1, errorCorrectionLevel: 'M' });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, CX - QR / 2, y, QR, QR);
  y += QR + 28;

  ctx.fillStyle = '#64748b';
  ctx.font = `400 26px ui-monospace, Consolas, monospace`;
  ctx.fillText(t.ticket_code, CX, y);
  y += 32 + 20;

  ctx.font = `400 30px ${FONT}`;
  ctx.fillText('Xuất trình mã QR này tại quầy check-in', CX, y);

  return canvas;
}

// ---------------------------------------------------------------------
loadEvents();
