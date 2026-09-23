-- =============================================================================
-- MiningMalut · Gudang data site untuk Digital Twin (23 September 2026)
--
-- Satu tempat untuk topo, citra, jaringan jalan beserta batas kecepatannya,
-- area kerja, dan model 3D unit. Dibaca Digital Twin, Water & Road, AMORA,
-- Speed Watcher (halaman), dan Worker speed-watcher-24-7.
--
-- Jalankan sekali di Supabase → SQL Editor. Aman diulang: tidak ada data yang
-- dihapus, dan tabel yang sudah ada tidak disentuh isinya.
--
-- Keamanan
--   - Tabel site_* tertutup untuk akses langsung (RLS tanpa policy). Semua baca
--     dan tulis lewat fungsi di bawah.
--   - Menulis (terbit, pulihkan, unggah berkas) hanya untuk admin, dan dijaga di
--     server: email di token login harus lolos op_is_admin() ATAU tercatat di
--     gng_admin (Kelola → Admin di Asesmen Go/No-Go). Menambah admin cukup dari
--     layar itu.
--   - Membaca untuk semua akun yang login.
--   - Satu-satunya yang boleh dibaca tanpa login adalah site_jalan_worker():
--     geometri jalan ringkas + batas kecepatan untuk Worker. Isinya sama dengan
--     yang memang sudah terbuka di /api/batas dan /api/jalan Worker.
--
-- Tidak pernah menimpa diam-diam
--   - Setiap terbit menjadi versi baru. Versi lama tidak dihapus.
--   - Terbit membawa "versi dasar" yang dilihat admin. Kalau versi aktif sudah
--     berubah sejak itu (admin lain menerbitkan lebih dulu), terbit ditolak
--     dengan jawaban {galat:'bentrok', ...} dan tidak ada yang berubah.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Admin data site
-- ---------------------------------------------------------------------------
create or replace function public.site_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  ada boolean := false;
begin
  if e = '' then
    return false;
  end if;
  -- Lima daftar admin lama (§22.10) lewat fungsi yang sudah ada.
  if to_regprocedure('public.op_is_admin()') is not null then
    execute 'select public.op_is_admin()' into ada;
    if ada then
      return true;
    end if;
  end if;
  -- Admin yang ditambahkan lewat Kelola → Admin di Asesmen Go/No-Go.
  if to_regclass('public.gng_admin') is not null then
    execute 'select exists (select 1 from public.gng_admin where lower(email) = $1)' into ada using e;
    if ada then
      return true;
    end if;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------
create table if not exists public.site_versi (
  jenis          text        not null check (jenis in ('topo','citra','jalan','area','armada')),
  versi          integer     not null check (versi > 0),
  judul          text        not null,
  tanggal        date,
  -- bingkai, ukuran, statistik; dibaca modul untuk memasang berkas
  meta           jsonb       not null default '{}'::jsonb,
  -- lokasi berkas: "repo:data/site/…" (Cloudflare Pages) atau "sb:<jalur di bucket site-data>"
  berkas         jsonb       not null default '{}'::jsonb,
  -- isi kecil (jalan, area, armada) disimpan langsung di sini
  data           jsonb,
  -- jalan ringkas untuk Worker: {batas_luar, toleransi_m, ruas:[{n,b,bb,p:[[lon,lat]…]}]}
  data_worker    jsonb,
  catatan        text,
  dibuat_oleh    text        not null,
  dibuat_pada    timestamptz not null default now(),
  berkas_dihapus boolean     not null default false,
  primary key (jenis, versi)
);

create table if not exists public.site_aktif (
  jenis        text        primary key check (jenis in ('topo','citra','jalan','area','armada')),
  versi        integer     not null,
  diubah_oleh  text        not null,
  diubah_pada  timestamptz not null default now(),
  foreign key (jenis, versi) references public.site_versi (jenis, versi)
);

