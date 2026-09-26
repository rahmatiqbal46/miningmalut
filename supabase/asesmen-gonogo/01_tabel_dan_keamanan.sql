-- =============================================================================
-- Asesmen Go/No-Go · Cek Aman Sebelum Bekerja (F-09.283.020.R0)
-- 01 · Tabel, keamanan, bucket foto
--
-- Jalankan di Supabase → SQL Editor. Aman dijalankan ulang.
--
-- Prinsip keamanan:
--   * Semua tabel gng_* ber-RLS TANPA policy. Tidak ada yang bisa membaca atau
--     menulis langsung lewat REST, baik anon maupun authenticated.
--   * Semua akses lewat fungsi (02_fungsi.sql) yang memeriksa siapa pemanggilnya:
--       - operator / pengawas  → token sesi NPP (bukan akun Supabase)
--       - Mining               → login Supabase biasa (authenticated)
--       - Admin                → login Supabase + email ada di app_admin (Kelola Admin)
--   * Operator dan pengawas SENGAJA tidak dibuatkan akun Supabase. Kalau dibuat,
--     mereka ikut mendapat hak baca/tulis tabel lain (dashboard, op_*) yang
--     terbuka untuk semua pengguna authenticated.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Akun operator & pengawas. Masuk dengan NPP; pengawas ditambah PIN.
-- NPP boleh format apa pun (angka, huruf, tanda hubung). Saat masuk, NPP
-- dicocokkan tanpa spasi/tanda baca, tanpa beda huruf besar-kecil, dan tanpa
-- nol di depan untuk NPP yang berupa angka (lihat gng__npp di 02).
-- ---------------------------------------------------------------------------
create table if not exists public.gng_akun (
  npp              text primary key,
  nama             text not null,
  peran            text not null check (peran in ('operator','pengawas')),
  jabatan          text,
  alat_bawaan      text,                 -- tebakan jenis alat dari jabatan, untuk isian awal form
  pin_hash         text,                 -- hanya pengawas (bcrypt)
  pin_awal         boolean not null default true,   -- true = PIN masih sama dengan NPP (belum pernah diganti)
  gagal_pin        int not null default 0,
  terkunci_sampai  timestamptz,
  aktif            boolean not null default true,
  sumber           text,                 -- 'eva' · 'pola-kerja' · 'admin'
  dibuat           timestamptz not null default now(),
  diubah           timestamptz not null default now(),
  diubah_oleh      text
);

create table if not exists public.gng_sesi (
  token_hash   text primary key,         -- sha256 token; token aslinya hanya ada di HP pengguna
  npp          text not null references public.gng_akun(npp) on delete cascade,
  peran        text not null,
  dibuat       timestamptz not null default now(),
  terakhir     timestamptz not null default now(),
  kedaluwarsa  timestamptz not null,
  perangkat    text
);
create index if not exists gng_sesi_npp on public.gng_sesi (npp);

-- ---------------------------------------------------------------------------
-- Pertanyaan form. alat null = semua alat. shift null = semua shift.
-- ---------------------------------------------------------------------------
create table if not exists public.gng_pertanyaan (
  id          int primary key,
  bagian      text not null check (bagian in ('A','B','C','D','E')),
  urut        int not null,
  teks        text not null,
  ringkas     text not null,
  alat        text[],
  shift       int check (shift in (1,2)),
  aktif       boolean not null default true,
  diubah      timestamptz not null default now(),
  diubah_oleh text
);

create table if not exists public.gng_unit (
  nama        text primary key,
  alat        text not null,
  model       text,
  sumber      text not null default 'admin',   -- 'eva' · 'admin'
  aktif       boolean not null default true,
  diubah      timestamptz not null default now(),
  diubah_oleh text
);
create unique index if not exists gng_unit_nama_kecil on public.gng_unit (lower(nama));

create table if not exists public.gng_lokasi (
  nama        text primary key,
  sumber      text not null default 'admin',   -- 'eva' · 'rtup' · 'admin'
  aktif       boolean not null default true,
  diubah      timestamptz not null default now(),
  diubah_oleh text
);
create unique index if not exists gng_lokasi_nama_kecil on public.gng_lokasi (lower(nama));

