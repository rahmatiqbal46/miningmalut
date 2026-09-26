-- =============================================================================
-- ADMIN TERPADU MiningMalut · 01
-- Jalankan di Supabase → SQL Editor. Aman dijalankan ulang.
--
-- Sebelumnya admin tersebar di lima tempat: ADMINS di index.html, ADMINS di
-- operator-performance.html, fungsi op_is_admin(), ADMINS di Edge Function
-- sync-minerva, dan tabel gng_admin (Asesmen Go/No-Go). Sekarang SATU tabel:
--
--   public.app_admin   email admin, dikelola dari Mining Bureau → Kelola Admin
--
-- Semua pemeriksaan admin membaca tabel ini:
--   op_is_admin()    Operator Performance, Dashboard Produksi, foto operator
--   gng_is_admin()   Asesmen Go/No-Go            → memanggil op_is_admin()
--   site_is_admin()  Digital Twin / data site    → memanggil op_is_admin()
--   sync-minerva     Edge Function               → membaca app_admin
--   index.html, operator-performance.html        → memanggil op_is_admin()
--
-- gng_admin tidak lagi berupa tabel, melainkan VIEW di atas app_admin, supaya
-- fungsi Asesmen lama yang masih menyebut gng_admin tetap jalan tanpa diubah.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabel admin dan riwayat perubahannya
-- ---------------------------------------------------------------------------
create table if not exists public.app_admin (
  email          text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ditambah       timestamptz not null default now(),
  ditambah_oleh  text
);

create table if not exists public.app_admin_log (
  id      bigserial primary key,
  waktu   timestamptz not null default now(),
  oleh    text not null,
  aksi    text not null check (aksi in ('tambah','hapus','awal')),
  email   text not null
);

-- Tertutup untuk akses langsung. Baca/tulis hanya lewat fungsi di bawah.
alter table public.app_admin     enable row level security;
alter table public.app_admin_log enable row level security;
revoke all on public.app_admin, public.app_admin_log from anon, authenticated;
revoke all on sequence public.app_admin_log_id_seq from anon, authenticated;
-- Edge Function sync-minerva (service role) membaca daftar ini langsung.
grant select on public.app_admin to service_role;

-- ---------------------------------------------------------------------------
-- 2. Isi awal: gabungan daftar lama. on conflict → aman diulang.
-- ---------------------------------------------------------------------------
insert into public.app_admin (email, ditambah_oleh) values
  ('rahmat.iqbal@antam.com',     'data awal'),
  ('dani.suryawan@antam.com',    'data awal'),
  ('v_raihan.nashwan@antam.com', 'data awal')
on conflict do nothing;

-- Admin yang pernah ditambahkan lewat Kelola Asesmen (selagi gng_admin masih tabel)
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'gng_admin' and c.relkind = 'r') then
    insert into public.app_admin (email, ditambah, ditambah_oleh)
      select lower(trim(email)), ditambah, coalesce(ditambah_oleh, 'Asesmen Go/No-Go')
      from public.gng_admin
      where lower(trim(email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    on conflict do nothing;
    drop table public.gng_admin;
  end if;
end $$;

insert into public.app_admin_log (oleh, aksi, email)
  select 'penggabungan', 'awal', a.email from public.app_admin a
  where not exists (select 1 from public.app_admin_log);

-- gng_admin kini VIEW (bisa ditulis) di atas app_admin
create or replace view public.gng_admin as
  select email, ditambah, ditambah_oleh from public.app_admin;
revoke all on public.gng_admin from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Satu pemeriksa admin. Nama op_is_admin() dipertahankan karena sudah dipakai
--    banyak policy (op-foto, oe_1on1, oe-1on1, dashboard snapshot).
-- ---------------------------------------------------------------------------
create or replace function public.op_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admin
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.gng_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.op_is_admin()
$$;

create or replace function public.site_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.op_is_admin()
$$;

-- Pesan penolakan Asesmen tidak lagi menyebut "admin Asesmen"
create or replace function public.gng__wajib_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform gng__wajib_mining();
  if not gng_is_admin() then
    raise exception 'Hanya admin yang boleh mengubah ini.';
  end if;
end $$;
revoke all on function public.gng__wajib_admin() from public, anon, authenticated;

-- Tombol Tambah/Hapus lama di Kelola Asesmen diarahkan ke fungsi baru
create or replace function public.gng_simpan_admin(p_email text, p_aksi text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_aksi = 'tambah' then perform public.admin_tambah(p_email, true);
  elsif p_aksi = 'hapus' then perform public.admin_hapus(p_email);
  else raise exception 'Aksi tidak sah.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Fungsi untuk halaman Kelola Admin
-- ---------------------------------------------------------------------------
create or replace function public.admin__wajib()
returns text language plpgsql stable security definer set search_path = '' as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then raise exception 'Sesi login berakhir. Keluar lalu masuk lagi.'; end if;
  if not public.op_is_admin() then raise exception 'Hanya admin yang boleh membuka Kelola Admin.'; end if;
  return e;
end $$;

-- Daftar admin + status akun Supabase + riwayat 50 perubahan terakhir
create or replace function public.admin_daftar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare saya text := public.admin__wajib();
begin
  return jsonb_build_object(
    'saya', saya,
    'admin', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', a.email,
               'ditambah', a.ditambah,
               'ditambah_oleh', a.ditambah_oleh,
               'punya_akun', u.id is not null,
               'terkonfirmasi', u.email_confirmed_at is not null,
               'login_terakhir', u.last_sign_in_at)
             order by a.ditambah, a.email)
      from public.app_admin a
      left join auth.users u on lower(u.email) = a.email), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('waktu', l.waktu, 'oleh', l.oleh, 'aksi', l.aksi, 'email', l.email) order by l.id desc)
      from (select * from public.app_admin_log order by id desc limit 50) l), '[]'::jsonb));