create table if not exists public.site_log (
  id       bigint generated always as identity primary key,
  waktu    timestamptz not null default now(),
  oleh     text        not null,
  aksi     text        not null,      -- terbit · pulihkan · hapus_berkas
  jenis    text        not null,
  versi    integer,
  catatan  text
);

alter table public.site_versi enable row level security;
alter table public.site_aktif enable row level security;
alter table public.site_log   enable row level security;
revoke all on public.site_versi, public.site_aktif, public.site_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pemeriksaan isi jalan untuk Worker. Mengembalikan pesan galat, atau null.
-- Worker juga memeriksa sendiri, tapi data yang rusak sebaiknya tidak pernah
-- sampai ke tabel.
-- ---------------------------------------------------------------------------
create or replace function public.site__cek_jalan_worker(w jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
-- Aturannya sama dengan periksaJalan() di Worker versi 9 dan terbitJalan() di
-- Digital Twin, dan di sini sedikit lebih ketat (angka harus berupa angka JSON,
-- batas sel 14.000), supaya versi yang diterima tabel tidak pernah ditolak Worker.
declare
  r    jsonb;
  pt   jsonb;
  lama jsonb;
  b    numeric;
  tol  numeric := 20;
  pad  numeric;
  sel  bigint := 0;
  tit  int := 0;
  n    int := 0;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric;
begin
  if w is null or jsonb_typeof(w) is distinct from 'object' then
    return 'Jalan untuk Worker kosong.';
  end if;
  if jsonb_typeof(w -> 'batas_luar') is distinct from 'number' then
    return 'Batas di luar ruas belum diisi.';
  end if;
  b := (w ->> 'batas_luar')::numeric;
  if b < 5 or b > 80 then
    return 'Batas di luar ruas harus 5–80 km/jam.';
  end if;
  if w ? 'toleransi_m' and jsonb_typeof(w -> 'toleransi_m') is distinct from 'null' then
    if jsonb_typeof(w -> 'toleransi_m') is distinct from 'number' then
      return 'Toleransi dari sumbu harus berupa angka.';
    end if;
    tol := (w ->> 'toleransi_m')::numeric;
    if tol < 5 or tol > 60 then
      return 'Toleransi dari sumbu harus 5–60 m.';
    end if;
  end if;
  pad := greatest(0.00025, (tol + 5) / 111000.0);
  if jsonb_typeof(w -> 'ruas') is distinct from 'array' or jsonb_array_length(w -> 'ruas') = 0 then
    return 'Tidak ada ruas jalan.';
  end if;
  if jsonb_array_length(w -> 'ruas') > 400 then
    return 'Terlalu banyak potongan ruas (' || jsonb_array_length(w -> 'ruas') || ').';
  end if;
  for r in select * from jsonb_array_elements(w -> 'ruas') loop
    n := n + 1;
    if jsonb_typeof(r -> 'n') is distinct from 'string' or coalesce(trim(r ->> 'n'), '') = '' then
      return 'Ruas ke-' || n || ' tidak bernama.';
    end if;
    if trim(r ->> 'n') !~ '^[A-Za-z0-9][A-Za-z0-9 _.()/+-]{0,39}$' then
      return 'Nama ruas "' || left(r ->> 'n', 40) || '" memakai tanda yang tidak diterima.';
    end if;
    if jsonb_typeof(r -> 'b') is distinct from 'number' then
      return 'Ruas ' || (r ->> 'n') || ' belum punya batas kecepatan.';
    end if;
    b := (r ->> 'b')::numeric;
    if b < 5 or b > 80 then
      return 'Batas ruas ' || (r ->> 'n') || ' harus 5–80 km/jam.';
    end if;
    if jsonb_typeof(r -> 'p') is distinct from 'array' or jsonb_array_length(r -> 'p') < 2 then
      return 'Ruas ' || (r ->> 'n') || ' kurang dari dua titik.';
    end if;
    lama := null;
    for pt in select * from jsonb_array_elements(r -> 'p') loop
      tit := tit + 1;
      if jsonb_typeof(pt) is distinct from 'array' or jsonb_array_length(pt) < 2
         or jsonb_typeof(pt -> 0) is distinct from 'number' or jsonb_typeof(pt -> 1) is distinct from 'number'
         or (pt ->> 0)::numeric not between 128.30 and 128.38
         or (pt ->> 1)::numeric not between 0.75 and 0.83 then
        return 'Titik ruas ' || (r ->> 'n') || ' di luar wilayah Pulau Pakal.';
      end if;
      if lama is not null then
        x1 := (lama ->> 0)::numeric; y1 := (lama ->> 1)::numeric;
        x2 := (pt ->> 0)::numeric;   y2 := (pt ->> 1)::numeric;
        sel := sel + (floor((greatest(x1, x2) + pad) / 0.0005) - floor((least(x1, x2) - pad) / 0.0005) + 1)
                   * (floor((greatest(y1, y2) + pad) / 0.0005) - floor((least(y1, y2) - pad) / 0.0005) + 1);
      end if;
      lama := pt;
    end loop;
  end loop;
  if tit > 20000 then
    return 'Terlalu banyak titik jalan (' || tit || ').';
  end if;
  -- Worker menolak di atas 15.000 sel indeks grid (anggaran CPU 10 ms); di sini
  -- 14.000 supaya selisih pembulatan tidak pernah membuat tabel menerima yang
  -- ditolak Worker. Jaringan sekarang ±2.500 sel.
  if sel > 14000 then
    return 'Indeks jalan terlalu besar untuk Worker (' || sel || ' sel, paling banyak 14.000). Tambah simpul antara pada penggal yang sangat panjang, atau kecilkan toleransi.';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Baca
-- ---------------------------------------------------------------------------
create or replace function public.site_saya()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email', lower(coalesce(auth.jwt() ->> 'email', '')),
    'admin', public.site_is_admin());
