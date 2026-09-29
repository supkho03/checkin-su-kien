-- =====================================================================
-- Check-in sự kiện – schema.sql
-- Chạy toàn bộ file này trong Supabase → SQL Editor.
-- File chạy lại nhiều lần được (không lỗi, không nhân đôi dữ liệu mẫu).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bảng events: sự kiện
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 200),
  event_date  timestamptz not null,
  location    text check (length(location) <= 300),
  description text check (length(description) <= 5000),
  is_open     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Bảng registrations: người đăng ký (mỗi dòng là một vé)
-- ---------------------------------------------------------------------
create table if not exists public.registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  full_name     text not null check (length(trim(full_name)) between 1 and 150),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  phone         text not null check (phone ~ '^[0-9+ .()-]{8,20}$'),
  organization  text check (length(organization) <= 200),
  -- Mã vé do trình duyệt tạo bằng crypto.randomUUID() (36 ký tự)
  ticket_code   text not null unique check (length(ticket_code) between 32 and 64),
  checked_in_at timestamptz,
  created_at    timestamptz not null default now()
);

-- Mỗi email chỉ đăng ký 1 lần cho mỗi sự kiện (không phân biệt hoa/thường)
create unique index if not exists registrations_event_email_key
  on public.registrations (event_id, lower(email));

-- Tăng tốc tìm kiếm khi check-in thủ công và lọc theo sự kiện
create index if not exists registrations_event_phone_idx
  on public.registrations (event_id, phone);
create index if not exists registrations_event_name_idx
  on public.registrations (event_id, full_name);

-- ---------------------------------------------------------------------
-- 3. Bật RLS
-- ---------------------------------------------------------------------
alter table public.events        enable row level security;
alter table public.registrations enable row level security;

-- Xoá policy cũ (nếu có) để chạy lại file không bị lỗi trùng tên
drop policy if exists "anon doc su kien dang mo"       on public.events;
drop policy if exists "nhan vien toan quyen events"    on public.events;
drop policy if exists "anon dang ky su kien dang mo"   on public.registrations;
drop policy if exists "nhan vien toan quyen dang ky"   on public.registrations;

-- ---- events ----
-- Khách (anon) chỉ đọc được sự kiện đang mở đăng ký
create policy "anon doc su kien dang mo"
  on public.events for select
  to anon
  using (is_open = true);

-- Nhân viên đã đăng nhập: toàn quyền
create policy "nhan vien toan quyen events"
  on public.events for all
  to authenticated
  using (true)
  with check (true);

-- ---- registrations ----
-- Khách chỉ được THÊM, vào sự kiện đang mở, và chưa check-in.
-- Không có policy SELECT/UPDATE/DELETE cho anon => anon không đọc/sửa/xoá được.
-- (Điều kiện exists đọc bảng events theo quyền anon, nên chỉ thấy sự kiện is_open = true.)
create policy "anon dang ky su kien dang mo"
  on public.registrations for insert
  to anon
  with check (
    checked_in_at is null
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.is_open = true
    )
  );

-- Nhân viên đã đăng nhập: toàn quyền
create policy "nhan vien toan quyen dang ky"
  on public.registrations for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- 4. Sự kiện mẫu (chỉ thêm nếu chưa có)
-- ---------------------------------------------------------------------
insert into public.events (name, event_date, location, description, is_open)
select
  'Hội thảo Chuyển đổi số 2026',
  '2026-10-20 08:30:00+07',
  'Hội trường A, 123 Nguyễn Huệ, Quận 1, TP.HCM',
  'Hội thảo chia sẻ kinh nghiệm chuyển đổi số cho doanh nghiệp vừa và nhỏ. Vui lòng mang theo vé QR khi đến.',
  true
where not exists (
  select 1 from public.events where name = 'Hội thảo Chuyển đổi số 2026'
);
