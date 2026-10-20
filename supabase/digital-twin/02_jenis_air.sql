-- =============================================================================
-- MiningMalut · Gudang data site: jenis data 'air' (20 Oktober 2026)
--
-- Lapisan Air & sump di Digital Twin: lokasi dan luasan sump, berm dan parit yang
-- ditanam ke hitungan catchment, parit pinggir jalan per ruas, pengaturan sump
-- alami, dan keputusan admin atas titik air yang keluar dari bukaan ke vegetasi.
-- Isinya satu JSON di site_versi.data, diterbitkan dari Kelola data › Air & sump.
-- Catchment dan alur air TIDAK disimpan: dihitung di peramban dari topo aktif.
--
-- Untuk gudang yang sudah terpasang (01_gudang_data_site.sql, 23 September 2026).
-- Jalankan sekali di Supabase → SQL Editor. Aman diulang; tidak ada data yang
-- dihapus atau diubah. Tanpa berkas ini, terbit dari Kelola data › Air & sump
-- ditolak dengan pesan "Jenis data tidak dikenal: air".
-- =============================================================================
begin;

-- jenis 'air' diterima di kedua tabel
alter table public.site_versi drop constraint if exists site_versi_jenis_check;
alter table public.site_versi add constraint site_versi_jenis_check
  check (jenis in ('topo','citra','jalan','area','armada','air'));
alter table public.site_aktif drop constraint if exists site_aktif_jenis_check;
alter table public.site_aktif add constraint site_aktif_jenis_check
  check (jenis in ('topo','citra','jalan','area','armada','air'));

-- terbit menerima 'air' (isi wajib, harus memuat daftar sump); selebihnya sama
create or replace function public.site_terbit(
  p_jenis       text,
  p_judul       text,
  p_tanggal     date,
  p_meta        jsonb,
  p_berkas      jsonb,
  p_data        jsonb,
  p_data_worker jsonb,
  p_catatan     text,
  p_dasar       integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e       text := lower(coalesce(auth.jwt() ->> 'email', ''));
  kini    record;
  baru    integer;
  galat   text;
begin
  if not public.site_is_admin() then
    raise exception 'Hanya admin yang boleh menerbitkan data site.';
  end if;
  if p_jenis not in ('topo','citra','jalan','area','armada','air') then
    raise exception 'Jenis data tidak dikenal: %', p_jenis;
  end if;
  if p_jenis in ('topo','citra') and (p_berkas is null or p_berkas = '{}'::jsonb) then
    raise exception 'Berkas % belum ada.', p_jenis;
  end if;
  if p_jenis in ('jalan','area','armada','air') and p_data is null then
    raise exception 'Isi % kosong.', p_jenis;
  end if;
  if p_jenis = 'air' and jsonb_typeof(p_data -> 'sump') is distinct from 'array' then
    raise exception 'Isi air harus memuat daftar sump.';
  end if;
  if p_data is not null and octet_length(p_data::text) > 3000000 then
    raise exception 'Isi terlalu besar (% byte).', octet_length(p_data::text);
  end if;
  if p_jenis = 'jalan' then
    galat := public.site__cek_jalan_worker(p_data_worker);
    if galat is not null then
      raise exception '%', galat;
    end if;
  end if;

  -- Satu penerbit per jenis pada satu waktu.
  perform pg_advisory_xact_lock(hashtext('site_terbit:' || p_jenis));
  select versi, diubah_oleh, diubah_pada into kini from site_aktif where jenis = p_jenis for update;
  if coalesce(kini.versi, 0) <> coalesce(p_dasar, 0) then
    return jsonb_build_object('galat', 'bentrok', 'versi_kini', kini.versi,
                              'oleh', kini.diubah_oleh, 'pada', kini.diubah_pada);
  end if;

  select coalesce(max(versi), 0) + 1 into baru from site_versi where jenis = p_jenis;
  insert into site_versi (jenis, versi, judul, tanggal, meta, berkas, data, data_worker, catatan, dibuat_oleh)
  values (p_jenis, baru,
          left(coalesce(nullif(trim(p_judul), ''), p_jenis || ' v' || baru), 120),
          p_tanggal, coalesce(p_meta, '{}'::jsonb), coalesce(p_berkas, '{}'::jsonb),
          p_data, case when p_jenis = 'jalan' then p_data_worker else null end,
          nullif(trim(coalesce(p_catatan, '')), ''), e);
  insert into site_aktif (jenis, versi, diubah_oleh) values (p_jenis, baru, e)
  on conflict (jenis) do update
    set versi = excluded.versi, diubah_oleh = excluded.diubah_oleh, diubah_pada = now();
  insert into site_log (oleh, aksi, jenis, versi, catatan) values (e, 'terbit', p_jenis, baru, p_catatan);
  return jsonb_build_object('versi', baru);
end;
$$;

grant execute on function public.site_terbit(text, text, date, jsonb, jsonb, jsonb, jsonb, text, integer) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Pemeriksaan sesudah dijalankan:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('site_versi_jenis_check', 'site_aktif_jenis_check');   -- keduanya memuat 'air'
--   select public.site_cap();   -- tidak berubah; 'air:1' muncul sesudah terbit pertama
-- ---------------------------------------------------------------------------