$$;

-- Daftar isi: versi aktif tiap jenis, lengkap dengan meta dan lokasi berkasnya.
create or replace function public.site_manifest()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cap', (select coalesce(string_agg(jenis || ':' || versi, ',' order by jenis), '') from site_aktif),
    'jenis', coalesce((
      select jsonb_object_agg(a.jenis, jsonb_build_object(
        'versi', v.versi, 'judul', v.judul, 'tanggal', v.tanggal,
        'meta', v.meta, 'berkas', v.berkas,
        'dibuat_oleh', v.dibuat_oleh, 'dibuat_pada', v.dibuat_pada,
        'diubah_oleh', a.diubah_oleh, 'diubah_pada', a.diubah_pada,
        'jumlah_versi', (select count(*) from site_versi x where x.jenis = a.jenis)))
      from site_aktif a
      join site_versi v on v.jenis = a.jenis and v.versi = a.versi), '{}'::jsonb));
$$;

-- Tanda perubahan yang murah untuk diperiksa berkala: "area:1,armada:1,citra:2,…".
create or replace function public.site_cap()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(string_agg(jenis || ':' || versi, ',' order by jenis), '') from site_aktif;
$$;

-- Isi satu versi (jalan, area, armada). Versi kosong = versi aktif.
create or replace function public.site_data(p_jenis text, p_versi integer default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('jenis', v.jenis, 'versi', v.versi, 'judul', v.judul,
                            'meta', v.meta, 'berkas', v.berkas, 'data', v.data)
  from site_versi v
  where v.jenis = p_jenis
    and v.versi = coalesce(p_versi, (select versi from site_aktif where jenis = p_jenis));
$$;

-- Riwayat versi satu jenis (tanpa isi), terbaru di atas, plus catatan aksi terakhir.
create or replace function public.site_riwayat(p_jenis text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'aktif', (select versi from site_aktif where jenis = p_jenis),
    'versi', coalesce((
      select jsonb_agg(jsonb_build_object(
        'versi', v.versi, 'judul', v.judul, 'tanggal', v.tanggal, 'meta', v.meta,
        'berkas', v.berkas, 'catatan', v.catatan, 'dibuat_oleh', v.dibuat_oleh,
        'dibuat_pada', v.dibuat_pada, 'berkas_dihapus', v.berkas_dihapus)
        order by v.versi desc)
      from site_versi v where v.jenis = p_jenis), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('waktu', l.waktu, 'oleh', l.oleh, 'aksi', l.aksi,
                                          'versi', l.versi, 'catatan', l.catatan) order by l.id desc)
      from (select * from site_log where jenis = p_jenis order by id desc limit 30) l), '[]'::jsonb));
