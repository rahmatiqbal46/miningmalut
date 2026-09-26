-- =====================================================================
-- OPERATOR PERFORMANCE · 01 · TABEL DAN KEAMANAN
-- Jalankan sekali di Supabase → SQL Editor. Aman dijalankan ulang.
--
-- Semua nama berawalan op_ supaya terpisah jelas dari tabel `dashboard`
-- yang dipakai Mine Development dan Dispatch Monitoring.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Daftar admin: public.op_is_admin() kini didefinisikan di
-- supabase/admin/01_admin_terpadu.sql dan membaca tabel app_admin, yang
-- dikelola dari Mining Bureau → Kelola Admin. Jalankan berkas itu lebih dulu.
-- Jangan definisikan ulang fungsi itu di sini dengan daftar email tertulis.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Operator. Satu baris per orang, dikunci badge.
-- Terisi sendiri dari data Minerva, tidak ada input manual.
-- ---------------------------------------------------------------------
create table if not exists public.op_operators (
  badge       text primary key,
  name        text not null,
  company     text not null check (company in ('ANTAM','PCM','LAIN')),
  photo_path  text,
  first_seen  date,
  last_seen   date,
  updated_at  timestamptz not null default now()
);

comment on column public.op_operators.company is
  'Dari panjang badge: 4 digit ANTAM, 5 digit PCM. Minerva tidak punya kolom perusahaan.';
comment on column public.op_operators.photo_path is
  'Jalur berkas di bucket op-foto. Foto dicocokkan lewat badge, JANGAN lewat nama.';

-- ---------------------------------------------------------------------
-- Nilai harian. Satu baris per operator per jenis alat per hari.
--
-- metrics berisi empat angka per komponen, sesuai header dua baris
-- berkas Minerva:
--   {"Productivity": {"a": 812, "t": 790, "p": 102.8, "s": 20}, ...}
--   a = Actual, t = Target, p = Percentage, s = Score
-- ---------------------------------------------------------------------
create table if not exists public.op_scores (
  score_date     date not null,
  badge          text not null references public.op_operators(badge) on delete cascade,
  equipment_type text not null check (equipment_type in ('exca','truck')),
  overall_score  numeric(6,2) not null,
  metrics        jsonb not null default '{}'::jsonb,
  has_target     boolean not null,
  final          boolean not null,
  source_rows    int not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (score_date, equipment_type, badge)
);

comment on column public.op_scores.has_target is
  'False bila ada komponen bertarget 0. Score tetap dapat nilai bawaan padahal tidak terukur, jadi baris ini tidak ikut peringkat.';
comment on column public.op_scores.final is
  'True bila diambil setelah hari itu selesai (≥ 06:50 WIT keesokan harinya). Baris sementara tidak ikut peringkat.';
comment on column public.op_scores.source_rows is
  'Jumlah baris Minerva yang digabung. Lebih dari 1 berarti badge yang sama muncul beberapa kali di hari itu.';

create index if not exists op_scores_badge_idx on public.op_scores (badge, score_date);

-- ---------------------------------------------------------------------
-- Catatan tiap sinkronisasi, dan satu tabel kecil untuk keadaan
-- pengisian data lama.
-- ---------------------------------------------------------------------
create table if not exists public.op_sync_log (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  source     text,
  mode       text,
  status     text not null check (status in ('ok','kosong','sebagian','gagal')),
  dates      text,
  rows_saved int default 0,
  rows_no_target int default 0,
  rows_other_badge int default 0,
  duration_ms int,
  message    text
);
create index if not exists op_sync_log_ran_idx on public.op_sync_log (ran_at desc);

