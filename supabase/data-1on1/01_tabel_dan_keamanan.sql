-- =====================================================================
-- DATA 1ON1 · tabel isian bulanan + bucket template (privat)
-- Jalankan sekali di Supabase → SQL Editor. Aman dijalankan ulang.
-- Butuh fungsi public.op_is_admin() dari Operator Performance (01_tabel_dan_keamanan.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Satu baris per bulan ('2026-09'): seluruh isian halaman Data 1on1
-- (parameter PLAN, cadangan PPT, QAQC harian, loader, biaya, DRA, WM).
-- Semua pengguna login boleh membaca (untuk unduh Excel); hanya admin
-- yang boleh menulis. Tidak ada hapus lewat halaman.
-- ---------------------------------------------------------------------
create table if not exists public.oe_1on1 (
  bulan       text primary key check (bulan ~ '^\d{4}-\d{2}$'),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
comment on table public.oe_1on1 is
  'Isian bulanan fitur Data 1on1 (Mine Production). Satu baris per bulan. Lihat dokumentasi §25.';

alter table public.oe_1on1 enable row level security;

drop policy if exists "oe1on1 baca" on public.oe_1on1;
create policy "oe1on1 baca" on public.oe_1on1
  for select to authenticated using (true);

drop policy if exists "oe1on1 tambah" on public.oe_1on1;
create policy "oe1on1 tambah" on public.oe_1on1
  for insert to authenticated with check (public.op_is_admin());

drop policy if exists "oe1on1 ubah" on public.oe_1on1;
create policy "oe1on1 ubah" on public.oe_1on1
  for update to authenticated using (public.op_is_admin()) with check (public.op_is_admin());

revoke all on public.oe_1on1 from anon;
grant select, insert, update on public.oe_1on1 to authenticated;

-- cap waktu & penyunting diisi server, bukan halaman
create or replace function public.oe_1on1_cap()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  return new;
end;
$$;
drop trigger if exists oe_1on1_cap on public.oe_1on1;
create trigger oe_1on1_cap before insert or update on public.oe_1on1
  for each row execute function public.oe_1on1_cap();

-- ---------------------------------------------------------------------
-- Bucket PRIVAT "oe-1on1": template kosong Excel (template/…xlsx).
-- Template tidak ditaruh di GitHub karena repo publik.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('oe-1on1', 'oe-1on1', false, 20971520,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "oe1on1 template lihat" on storage.objects;
create policy "oe1on1 template lihat" on storage.objects
  for select to authenticated using (bucket_id = 'oe-1on1');

drop policy if exists "oe1on1 template unggah" on storage.objects;
create policy "oe1on1 template unggah" on storage.objects
  for insert to authenticated with check (bucket_id = 'oe-1on1' and public.op_is_admin());

drop policy if exists "oe1on1 template ganti" on storage.objects;
create policy "oe1on1 template ganti" on storage.objects
  for update to authenticated using (bucket_id = 'oe-1on1' and public.op_is_admin());

drop policy if exists "oe1on1 template hapus" on storage.objects;
create policy "oe1on1 template hapus" on storage.objects
  for delete to authenticated using (bucket_id = 'oe-1on1' and public.op_is_admin());

-- halaman bertanya "apakah saya admin?" ke server (tidak menambah daftar admin baru)
grant execute on function public.op_is_admin() to authenticated;

-- Cek cepat sesudah dijalankan:
--   select policyname, cmd from pg_policies where tablename = 'oe_1on1';
--   select id, public from storage.buckets where id = 'oe-1on1';
