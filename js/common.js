// Tiện ích dùng chung cho mọi trang.
// Cần nạp trước: supabase-js (CDN) và config.js

// ---- Kết nối Supabase ----
const isConfigured =
  typeof SUPABASE_URL === 'string' && SUPABASE_URL.trim() !== '' &&
  typeof SUPABASE_KEY === 'string' && SUPABASE_KEY.trim() !== '';

const db = isConfigured ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!isConfigured) {
  console.warn('Chưa điền SUPABASE_URL / SUPABASE_KEY trong config.js');
}

// ---- Chuyển lỗi kỹ thuật thành câu tiếng Việt dễ hiểu ----
function friendlyError(err) {
  console.error(err);
  if (!err) return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  const msg = String(err.message || err);

  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Email hoặc mật khẩu không đúng.';
  if (/JWT expired|session/i.test(msg)) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';

  switch (err.code) {
    case '23505': return 'Dữ liệu này đã tồn tại.';
    case '23514': return 'Thông tin chưa hợp lệ, vui lòng kiểm tra lại.';
    case '42501': return 'Bạn không có quyền thực hiện thao tác này.';
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại sau.';
}

// ---- Thông báo nổi (toast) ----
function toast(message, type = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3500);
  setTimeout(() => el.remove(), 4000);
}

// ---- Định dạng & chuỗi ----
const TZ = 'Asia/Ho_Chi_Minh';

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('vi-VN', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return `${time}, ${date}`;
}

function dateParts(iso) {
  const d = new Date(iso);
  const get = (opt) => d.toLocaleDateString('vi-VN', { timeZone: TZ, ...opt });
  return { day: get({ day: '2-digit' }), month: 'Th' + Number(get({ month: 'numeric' })) };
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// HH:mm, thêm ngày nếu không phải hôm nay
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const day = (x) => x.toLocaleDateString('vi-VN', { timeZone: TZ });
  return day(d) === day(new Date()) ? time : `${time} ngày ${day(d)}`;
}

// dd/mm/yyyy HH:mm (dùng trong bảng, CSV)
function formatShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Bỏ dấu tiếng Việt + chữ thường, để tìm kiếm không phân biệt dấu
function normalizeText(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

// "Nguyễn Văn Á" -> "nguyen-van-a" (dùng cho tên file)
function slugify(str) {
  return normalizeText(str).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

// localStorage an toàn (có thể bị chặn ở chế độ riêng tư)
function safeGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } }

// =====================================================================
// Trang nhân viên (checkin.html, admin.html): menu chung + đăng nhập
// =====================================================================
const STAFF_LINKS = [
  { href: 'checkin.html', label: 'Check-in' },
  { href: 'admin.html', label: 'Quản trị' },
  { href: 'index.html', label: 'Trang đăng ký ↗', newTab: true },
];

// Vẽ thanh trên cùng vào <header id="topbar">
function renderTopbar() {
  const header = document.getElementById('topbar');
  if (!header) return;
  // Vercel có thể bỏ đuôi .html (/admin) → so sánh tên trang không có đuôi
  const current = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
  const links = STAFF_LINKS.map((l) => {
    const active = l.href.replace(/\.html$/, '') === current;
    return `<a href="${l.href}"${active ? ' class="active" aria-current="page"' : ''}${l.newTab ? ' target="_blank" rel="noopener"' : ''}>${l.label}</a>`;
  }).join('');

  header.className = 'topbar';
  header.innerHTML = `
    <div class="container topbar-inner">
      <strong class="brand">Sự kiện · Nhân viên</strong>
      <div class="topbar-user" id="user-box" hidden>
        <span id="user-email"></span>
        <button type="button" class="btn btn-light btn-sm" id="logout-btn">Đăng xuất</button>
      </div>
      <nav class="staff-nav" id="staff-nav" hidden>${links}</nav>
    </div>`;
}

// Quản lý đăng nhập cho trang nhân viên.
// Trang cần có: #loading-view, #login-view (chứa #login-form…), #app-view
function initStaffPage({ onSignedIn, onSignedOut }) {
  const el = (id) => document.getElementById(id);
  renderTopbar();

  const show = (name) => {
    el('loading-view').hidden = name !== 'loading';
    el('login-view').hidden = name !== 'login';
    el('app-view').hidden = name !== 'app';
  };

  let signedIn = false;

  async function apply(session) {
    if (!session) {
      if (signedIn && onSignedOut) await onSignedOut();
      signedIn = false;
      el('user-box').hidden = true;
      el('staff-nav').hidden = true;
      show('login');
      return;
    }
    signedIn = true;
    el('user-email').textContent = session.user.email;
    el('user-box').hidden = false;
    el('staff-nav').hidden = false;
    show('app');
    await onSignedIn(session);
  }

  if (!db) {
    el('loading-view').textContent = 'Trang chưa được cấu hình kết nối. Vui lòng liên hệ quản trị viên.';
    return;
  }

  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('login-email').value.trim();
    const password = el('login-password').value;
    const errBox = el('login-error');
    errBox.hidden = true;

    if (!email || !password) {
      errBox.textContent = 'Vui lòng nhập email và mật khẩu.';
      errBox.hidden = false;
      return;
    }

    const btn = el('login-btn');
    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập…';
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      el('login-password').value = '';
      await apply(data.session);
    } catch (err) {
      errBox.textContent = friendlyError(err);
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  });

  el('logout-btn').addEventListener('click', async () => {
    await db.auth.signOut(); // sự kiện SIGNED_OUT bên dưới sẽ chuyển về màn đăng nhập
  });

  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') apply(null);
  });

  db.auth.getSession()
    .then(({ data }) => apply(data.session))
    .catch((err) => { el('loading-view').textContent = friendlyError(err); });
}