end $$;

-- Tambah admin. Bila email belum punya akun Supabase dan p_paksa = false,
-- tidak menyimpan apa pun dan mengembalikan {perlu_konfirmasi: true}.
create or replace function public.admin_tambah(p_email text, p_paksa boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saya text := public.admin__wajib();
  v    text := lower(trim(coalesce(p_email, '')));
  akun boolean;
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Alamat email tidak sah.'; end if;
  if exists (select 1 from public.app_admin where email = v) then
    raise exception '% sudah admin.', v;
  end if;
  akun := exists (select 1 from auth.users where lower(email) = v);
  if not akun and not coalesce(p_paksa, false) then
    return jsonb_build_object('perlu_konfirmasi', true, 'email', v);
  end if;
  insert into public.app_admin (email, ditambah_oleh) values (v, saya);
  insert into public.app_admin_log (oleh, aksi, email) values (saya, 'tambah', v);
  return jsonb_build_object('ok', true, 'email', v, 'punya_akun', akun);
end $$;

-- Hapus admin. Tidak bisa menghapus diri sendiri, jadi daftar tidak pernah kosong.
create or replace function public.admin_hapus(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saya text := public.admin__wajib();
  v    text := lower(trim(coalesce(p_email, '')));
begin
  if v = saya then raise exception 'Tidak bisa menghapus diri sendiri. Minta admin lain.'; end if;
  delete from public.app_admin where email = v;
  if not found then raise exception '% bukan admin.', v; end if;
  insert into public.app_admin_log (oleh, aksi, email) values (saya, 'hapus', v);
  return jsonb_build_object('ok', true, 'email', v);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Hak panggil
-- ---------------------------------------------------------------------------
revoke all on function public.admin__wajib()                 from public, anon, authenticated;
revoke all on function public.admin_daftar()                 from public, anon;
revoke all on function public.admin_tambah(text, boolean)    from public, anon;
revoke all on function public.admin_hapus(text)              from public, anon;
revoke all on function public.gng_simpan_admin(text, text)   from public, anon;
grant execute on function public.admin_daftar()              to authenticated;
grant execute on function public.admin_tambah(text, boolean) to authenticated;
grant execute on function public.admin_hapus(text)           to authenticated;
grant execute on function public.gng_simpan_admin(text, text) to authenticated;
grant execute on function public.op_is_admin()               to authenticated;
grant execute on function public.gng_is_admin()              to authenticated;
grant execute on function public.site_is_admin()             to authenticated;

notify pgrst, 'reload schema';

-- Cek sesudah dijalankan:
--   select * from public.app_admin;          -- tiga email di atas (+ admin Asesmen lama)
--   select * from public.app_admin_log;
