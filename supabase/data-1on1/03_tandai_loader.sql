-- =====================================================================
-- DATA 1ON1 · tanda "pilihan loader sudah dicek" oleh semua pengguna login
-- Jalankan sekali di Supabase → SQL Editor, SESUDAH 01_tabel_dan_keamanan.sql.
-- Aman dijalankan ulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Satu baris per bulan ('2026-09'): pilihan loader Excel 1on1 sudah
-- diperiksa sampai tanggal `sampai`. Syarat unduh Excel di halaman.
--
-- Terpisah dari oe_1on1 karena dua hal:
--   1. pengguna non-admin boleh menandai, tetapi tetap tidak boleh
--      mengubah isian bulan itu (oe_1on1 hanya ditulis admin);
--   2. tanda ini bukan perubahan isian, jadi dashboard dan simpanan
--      Excel tidak perlu dihitung ulang karenanya.
-- Ditulis hanya lewat fungsi oe_tandai_loader di bawah: penanda dan
-- waktunya diisi server, dan tanggalnya tidak pernah mundur.
-- ---------------------------------------------------------------------
create table if not exists public.oe_1on1_cek (
  bulan   text primary key check (bulan ~ '^\d{4}-\d{2}$'),
  sampai  date not null,
  waktu   timestamptz not null default now(),
  oleh    text not null default ''
);
comment on table public.oe_1on1_cek is
  'Data 1on1: pilihan loader sudah dicek s.d. tanggal sampai (satu baris per bulan). Ditulis lewat oe_tandai_loader. Lihat dokumentasi §25 dan §27.16.';

alter table public.oe_1on1_cek enable row level security;

drop policy if exists "oe1on1cek baca" on public.oe_1on1_cek;
create policy "oe1on1cek baca" on public.oe_1on1_cek
  for select to authenticated using (true);

-- tidak ada kebijakan tambah/ubah/hapus: menulis hanya lewat fungsi
revoke all on public.oe_1on1_cek from anon, authenticated;
grant select on public.oe_1on1_cek to authenticated;

-- ---------------------------------------------------------------------
-- Tandai: boleh semua pengguna login. Tanggal harus di bulan itu dan
-- tidak lewat dari hari ini (WIT). Tanda yang sudah lebih jauh tidak
-- dimundurkan. Hasil = tanda yang berlaku sesudahnya.
-- ---------------------------------------------------------------------
create or replace function public.oe_tandai_loader(p_bulan text, p_sampai date)
returns public.oe_1on1_cek
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oleh  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_hasil public.oe_1on1_cek;
begin
  if auth.uid() is null then
    raise exception 'Harus login' using errcode = '42501';
  end if;
  if p_bulan is null or p_bulan !~ '^\d{4}-\d{2}$' then
    raise exception 'Bulan tidak sah: %', p_bulan using errcode = '22023';
  end if;
  if p_sampai is null or to_char(p_sampai, 'YYYY-MM') <> p_bulan then
    raise exception 'Tanggal % tidak di bulan %', p_sampai, p_bulan using errcode = '22023';
  end if;
  if p_sampai > (now() at time zone 'Asia/Jayapura')::date then
    raise exception 'Tanggal % belum tiba', p_sampai using errcode = '22023';
  end if;

  insert into public.oe_1on1_cek as c (bulan, sampai, waktu, oleh)
  values (p_bulan, p_sampai, now(), v_oleh)
  on conflict (bulan) do update
    set sampai = excluded.sampai, waktu = excluded.waktu, oleh = excluded.oleh
    where c.sampai < excluded.sampai
  returning * into v_hasil;

  if not found then
    select * into v_hasil from public.oe_1on1_cek where bulan = p_bulan;
  end if;
  return v_hasil;
end;
$$;

revoke all on function public.oe_tandai_loader(text, date) from public, anon;
grant execute on function public.oe_tandai_loader(text, date) to authenticated;

-- halaman langsung mengenali tabel & fungsi baru
notify pgrst, 'reload schema';

-- Cek cepat sesudah dijalankan:
--   select policyname, cmd from pg_policies where tablename = 'oe_1on1_cek';
--   select * from public.oe_1on1_cek order by bulan;
