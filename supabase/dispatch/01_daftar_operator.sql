-- =====================================================================
-- DISPATCH MONITORING · 01 · DAFTAR OPERATOR HANYA DIUBAH ADMIN
-- Jalankan sekali di Supabase → SQL Editor. Aman dijalankan ulang.
--
-- Operator tambahan Dispatch Monitoring (tab Kepatuhan Operator → Kelola
-- Daftar Operator) disimpan di tabel `dashboard`, satu baris per operator:
--
--   id   = 'dispatch|operator|<ID>'
--   data = { "type": "operator", "payload": { id, nama, ditambah, oleh, diubah } }
--
-- Kebijakan tulis tabel `dashboard` yang sudah ada sengaja terbuka untuk semua
-- pengguna login, karena laporan dan penilaian memang diisi dispatcher. Tanpa
-- berkas ini, panel Kelola Daftar Operator hanya disembunyikan dari non-admin;
-- secara teknis siapa pun yang login masih bisa menulis baris operator lewat
-- API.
--
-- Kebijakan RESTRICTIVE di bawah menambahkan satu syarat KHUSUS untuk baris
-- yang id-nya berawalan 'dispatch|operator|': penulisnya harus admin
-- (op_is_admin() = email ada di tabel app_admin, daftar Mining Bureau →
-- Kelola Admin). Kebijakan restrictive digabung dengan AND ke kebijakan yang
-- sudah ada, jadi:
--   · baris lain (laporan, penilaian, Mine Development, dll.) tidak berubah
--     sama sekali — dispatch_boleh_tulis() langsung bernilai true untuk mereka;
--   · membaca baris operator tetap boleh bagi semua pengguna login.
--
-- Kenapa lewat fungsi, bukan menulis op_is_admin() langsung di kebijakan:
-- Postgres memeriksa hak EXECUTE setiap fungsi yang disebut kebijakan untuk
-- SEMUA baris yang ditulis, bukan hanya baris operator. Peran yang tidak punya
-- hak menjalankan op_is_admin() akan gagal menulis baris apa pun. Fungsi
-- security definer di bawah memberi hak itu dengan sengaja dan hanya
-- mengembalikan ya/tidak — terbukti di uji Postgres 16 lokal.
--
-- Prasyarat: supabase/admin/01_admin_terpadu.sql sudah dijalankan (fungsi
-- public.op_is_admin() ada).
--
-- JANGAN menambahkan `alter table public.dashboard enable row level security`
-- di sini. Bila RLS tabel itu ternyata mati, menyalakannya tanpa menyiapkan
-- kebijakan baca/tulis lain akan menutup Mine Development dan Dispatch untuk
-- semua orang. Periksa dulu dengan kueri di bagian bawah.
-- =====================================================================

create or replace function public.dispatch_boleh_tulis(p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_id like 'dispatch|operator|%' then public.op_is_admin() else true end
$$;

revoke all on function public.dispatch_boleh_tulis(text) from public;
grant execute on function public.dispatch_boleh_tulis(text) to anon, authenticated, service_role;

drop policy if exists "dispatch operator tambah hanya admin" on public.dashboard;
create policy "dispatch operator tambah hanya admin" on public.dashboard
  as restrictive
  for insert
  to public
  with check (public.dispatch_boleh_tulis(id));

drop policy if exists "dispatch operator ubah hanya admin" on public.dashboard;
create policy "dispatch operator ubah hanya admin" on public.dashboard
  as restrictive
  for update
  to public
  using      (public.dispatch_boleh_tulis(id))
  with check (public.dispatch_boleh_tulis(id));

drop policy if exists "dispatch operator hapus hanya admin" on public.dashboard;
create policy "dispatch operator hapus hanya admin" on public.dashboard
  as restrictive
  for delete
  to public
  using (public.dispatch_boleh_tulis(id));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Cek sesudah dijalankan:
--
--   select policyname, permissive, cmd
--   from pg_policies where tablename = 'dashboard' order by policyname;
--     → tiga baris "dispatch operator … hanya admin" dengan permissive = RESTRICTIVE
--
--   select relrowsecurity from pg_class where oid = 'public.dashboard'::regclass;
--     → true. Bila false, kebijakan apa pun (termasuk tiga di atas) tidak
--       berlaku; jangan menyalakannya tanpa persiapan (lihat catatan di atas).
--
--   select id, data->'payload'->>'nama' as nama, updated_at
--   from public.dashboard where id like 'dispatch|operator|%' order by id;
--     → operator tambahan yang sudah tersimpan
--
-- Mencabut (kembali ke penjagaan tampilan saja):
--   drop policy "dispatch operator tambah hanya admin" on public.dashboard;
--   drop policy "dispatch operator ubah hanya admin"   on public.dashboard;
--   drop policy "dispatch operator hapus hanya admin"  on public.dashboard;
--   drop function public.dispatch_boleh_tulis(text);
-- ---------------------------------------------------------------------
