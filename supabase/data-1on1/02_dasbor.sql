-- =====================================================================
-- DASHBOARD PRODUKSI · snapshot hasil hitung + setelan dashboard
-- Jalankan sekali di Supabase → SQL Editor, SESUDAH 01_tabel_dan_keamanan.sql.
-- Aman dijalankan ulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Satu baris per kunci:
--   'setelan'        kuota produksi tahunan dan acuan OPEX (hanya admin menulis)
--   'snap|2026-09'   hasil hitung dashboard bulan itu (snapshot). Boleh ditulis
--                    semua pengguna login: isinya turunan isian oe_1on1 + Minerva,
--                    dan halaman menghitung ulang sendiri bila sidiknya tidak cocok.
-- Semua pengguna login boleh membaca. Tidak ada hapus lewat halaman.
-- Angka kuota TIDAK ditulis di berkas ini (repo publik); diisi admin di halaman.
-- ---------------------------------------------------------------------
create table if not exists public.oe_dasbor (
  kunci       text primary key check (kunci = 'setelan' or kunci ~ '^snap\|\d{4}-\d{2}$'),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
comment on table public.oe_dasbor is
  'Dashboard Produksi (Mine Production): setelan dan snapshot hasil hitung per bulan. Lihat dokumentasi §27.';

alter table public.oe_dasbor enable row level security;

drop policy if exists "oedasbor baca" on public.oe_dasbor;
create policy "oedasbor baca" on public.oe_dasbor
  for select to authenticated using (true);

drop policy if exists "oedasbor tambah" on public.oe_dasbor;
create policy "oedasbor tambah" on public.oe_dasbor
  for insert to authenticated
  with check (kunci like 'snap|%' or public.op_is_admin());

drop policy if exists "oedasbor ubah" on public.oe_dasbor;
create policy "oedasbor ubah" on public.oe_dasbor
  for update to authenticated
  using (kunci like 'snap|%' or public.op_is_admin())
  with check (kunci like 'snap|%' or public.op_is_admin());

revoke all on public.oe_dasbor from anon;
grant select, insert, update on public.oe_dasbor to authenticated;

-- cap waktu & penyunting diisi server (fungsi yang sama dengan oe_1on1)
drop trigger if exists oe_dasbor_cap on public.oe_dasbor;
create trigger oe_dasbor_cap before insert or update on public.oe_dasbor
  for each row execute function public.oe_1on1_cap();

-- Simpanan laporan Minerva (folder minerva/ di bucket oe-1on1) ditulis Edge
-- Function oe-minerva dengan kunci service role, jadi tidak butuh kebijakan
-- tambahan. Pengguna login sudah boleh membaca seluruh bucket (kebijakan
-- "oe1on1 template lihat" di 01_tabel_dan_keamanan.sql).

-- Cek cepat sesudah dijalankan:
--   select policyname, cmd from pg_policies where tablename = 'oe_dasbor';
--   select kunci, updated_at, updated_by from public.oe_dasbor order by kunci;