-- Isian "Lainnya" dari operator, menunggu ditinjau admin
create table if not exists public.gng_manual (
  id          bigserial primary key,
  jenis       text not null check (jenis in ('unit','lokasi')),
  teks        text not null,
  alat        text,
  jumlah      int not null default 1,
  oleh        text,
  terakhir    timestamptz not null default now(),
  status      text not null default 'baru' check (status in ('baru','ditambah','diabaikan'))
);
create unique index if not exists gng_manual_unik on public.gng_manual (jenis, lower(teks));

-- Admin: sejak 26 September 2026 gng_admin bukan tabel lagi, melainkan VIEW di
-- atas public.app_admin (satu daftar admin untuk seluruh MiningMalut, dikelola
-- dari Mining Bureau → Kelola Admin). Dibuat oleh supabase/admin/01_admin_terpadu.sql.

-- ---------------------------------------------------------------------------
-- Form. id dibuat HP operator, jadi kiriman ulang saat sinyal putus-sambung
-- tidak pernah menghasilkan form ganda.
-- ---------------------------------------------------------------------------
create table if not exists public.gng_form (
  id                  uuid primary key,
  no                  text not null unique,
  npp                 text not null references public.gng_akun(npp),
  nama                text not null,
  alat                text not null,
  unit                text not null,
  unit_manual         boolean not null default false,
  lokasi              text not null,
  lokasi_manual       boolean not null default false,
  tanggal             date not null,              -- tanggal shift (shift 2 lewat tengah malam = tanggal mulai shift)
  shift               int not null check (shift in (1,2)),
  diisi               timestamptz not null,       -- jam operator mengisi (bisa lebih awal dari dikirim bila tanpa sinyal)
  dikirim             timestamptz not null default now(),
  pertanyaan          jsonb not null,             -- salinan pertanyaan persis seperti yang dijawab
  jawaban             jsonb not null,             -- {"id": "Y" | "T" | "NA"}
  evidence            jsonb not null default '{}'::jsonb,  -- {"id": {"ket": "...", "foto": ["path", ...]}}
  jumlah_tidak        int not null default 0,
  status              text not null default 'wait' check (status in ('wait','go','nogo')),
  keputusan_npp       text,
  keputusan_nama      text,
  keputusan_waktu     timestamptz,
  catatan             text,
  diubah              timestamptz not null default now()
);
create index if not exists gng_form_tanggal on public.gng_form (tanggal, shift);
create index if not exists gng_form_menunggu on public.gng_form (dikirim) where status = 'wait';
create index if not exists gng_form_npp on public.gng_form (npp, diisi desc);
create index if not exists gng_form_diubah on public.gng_form (diubah desc);

create table if not exists public.gng_nomor (
  tanggal date primary key,
  n       int not null default 0
);

-- ---------------------------------------------------------------------------
-- RLS menyala, tanpa policy: akses langsung ditolak untuk semua peran API.
-- ---------------------------------------------------------------------------
alter table public.gng_akun       enable row level security;
alter table public.gng_sesi       enable row level security;
alter table public.gng_pertanyaan enable row level security;
alter table public.gng_unit       enable row level security;
alter table public.gng_lokasi     enable row level security;
alter table public.gng_manual     enable row level security;
alter table public.gng_form       enable row level security;
alter table public.gng_nomor      enable row level security;

revoke all on public.gng_akun, public.gng_sesi, public.gng_pertanyaan, public.gng_unit,
  public.gng_lokasi, public.gng_manual, public.gng_admin, public.gng_form, public.gng_nomor
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bucket foto evidence. Privat. Unggahan hanya lewat Edge Function gng-foto
-- (memeriksa token NPP). Pengguna Mining yang login boleh membuat tautan
-- bertanda tangan untuk melihat foto di dashboard.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gng-foto', 'gng-foto', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

drop policy if exists "gng foto lihat" on storage.objects;
create policy "gng foto lihat" on storage.objects
  for select to authenticated using (bucket_id = 'gng-foto');