$$;

-- Pemakaian penyimpanan. Bucket gratis 1 GB dipakai bersama foto Go/No-Go.
create or replace function public.site_penyimpanan()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  select jsonb_build_object(
    'site_data', coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'site-data'), 0),
    'semua',     coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects), 0));
$$;

-- Untuk Worker speed-watcher-24-7 (tanpa login). Bila versi yang dipegang
-- Worker masih aktif, jawabannya hanya {versi, sama:true}; isinya dikirim
-- hanya saat versi berubah, supaya pemeriksaan tiap 5 menit tetap kecil.
create or replace function public.site_jalan_worker(p_versi integer default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.versi is null then jsonb_build_object('versi', 0)
    when p_versi is not null and p_versi = a.versi then jsonb_build_object('versi', a.versi, 'sama', true)
    else jsonb_build_object('versi', a.versi, 'judul', v.judul, 'diubah_pada', a.diubah_pada,
                            'data', v.data_worker)
  end
  from (select 1) satu
  left join site_aktif a on a.jenis = 'jalan'
  left join site_versi v on v.jenis = a.jenis and v.versi = a.versi;
$$;

-- ---------------------------------------------------------------------------
-- Tulis (admin)
-- ---------------------------------------------------------------------------
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
  if p_jenis not in ('topo','citra','jalan','area','armada') then
    raise exception 'Jenis data tidak dikenal: %', p_jenis;
  end if;
  if p_jenis in ('topo','citra') and (p_berkas is null or p_berkas = '{}'::jsonb) then
    raise exception 'Berkas % belum ada.', p_jenis;
  end if;
  if p_jenis in ('jalan','area','armada') and p_data is null then
    raise exception 'Isi % kosong.', p_jenis;
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

-- Menjadikan versi lama aktif lagi. Tidak ada data yang dihapus.
create or replace function public.site_pulihkan(p_jenis text, p_versi integer, p_dasar integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  kini record;
  v    record;
begin
  if not public.site_is_admin() then
    raise exception 'Hanya admin yang boleh memulihkan versi.';
  end if;
  select * into v from site_versi where jenis = p_jenis and versi = p_versi;
  if not found then
    raise exception 'Versi % v% tidak ada.', p_jenis, p_versi;
  end if;
  if v.berkas_dihapus then
    raise exception 'Berkas versi ini sudah dihapus dari penyimpanan, jadi tidak bisa dipulihkan.';
  end if;
  perform pg_advisory_xact_lock(hashtext('site_terbit:' || p_jenis));
  select versi, diubah_oleh, diubah_pada into kini from site_aktif where jenis = p_jenis for update;
  if coalesce(kini.versi, 0) <> coalesce(p_dasar, 0) then
    return jsonb_build_object('galat', 'bentrok', 'versi_kini', kini.versi,
                              'oleh', kini.diubah_oleh, 'pada', kini.diubah_pada);
  end if;
  insert into site_aktif (jenis, versi, diubah_oleh) values (p_jenis, p_versi, e)
  on conflict (jenis) do update
    set versi = excluded.versi, diubah_oleh = excluded.diubah_oleh, diubah_pada = now();
  insert into site_log (oleh, aksi, jenis, versi, catatan)
  values (e, 'pulihkan', p_jenis, p_versi, 'dari v' || coalesce(kini.versi::text, '-'));
  return jsonb_build_object('versi', p_versi);
end;
$$;

-- Menandai berkas sebuah versi lama sudah dihapus dari bucket (untuk menghemat
-- kuota 1 GB). Versi aktif tidak bisa. Isi di tabel tetap ada sebagai riwayat.
create or replace function public.site_hapus_berkas(p_jenis text, p_versi integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.site_is_admin() then
    raise exception 'Hanya admin yang boleh menghapus berkas.';
  end if;
  if p_jenis not in ('topo','citra') then
    raise exception 'Hanya topo dan citra yang punya berkas di penyimpanan.';
  end if;
  if exists (select 1 from site_aktif where jenis = p_jenis and versi = p_versi) then
    raise exception 'Versi aktif tidak bisa dihapus berkasnya.';
  end if;
  update site_versi set berkas_dihapus = true where jenis = p_jenis and versi = p_versi;
  if not found then
    raise exception 'Versi % v% tidak ada.', p_jenis, p_versi;
  end if;
  insert into site_log (oleh, aksi, jenis, versi) values (e, 'hapus_berkas', p_jenis, p_versi);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak panggil
-- ---------------------------------------------------------------------------
revoke all on function public.site_is_admin()                   from public, anon;
revoke all on function public.site__cek_jalan_worker(jsonb)     from public, anon, authenticated;
revoke all on function public.site_saya()                       from public, anon;
revoke all on function public.site_manifest()                   from public, anon;
revoke all on function public.site_cap()                        from public, anon;
revoke all on function public.site_data(text, integer)          from public, anon;
revoke all on function public.site_riwayat(text)                from public, anon;
revoke all on function public.site_penyimpanan()                from public, anon;
revoke all on function public.site_jalan_worker(integer)        from public;
revoke all on function public.site_terbit(text, text, date, jsonb, jsonb, jsonb, jsonb, text, integer) from public, anon;
revoke all on function public.site_pulihkan(text, integer, integer) from public, anon;
revoke all on function public.site_hapus_berkas(text, integer)  from public, anon;

grant execute on function public.site_is_admin()                to authenticated;
grant execute on function public.site_saya()                    to authenticated;
grant execute on function public.site_manifest()                to authenticated;
grant execute on function public.site_cap()                     to authenticated;
grant execute on function public.site_data(text, integer)       to authenticated;
grant execute on function public.site_riwayat(text)             to authenticated;
grant execute on function public.site_penyimpanan()             to authenticated;
grant execute on function public.site_jalan_worker(integer)     to anon, authenticated;
grant execute on function public.site_terbit(text, text, date, jsonb, jsonb, jsonb, jsonb, text, integer) to authenticated;
grant execute on function public.site_pulihkan(text, integer, integer) to authenticated;
grant execute on function public.site_hapus_berkas(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Penyimpanan berkas · bucket PRIVAT site-data
-- Topo (.dtg) dan citra (.webp/.jpg) hasil olahan di peramban admin.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-data', 'site-data', false, 52428800,
        array['image/webp', 'image/jpeg', 'image/png', 'application/octet-stream', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site data lihat" on storage.objects;
create policy "site data lihat" on storage.objects
  for select to authenticated using (bucket_id = 'site-data');

drop policy if exists "site data unggah" on storage.objects;
create policy "site data unggah" on storage.objects
  for insert to authenticated with check (bucket_id = 'site-data' and public.site_is_admin());

drop policy if exists "site data ganti" on storage.objects;
create policy "site data ganti" on storage.objects
  for update to authenticated using (bucket_id = 'site-data' and public.site_is_admin());

drop policy if exists "site data hapus" on storage.objects;
create policy "site data hapus" on storage.objects
  for delete to authenticated using (bucket_id = 'site-data' and public.site_is_admin());

-- ---------------------------------------------------------------------------
-- Pemeriksaan sesudah dijalankan (boleh dicoba satu per satu):
--   select public.site_cap();                 -- '' sebelum disemai dari Digital Twin
--   select public.site_jalan_worker(null);    -- {"versi": 0} sebelum disemai
--   select id, public from storage.buckets where id = 'site-data';   -- public = false
-- ---------------------------------------------------------------------------