create table if not exists public.op_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- PENULISAN · hanya dipanggil Edge Function (service role)
--
-- Satu tanggal + satu jenis alat disimpan sebagai satu kesatuan:
-- baris lama untuk pasangan itu dihapus, lalu diisi ulang. Operator
-- yang hilang dari tarikan terbaru ikut hilang, bukan tertinggal
-- sebagai sisa (aturan "kirim ulang berarti mengganti", dokumentasi §16).
--
-- Tarikan KOSONG tidak pernah sampai ke sini, jadi satu balasan kosong
-- dari Minerva tidak bisa menghapus data yang sudah ada.
-- =====================================================================
create or replace function public.op_simpan_hari(
  p_tanggal date,
  p_jenis   text,
  p_final   boolean,
  p_baris   jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then
    raise exception 'op_simpan_hari: baris kosong, tidak ada yang disimpan';
  end if;

  -- Orangnya dulu. Nama diperbarui hanya dari tanggal yang paling baru,
  -- supaya pengisian data lama tidak menimpa nama terkini.
  insert into op_operators as o (badge, name, company, first_seen, last_seen)
  select b->>'badge', b->>'name', b->>'company', p_tanggal, p_tanggal
  from jsonb_array_elements(p_baris) b
  on conflict (badge) do update set
    name       = case when p_tanggal >= coalesce(o.last_seen, p_tanggal) then excluded.name else o.name end,
    company    = excluded.company,
    first_seen = least(coalesce(o.first_seen, p_tanggal), p_tanggal),
    last_seen  = greatest(coalesce(o.last_seen, p_tanggal), p_tanggal),
    updated_at = now();

  delete from op_scores where score_date = p_tanggal and equipment_type = p_jenis;

  insert into op_scores (score_date, badge, equipment_type, overall_score,
                         metrics, has_target, final, source_rows)
  select p_tanggal, b->>'badge', p_jenis, (b->>'score')::numeric,
         coalesce(b->'metrics', '{}'::jsonb), (b->>'has_target')::boolean,
         p_final, coalesce((b->>'source_rows')::int, 1)
  from jsonb_array_elements(p_baris) b;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.op_simpan_hari(date, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.op_simpan_hari(date, text, boolean, jsonb) to service_role;

-- =====================================================================
-- KEAMANAN (Row Level Security)
--
-- Kunci anon Supabase ikut tersaji publik di index.html dan repo, jadi
-- tabel berisi nama dan badge orang TIDAK boleh terbaca tanpa login.
-- Semua policy baca di bawah hanya untuk `authenticated`.
-- Tidak ada policy tulis: penulisan hanya lewat service role
-- (Edge Function) dan lewat fungsi op_set_foto khusus admin.
-- =====================================================================
alter table public.op_operators enable row level security;
alter table public.op_scores    enable row level security;
alter table public.op_sync_log  enable row level security;
alter table public.op_state     enable row level security;

drop policy if exists "op baca operator" on public.op_operators;
create policy "op baca operator" on public.op_operators
  for select to authenticated using (true);

drop policy if exists "op baca nilai" on public.op_scores;
create policy "op baca nilai" on public.op_scores
  for select to authenticated using (true);

drop policy if exists "op baca log" on public.op_sync_log;
create policy "op baca log" on public.op_sync_log
  for select to authenticated using (true);

drop policy if exists "op baca state" on public.op_state;
create policy "op baca state" on public.op_state
  for select to authenticated using (true);

-- Memasang atau melepas foto. Diperiksa di server, bukan di tampilan.
create or replace function public.op_set_foto(p_badge text, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not op_is_admin() then
    raise exception 'Hanya admin yang boleh mengubah foto operator';
  end if;
  update op_operators set photo_path = p_path, updated_at = now()
  where badge = p_badge;
  if not found then
    raise exception 'Badge % tidak ada di daftar operator', p_badge;
  end if;
end;
$$;

revoke all on function public.op_set_foto(text, text) from public, anon;
grant execute on function public.op_set_foto(text, text) to authenticated;

-- =====================================================================
-- PENYIMPANAN FOTO · bucket PRIVAT
--
-- Privat: foto hanya bisa diambil pengguna yang login. Bucket publik
-- membuat wajah pegawai bisa dibuka siapa pun yang menebak alamatnya.
-- Unggah, ganti, dan hapus hanya untuk admin.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('op-foto', 'op-foto', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "op foto lihat" on storage.objects;
create policy "op foto lihat" on storage.objects
  for select to authenticated using (bucket_id = 'op-foto');

drop policy if exists "op foto unggah" on storage.objects;
create policy "op foto unggah" on storage.objects
  for insert to authenticated with check (bucket_id = 'op-foto' and public.op_is_admin());

drop policy if exists "op foto ganti" on storage.objects;
create policy "op foto ganti" on storage.objects
  for update to authenticated using (bucket_id = 'op-foto' and public.op_is_admin());

drop policy if exists "op foto hapus" on storage.objects;
create policy "op foto hapus" on storage.objects
  for delete to authenticated using (bucket_id = 'op-foto' and public.op_is_admin());
