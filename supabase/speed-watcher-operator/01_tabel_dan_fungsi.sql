-- =============================================================================
-- SPEED WATCHER · OPERATOR PELANGGAR · 01 · TABEL DAN FUNGSI
-- Jalankan di Supabase → SQL Editor. Aman dijalankan ulang.
-- Jalankan SESUDAH supabase/admin/01_admin_terpadu.sql (op_is_admin) dan
-- supabase/operator-performance/01_tabel_dan_keamanan.sql (op_operators).
--
-- Tujuan: setiap pelanggaran kecepatan diberi nama operator yang membawa unit.
--
--   Minerva (saluran login)  ──tiap menit──►  swo_login, swo_status
--   Worker speed-watcher-24-7 (/api/pelanggaran) ──►  swo_kejadian
--   swo__nilai()  mencocokkan unit + jam kejadian dengan login yang berlaku
--   swo_operator_kejadian()  dibaca halaman Speed Watcher (harus login)
--
-- Worker Speed Watcher TIDAK diubah. Alamatnya bisa dibaca siapa pun tanpa
-- login, jadi nama operator sengaja tidak pernah masuk ke sana: semuanya
-- tinggal di tabel ini, yang tertutup untuk akses langsung dan hanya dibaca
-- lewat fungsi yang mensyaratkan login.
--
-- Semua nama berawalan swo_ (Speed Watcher Operator).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABEL
-- -----------------------------------------------------------------------------

-- Nama operator dari daftar Minerva (master/operators), diperbarui Edge
-- Function sw-operator tiap 6 jam. Cadangannya op_operators (scorecard).
create table if not exists public.swo_operator (
  badge       text primary key,
  nama        text not null,
  perusahaan  text,
  aktif       boolean not null default true,
  diperbarui  timestamptz not null default now()
);

-- Riwayat login per unit. Minerva hanya menyimpan login TERAKHIR tiap unit,
-- jadi riwayatnya dibangun di sini: setiap login baru yang terlihat tiap
-- menit disimpan, lengkap dengan jam login dan logout dari Minerva sendiri.
create table if not exists public.swo_login (
  kunci              text not null,        -- nama unit dinormalisasi: DTH_05 → DTH5 (swo__kunci)
  login_pada         timestamptz not null, -- LoginTimeRaw Minerva
  unit               text not null,        -- kode unit apa adanya di Minerva
  badge              text not null,        -- OperatorRaw Minerva
  logout_pada        timestamptz,          -- LogoutTimeRaw; null = belum logout
  hm                 numeric,              -- HoursRaw (hour meter saat login)
  pertama_terlihat   timestamptz not null default now(),
  terakhir_terlihat  timestamptz not null default now(),
  primary key (kunci, login_pada)
);
create index if not exists swo_login_badge_idx on public.swo_login (badge, login_pada);

-- Status unit (Ready, Standby, Down, …) dari saluran yang sama, satu baris
-- per catatan status Minerva. Dipakai aturan "status unit saat itu".
create table if not exists public.swo_status (
  kunci      text not null,
  status_id  bigint not null,     -- ID catatan Data Status Minerva
  mulai      timestamptz not null,
  selesai    timestamptz,         -- jam terakhir catatan ini terlihat masih berjalan
  kode       text,                -- MsReasonCode: RHL, SNJ, BBU, SCS, …
  status     text,                -- StatusRaw: Ready, Standby, Down, …
  alasan     text,                -- ReasonRaw
  primary key (kunci, status_id)
);
create index if not exists swo_status_mulai_idx on public.swo_status (kunci, mulai);

-- Operator per kejadian. id = id kejadian di D1 Worker, jadi halaman
-- mencocokkan barisnya tanpa menyalin isi kejadian ke sini.
create table if not exists public.swo_kejadian (
  id             bigint primary key,
  unit           text not null,
  kunci          text not null,
  tanggal        date not null,         -- tanggal WIT kejadian, sama dengan kolom tanggal di D1
  mulai          timestamptz not null,
  -- hasil pencocokan otomatis
  badge          text,
  label          text not null check (label in ('sesuai','cek','tidak')),
  alasan         text,
  login_pada     timestamptz,
  final          boolean not null default false,
  dinilai_pada   timestamptz not null default now(),
  -- koreksi admin. Hasil otomatis di atas tetap disimpan apa adanya.
  koreksi        boolean not null default false,
  koreksi_badge  text,                  -- null = admin menyatakan operatornya tidak diketahui
  koreksi_alasan text,
  koreksi_oleh   text,
  koreksi_pada   timestamptz
);
create index if not exists swo_kejadian_tanggal_idx on public.swo_kejadian (tanggal);
create index if not exists swo_kejadian_belum_idx on public.swo_kejadian (mulai) where not final;

comment on column public.swo_kejadian.label is
  'sesuai = sesuai login Minerva · cek = perlu dicek (alasan tertulis) · tidak = tidak tercatat';
comment on column public.swo_kejadian.final is
  'True 65 menit sesudah kejadian, setelah ada putaran pencatat >= 61 menit sesudahnya: '
  'login terlambat sudah sempat terlihat. Sesudah final hanya admin yang mengubah.';

create table if not exists public.swo_koreksi_log (
  id          bigint generated always as identity primary key,
  pada        timestamptz not null default now(),
  oleh        text not null,
  kejadian_id bigint not null,
  aksi        text not null check (aksi in ('ubah','batal')),
  badge_lama  text,
  badge_baru  text,
  alasan      text
);
create index if not exists swo_koreksi_log_kejadian_idx on public.swo_koreksi_log (kejadian_id, pada);

-- Satu baris per putaran pencatat (tiap menit). Disimpan 7 hari: cukup untuk
-- tahu apakah pencatat berjalan saat sebuah kejadian terjadi.
create table if not exists public.swo_putaran (
  pada          timestamptz primary key,
  ok            boolean not null,      -- saluran login Minerva menjawab
  unit_ditanya  int,
  unit_dijawab  int,
  login_baru    int,
  kejadian_baru int,
  ms            int,
  pesan         text
);

create table if not exists public.swo_state (
  kunci      text primary key,
  isi        jsonb not null,
  diperbarui timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. KEAMANAN
-- Tabel tertutup untuk akses langsung: nama dan badge orang tidak boleh
-- terbaca lewat kunci anon yang tersaji publik. Halaman membaca lewat fungsi
-- security definer yang mensyaratkan login; Edge Function memakai service role.
-- -----------------------------------------------------------------------------
alter table public.swo_operator    enable row level security;
alter table public.swo_login       enable row level security;
alter table public.swo_status      enable row level security;
alter table public.swo_kejadian    enable row level security;
alter table public.swo_koreksi_log enable row level security;
alter table public.swo_putaran     enable row level security;
alter table public.swo_state       enable row level security;

revoke all on public.swo_operator, public.swo_login, public.swo_status, public.swo_kejadian,
              public.swo_koreksi_log, public.swo_putaran, public.swo_state
  from anon, authenticated;
grant select, insert, update, delete on public.swo_operator, public.swo_login, public.swo_status,
              public.swo_kejadian, public.swo_koreksi_log, public.swo_putaran, public.swo_state
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. FUNGSI BANTU
-- -----------------------------------------------------------------------------

-- Nama unit Wialon dan Minerva dicocokkan longgar: huruf besar, tanpa tanda
-- baca, tanpa nol di depan angka. DTH_05 → DTH5, 9RD01 → 9RD1, ADT034 → ADT34.
create or replace function public.swo__kunci(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')),
                        '(^|[A-Z])0+([0-9])', '\1\2', 'g')
$$;

-- Awal shift yang memuat p. Pergantian shift site 06:30 dan 18:30 WIT
-- (UTC+9, tanpa musim panas) — bukan 07:00/19:00 milik jadwal sinkron
-- Operator Performance.
create or replace function public.swo__awal_shift(p timestamptz)
returns timestamptz language sql immutable parallel safe set search_path = '' as $$
  select ((date_trunc('day', w) + case
             when w::time >= time '18:30' then interval '18 hours 30 minutes'
             when w::time >= time '06:30' then interval '6 hours 30 minutes'
             else interval '-5 hours -30 minutes' end)       -- 18:30 kemarin
          - interval '9 hours') at time zone 'UTC'
  from (select (p at time zone 'UTC') + interval '9 hours' as w) s
$$;

-- Jam WIT untuk kalimat alasan: "07:03" bila sehari dengan acuan, "28/10 18:34" bila tidak.
create or replace function public.swo__jam(p timestamptz, acuan timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p is null then '—'
    when ((p at time zone 'UTC') + interval '9 hours')::date
         = ((acuan at time zone 'UTC') + interval '9 hours')::date
      then to_char((p at time zone 'UTC') + interval '9 hours', 'HH24:MI')
    else to_char((p at time zone 'UTC') + interval '9 hours', 'DD/MM HH24:MI')
  end
$$;

-- Login uji (TEST001 di 9PS12) bukan operator.
create or replace function public.swo__badge_uji(p text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(btrim(p), '') = '' or btrim(p) ~* '^test' or btrim(p) ~ '^0+$'
$$;

-- Nama dan perusahaan dari badge: daftar Minerva dulu, lalu scorecard.
create or replace function public.swo__nama(p_badge text)
returns text language sql stable set search_path = public as $$
  select coalesce(
    (select nama from swo_operator where badge = p_badge),
    (select name from op_operators where badge = p_badge))
$$;

create or replace function public.swo__perusahaan(p_badge text)
returns text language sql stable set search_path = public as $$
  select case when x is null or x = '' then null when x = 'ANTM' then 'ANTAM' else x end
  from (select upper(btrim(coalesce(
          (select perusahaan from swo_operator where badge = p_badge),
          (select company from op_operators where badge = p_badge)))) as x) s
$$;

-- Arti kode status Minerva yang memicu "Perlu dicek".
create or replace function public.swo__arti_status(p_kode text, p_status text)
returns text language sql immutable set search_path = '' as $$
  select case upper(coalesce(p_kode, ''))
    when 'BBU' then 'Breakdown'
    when 'BBS' then 'Servis terjadwal'
    when 'SCS' then 'Ganti shift'
    when 'SNO' then 'No operator'
    when 'SOP' then 'No operator'
    when 'SDP' then 'No operator'
    else case when upper(coalesce(p_status, '')) = 'DOWN' then 'Down' end
  end
$$;

-- -----------------------------------------------------------------------------
-- 4. ATURAN PENCOCOKAN
--
-- Untuk kejadian di unit U yang mulai pukul T:
--   c = login terakhir di U yang jam loginnya <= T
--   b = login berikutnya di U, paling lambat 60 menit sesudah T, masih shift sama
--
-- "Tidak tercatat" bila c tidak bisa dipakai dan tidak ada b:
--   tidak ada login · login uji · sudah logout sebelum T ·
--   badge c sudah login di unit lain sesudah login di U (orangnya pindah)
-- "Perlu dicek" bila:
--   c tidak bisa dipakai tetapi ada b (kemungkinan login terlambat; b diusulkan) ·
--   login c dari shift sebelumnya (lebih dari 30 menit sebelum pergantian shift) ·
--   status unit saat itu Breakdown / Servis / Ganti shift / No operator ·
--   kejadian sebelum pencatat berjalan, atau pencatat terputus ±3 menit di sekitar T
-- "Sesuai login" bila c login di shift itu, belum logout, belum pindah, dan
--   tidak satu pun syarat "Perlu dicek" terpenuhi.
-- -----------------------------------------------------------------------------
create or replace function public.swo__nilai(
  p_kunci text, p_mulai timestamptz,
  out o_badge text, out o_label text, out o_alasan text, out o_login timestamptz)
language plpgsql stable set search_path = public as $$
declare
  c        swo_login%rowtype;
  b        swo_login%rowtype;
  pindah   swo_login%rowtype;
  st       swo_status%rowtype;
  s_awal   timestamptz := swo__awal_shift(p_mulai);
  rekam    timestamptz;
  tertua   timestamptz;
  masalah  text;
  dasar    text;
  susul    text;
  arti     text;
begin
  select (isi->>'pada')::timestamptz into rekam from swo_state where kunci = 'mulai_rekam';

  select * into c from swo_login
   where kunci = p_kunci and login_pada <= p_mulai
   order by login_pada desc limit 1;

  select * into b from swo_login
   where kunci = p_kunci and login_pada > p_mulai
     and login_pada <= p_mulai + interval '60 minutes'
     and login_pada <  s_awal + interval '12 hours'
     and not swo__badge_uji(badge)
   order by login_pada limit 1;

  if b.badge is not null then
    susul := b.badge || ' login ' || swo__jam(b.login_pada, p_mulai) || ' WIT, ' ||
             greatest(1, round(extract(epoch from (b.login_pada - p_mulai)) / 60))::int ||
             ' menit sesudah kejadian, kemungkinan login terlambat.';
  end if;

  -- (a) login c tidak bisa dipakai
  if c.badge is null then
    select min(login_pada) into tertua from swo_login where kunci = p_kunci;
    masalah := case when tertua is null then 'Belum ada login tercatat untuk unit ini.'
                    else 'Riwayat login unit ini baru tercatat sejak ' || swo__jam(tertua, p_mulai) || ' WIT.' end;
  elsif swo__badge_uji(c.badge) then
    masalah := 'Yang tercatat login uji (' || c.badge || '), bukan operator.';
  elsif c.logout_pada is not null and c.logout_pada <= p_mulai then
    masalah := 'Operator terakhir (' || c.badge || ') sudah logout ' ||
               swo__jam(c.logout_pada, p_mulai) || ' WIT, sebelum kejadian.';
  else
    select * into pindah from swo_login
     where badge = c.badge and kunci <> p_kunci
       and login_pada > c.login_pada and login_pada <= p_mulai
     order by login_pada desc limit 1;
    if pindah.badge is not null then
      masalah := 'Badge ' || c.badge || ' sudah login di ' || pindah.unit || ' pukul ' ||
                 swo__jam(pindah.login_pada, p_mulai) || ' WIT, sesudah login di unit ini.';
    end if;
  end if;

  if masalah is not null then
    if b.badge is not null then
      o_badge := b.badge; o_label := 'cek'; o_login := b.login_pada;
      o_alasan := masalah || ' ' || susul;
    else
      o_badge := null; o_label := 'tidak'; o_login := null; o_alasan := masalah;
    end if;
    return;
  end if;

  o_badge := c.badge; o_login := c.login_pada;
  dasar := 'Login ' || swo__jam(c.login_pada, p_mulai) || ' WIT di unit ini' ||
           case when c.logout_pada is not null
                then ', logout ' || swo__jam(c.logout_pada, p_mulai) || ' WIT' else '' end || '.';

  -- (b) login dari shift sebelumnya
  if c.login_pada < s_awal - interval '30 minutes' then
    o_label := 'cek';
    if b.badge is not null then
      o_badge := b.badge; o_login := b.login_pada;
      o_alasan := 'Login yang berlaku dari shift sebelumnya (' || c.badge || ', ' ||
                  swo__jam(c.login_pada, p_mulai) || ' WIT). ' || susul;
    else
      o_alasan := 'Login dari shift sebelumnya (' || swo__jam(c.login_pada, p_mulai) ||
                  ' WIT), belum ada login ulang di shift ini.';
    end if;
    return;
  end if;

  -- (c) status unit saat kejadian. Catatan status yang terakhir terlihat lebih
  -- dari 2 menit sebelum T tidak dipakai: di antaranya mungkin ada status lain.
  select * into st from swo_status
   where kunci = p_kunci and mulai <= p_mulai
   order by mulai desc limit 1;
  if st.status_id is not null and (st.selesai is null or st.selesai >= p_mulai - interval '2 minutes') then
    arti := swo__arti_status(st.kode, st.status);
    if arti is not null then
      o_label := 'cek';
      o_alasan := dasar || ' Status unit saat itu ' || arti ||
                  case when coalesce(st.kode, '') <> '' then ' (' || st.kode || ')' else '' end || '.';
      return;
    end if;
  end if;

  -- (d) pencatat belum berjalan / terputus di sekitar kejadian
  if rekam is null or p_mulai < rekam then
    o_label := 'cek';
    o_alasan := dasar || ' Terjadi sebelum pencatat berjalan, jadi perpindahan operator saat itu tidak terlihat.';
    return;
  end if;
  if not exists (select 1 from swo_putaran
                  where ok and pada between p_mulai - interval '3 minutes' and p_mulai + interval '3 minutes') then
    o_label := 'cek';
    o_alasan := dasar || ' Pencatat terputus sekitar waktu kejadian.';
    return;
  end if;

  o_label := 'sesuai';
  o_alasan := dasar;
end $$;

-- -----------------------------------------------------------------------------
-- 5. PENULISAN · hanya Edge Function sw-operator (service role)
--
-- Satu panggilan = satu putaran (tiap menit):
--   p = { pada, ok, pesan, ms, unit_ditanya, unit_dijawab,
--         operator: [{badge, nama, perusahaan, aktif}]        (tiap 6 jam)
--         login:    [{unit, badge, login, logout, hm}]
--         status:   [{unit, id, mulai, selesai, kode, status, alasan}]
--         kejadian: [{id, unit, tanggal, mulai(ms)}]
--         maks_id, state: {kunci: isi} }
-- -----------------------------------------------------------------------------
create or replace function public.swo_simpan_putaran(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kini      timestamptz := coalesce(nullif(p->>'pada', '')::timestamptz, now());
  v_ok      boolean := coalesce((p->>'ok')::boolean, false);
  n_op      int := 0;
  n_login   int := 0;
  n_status  int := 0;
  n_kej     int := 0;
  n_nilai   int := 0;
  n_final   int := 0;
  r         record;
  v         record;
  jadi      boolean;
begin
  -- Dua putaran yang tumpang tindih tidak boleh menilai bersamaan.
  if not pg_try_advisory_xact_lock(hashtext('swo_simpan_putaran')) then
    return jsonb_build_object('lewat', true, 'pesan', 'putaran lain sedang menyimpan');
  end if;

  insert into swo_putaran (pada, ok, unit_ditanya, unit_dijawab, ms, pesan)
  values (kini, v_ok, nullif(p->>'unit_ditanya', '')::int, nullif(p->>'unit_dijawab', '')::int,
          nullif(p->>'ms', '')::int, nullif(p->>'pesan', ''))
  on conflict (pada) do update set ok = excluded.ok, unit_ditanya = excluded.unit_ditanya,
    unit_dijawab = excluded.unit_dijawab, ms = excluded.ms, pesan = excluded.pesan;

  if v_ok then
    insert into swo_state (kunci, isi, diperbarui)
    values ('mulai_rekam', jsonb_build_object('pada', kini), kini)
    on conflict (kunci) do nothing;
  end if;

  -- nama operator
  if jsonb_typeof(p->'operator') = 'array' and jsonb_array_length(p->'operator') > 0 then
    insert into swo_operator as o (badge, nama, perusahaan, aktif, diperbarui)
    select distinct on (btrim(x->>'badge'))
           btrim(x->>'badge'), btrim(x->>'nama'), nullif(btrim(coalesce(x->>'perusahaan', '')), ''),
           coalesce((x->>'aktif')::boolean, true), kini
    from jsonb_array_elements(p->'operator') x
    where coalesce(btrim(x->>'badge'), '') <> '' and coalesce(btrim(x->>'nama'), '') <> ''
    on conflict (badge) do update set
      nama = excluded.nama, perusahaan = excluded.perusahaan,
      aktif = excluded.aktif, diperbarui = excluded.diperbarui;
    get diagnostics n_op = row_count;
  end if;

  -- login: baris baru disimpan, baris lama diperbarui jam logout-nya
  if jsonb_typeof(p->'login') = 'array' then
    with masuk as (
      select distinct on (swo__kunci(x->>'unit'), (x->>'login')::timestamptz)
             swo__kunci(x->>'unit') as kunci, (x->>'login')::timestamptz as login_pada,
             x->>'unit' as unit, btrim(x->>'badge') as badge,
             nullif(x->>'logout', '')::timestamptz as logout_pada,
             case when coalesce(x->>'hm', '') ~ '^-?[0-9.]+$' then (x->>'hm')::numeric end as hm
      from jsonb_array_elements(p->'login') x
      where coalesce(btrim(x->>'badge'), '') <> '' and coalesce(x->>'login', '') <> ''
        and coalesce(x->>'unit', '') <> ''
    ), tulis as (
      insert into swo_login as l (kunci, login_pada, unit, badge, logout_pada, hm, pertama_terlihat, terakhir_terlihat)
      select kunci, login_pada, unit, badge, logout_pada, hm, kini, kini from masuk
      on conflict (kunci, login_pada) do update set
        unit = excluded.unit, badge = excluded.badge,
        logout_pada = coalesce(excluded.logout_pada, l.logout_pada),
        hm = coalesce(excluded.hm, l.hm),
        terakhir_terlihat = kini
      -- Login yang sama terlihat tiap menit. Barisnya hanya ditulis ulang bila
      -- ada yang berubah, atau paling sering sekali per 10 menit.
      where l.badge is distinct from excluded.badge
         or (excluded.logout_pada is not null and l.logout_pada is distinct from excluded.logout_pada)
         or l.terakhir_terlihat < kini - interval '10 minutes'
      returning (xmax = 0) as baru
    )
    select count(*) filter (where baru) into n_login from tulis;
  end if;

  -- status
  if jsonb_typeof(p->'status') = 'array' then
    insert into swo_status as s (kunci, status_id, mulai, selesai, kode, status, alasan)
    select distinct on (swo__kunci(x->>'unit'), (x->>'id')::bigint)
           swo__kunci(x->>'unit'), (x->>'id')::bigint, (x->>'mulai')::timestamptz,
           nullif(x->>'selesai', '')::timestamptz, nullif(x->>'kode', ''),
           nullif(x->>'status', ''), nullif(x->>'alasan', '')
    from jsonb_array_elements(p->'status') x
    where coalesce(x->>'id', '') ~ '^[0-9]+$' and coalesce(x->>'mulai', '') <> ''
      and coalesce(x->>'unit', '') <> ''
    on conflict (kunci, status_id) do update set
      mulai = excluded.mulai,
      selesai = greatest(s.selesai, excluded.selesai),
      kode = excluded.kode, status = excluded.status, alasan = excluded.alasan;
    get diagnostics n_status = row_count;
  end if;

  -- kejadian baru dari Worker
  if jsonb_typeof(p->'kejadian') = 'array' then
    insert into swo_kejadian (id, unit, kunci, tanggal, mulai, label, alasan, final, dinilai_pada)
    select distinct on ((x->>'id')::bigint)
           (x->>'id')::bigint, x->>'unit', swo__kunci(x->>'unit'), (x->>'tanggal')::date,
           to_timestamp((x->>'mulai')::double precision / 1000.0),
           'tidak', 'Belum dinilai.', false, kini
    from jsonb_array_elements(p->'kejadian') x
    where coalesce(x->>'id', '') ~ '^[0-9]+$' and coalesce(x->>'mulai', '') ~ '^[0-9]+(\.[0-9]+)?$'
      and coalesce(x->>'unit', '') <> '' and coalesce(x->>'tanggal', '') ~ '^\d{4}-\d{2}-\d{2}$'
    on conflict (id) do nothing;
    get diagnostics n_kej = row_count;
  end if;

  update swo_putaran set login_baru = n_login, kejadian_baru = n_kej where pada = kini;

  -- nilai ulang semua yang belum final
  for r in select id, kunci, mulai from swo_kejadian where not final order by mulai loop
    select * into v from swo__nilai(r.kunci, r.mulai);
    jadi := kini >= r.mulai + interval '65 minutes'
            and exists (select 1 from swo_putaran where ok and pada >= r.mulai + interval '61 minutes');
    update swo_kejadian set
      badge = v.o_badge, label = v.o_label, alasan = v.o_alasan, login_pada = v.o_login,
      final = jadi, dinilai_pada = kini
    where id = r.id
      and (badge, label, alasan, login_pada, final)
          is distinct from (v.o_badge, v.o_label, v.o_alasan, v.o_login, jadi);
    n_nilai := n_nilai + 1;
    if jadi then n_final := n_final + 1; end if;
  end loop;

  -- keadaan dari Edge Function: kursor, daftar unit, jam tarik daftar Minerva, …
  if (p->>'maks_id') ~ '^[0-9]+$' then
    insert into swo_state (kunci, isi, diperbarui)
    values ('kursor', jsonb_build_object('maks_id', (p->>'maks_id')::bigint), kini)
    on conflict (kunci) do update set isi = excluded.isi, diperbarui = excluded.diperbarui
    where swo_state.isi is distinct from excluded.isi;
  end if;
  if jsonb_typeof(p->'state') = 'object' then
    insert into swo_state (kunci, isi, diperbarui)
    select e.key, e.value, kini from jsonb_each(p->'state') e
    where e.key not in ('mulai_rekam', 'kursor') and jsonb_typeof(e.value) = 'object'
    on conflict (kunci) do update set isi = excluded.isi, diperbarui = excluded.diperbarui
    where swo_state.isi is distinct from excluded.isi;
  end if;

  -- bersih-bersih sekali sejam
  if extract(minute from kini) = 7 then
    delete from swo_putaran where pada < kini - interval '7 days';
    delete from swo_status  where coalesce(selesai, mulai) < kini - interval '30 days';
  end if;

  return jsonb_build_object('operator', n_op, 'login_baru', n_login, 'status_unit', n_status,
                            'kejadian_baru', n_kej, 'dinilai', n_nilai, 'final', n_final);
end $$;

-- -----------------------------------------------------------------------------
-- 6. BACAAN · halaman Speed Watcher (harus login)
-- -----------------------------------------------------------------------------
create or replace function public.swo__wajib_login()
returns text language plpgsql stable security definer set search_path = '' as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then raise exception 'Sesi login berakhir. Keluar lalu masuk lagi.'; end if;
  return e;
end $$;

create or replace function public.swo__baris(k public.swo_kejadian)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',         k.id,
    'badge',      case when k.koreksi then k.koreksi_badge else k.badge end,
    'nama',       swo__nama(case when k.koreksi then k.koreksi_badge else k.badge end),
    'perusahaan', swo__perusahaan(case when k.koreksi then k.koreksi_badge else k.badge end),
    'label',      case when k.koreksi then 'admin' else k.label end,
    'alasan',     case when k.koreksi then k.koreksi_alasan else k.alasan end,
    'login_pada', case when k.koreksi then null else k.login_pada end,
    'final',      k.final or k.koreksi,
    'otomatis',   jsonb_build_object('badge', k.badge, 'nama', swo__nama(k.badge),
                                     'label', k.label, 'alasan', k.alasan, 'login_pada', k.login_pada,
                                     'final', k.final),
    'koreksi',    case when k.koreksi then jsonb_build_object(
                    'badge', k.koreksi_badge, 'oleh', k.koreksi_oleh,
                    'pada', k.koreksi_pada, 'alasan', k.koreksi_alasan) end)
$$;

-- Operator untuk daftar id kejadian (tab Kejadian, Unduh Excel).
create or replace function public.swo_operator_kejadian(p_id bigint[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform swo__wajib_login();
  if p_id is null or cardinality(p_id) = 0 then return '[]'::jsonb; end if;
  if cardinality(p_id) > 5000 then
    raise exception 'Terlalu banyak kejadian sekaligus (maks. 5.000).';
  end if;
  return coalesce((select jsonb_agg(swo__baris(k) order by k.id)
                   from swo_kejadian k where k.id = any(p_id)), '[]'::jsonb);
end $$;

-- Kesehatan pencatat, untuk baris keterangan di Speed Watcher.
create or replace function public.swo_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t   swo_putaran%rowtype;
  okt timestamptz;
  gb  int;
begin
  perform swo__wajib_login();
  select * into t from swo_putaran order by pada desc limit 1;
  select max(pada) into okt from swo_putaran where ok;
  select count(*) into gb from swo_putaran where pada > coalesce(okt, '-infinity'::timestamptz);
  return jsonb_build_object(
    'mulai_rekam', (select isi->>'pada' from swo_state where kunci = 'mulai_rekam'),
    'ok_terakhir', okt,
    'gagal_beruntun', gb,
    'terakhir', case when t.pada is null then null else jsonb_build_object(
      'pada', t.pada, 'ok', t.ok, 'unit_ditanya', t.unit_ditanya,
      'unit_dijawab', t.unit_dijawab, 'pesan', t.pesan) end,
    'operator_dikenal', (select count(*) from swo_operator where aktif));
end $$;

-- Daftar operator untuk isian koreksi admin.
create or replace function public.swo_daftar_operator()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform swo__wajib_login();
  return coalesce((
    select jsonb_agg(jsonb_build_object('badge', badge, 'nama', nama, 'perusahaan', perusahaan) order by nama, badge)
    from (
      select o.badge, o.nama,
             case upper(coalesce(o.perusahaan, '')) when 'ANTM' then 'ANTAM' when '' then null else upper(o.perusahaan) end as perusahaan
      from swo_operator o where o.aktif and not swo__badge_uji(o.badge)
      union all
      select p.badge, p.name, p.company from op_operators p
      where not exists (select 1 from swo_operator o where o.badge = p.badge)
        and coalesce(p.last_seen, date '1900-01-01') >= current_date - 180
    ) d), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 7. KOREKSI ADMIN
-- Admin = app_admin (Mining Bureau → Kelola Admin). Hasil otomatis tidak
-- ditimpa: koreksi disimpan di kolomnya sendiri dan bisa dibatalkan.
-- Kejadian yang belum punya baris (mis. terjadi sebelum pencatat berjalan)
-- dibuatkan barisnya dari data yang dikirim halaman.
-- -----------------------------------------------------------------------------
create or replace function public.swo_koreksi(
  p_id bigint, p_badge text, p_alasan text,
  p_unit text default null, p_mulai bigint default null, p_tanggal date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e  text := swo__wajib_login();
  b  text := nullif(btrim(coalesce(p_badge, '')), '');
  a  text := regexp_replace(btrim(coalesce(p_alasan, '')), '\s+', ' ', 'g');
  k  swo_kejadian%rowtype;
begin
  if not op_is_admin() then raise exception 'Hanya admin yang boleh mengoreksi operator.'; end if;
  if length(a) < 5 then raise exception 'Tulis alasannya dulu (minimal 5 huruf).'; end if;
  if length(a) > 300 then raise exception 'Alasan terlalu panjang (maks. 300 huruf).'; end if;
  if b is not null and b !~ '^[A-Za-z0-9-]{2,20}$' then raise exception 'ID operator tidak sah.'; end if;
  if p_id is null or p_id <= 0 then raise exception 'Kejadian tidak dikenal.'; end if;

  select * into k from swo_kejadian where id = p_id for update;
  if not found then
    if coalesce(btrim(p_unit), '') = '' or p_mulai is null then
      raise exception 'Kejadian #% belum tercatat di pencatat operator.', p_id;
    end if;
    insert into swo_kejadian (id, unit, kunci, tanggal, mulai, label, alasan, final)
    values (p_id, btrim(p_unit), swo__kunci(p_unit),
            coalesce(p_tanggal, ((to_timestamp(p_mulai / 1000.0) at time zone 'UTC') + interval '9 hours')::date),
            to_timestamp(p_mulai / 1000.0), 'tidak', 'Tidak ada data login untuk kejadian ini.', true)
    returning * into k;
  end if;

  insert into swo_koreksi_log (oleh, kejadian_id, aksi, badge_lama, badge_baru, alasan)
  values (e, p_id, 'ubah', case when k.koreksi then k.koreksi_badge else k.badge end, b, a);

  update swo_kejadian set koreksi = true, koreksi_badge = b, koreksi_alasan = a,
         koreksi_oleh = e, koreksi_pada = now()
  where id = p_id;

  return (select swo__baris(x) from swo_kejadian x where x.id = p_id);
end $$;

create or replace function public.swo_batal_koreksi(p_id bigint, p_alasan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e  text := swo__wajib_login();
  a  text := regexp_replace(btrim(coalesce(p_alasan, '')), '\s+', ' ', 'g');
  k  swo_kejadian%rowtype;
begin
  if not op_is_admin() then raise exception 'Hanya admin yang boleh mengoreksi operator.'; end if;
  if length(a) < 5 then raise exception 'Tulis alasannya dulu (minimal 5 huruf).'; end if;
  if length(a) > 300 then raise exception 'Alasan terlalu panjang (maks. 300 huruf).'; end if;
  select * into k from swo_kejadian where id = p_id for update;
  if not found or not k.koreksi then raise exception 'Kejadian ini tidak sedang dikoreksi.'; end if;

  insert into swo_koreksi_log (oleh, kejadian_id, aksi, badge_lama, badge_baru, alasan)
  values (e, p_id, 'batal', k.koreksi_badge, k.badge, a);

  update swo_kejadian set koreksi = false, koreksi_badge = null, koreksi_alasan = null,
         koreksi_oleh = null, koreksi_pada = null
  where id = p_id;

  return (select swo__baris(x) from swo_kejadian x where x.id = p_id);
end $$;

-- Riwayat koreksi satu kejadian (panel detail, khusus admin).
create or replace function public.swo_riwayat_koreksi(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform swo__wajib_login();
  if not op_is_admin() then raise exception 'Hanya admin yang boleh melihat riwayat koreksi.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'pada', l.pada, 'oleh', l.oleh, 'aksi', l.aksi, 'badge_lama', l.badge_lama,
            'nama_lama', swo__nama(l.badge_lama), 'badge_baru', l.badge_baru,
            'nama_baru', swo__nama(l.badge_baru), 'alasan', l.alasan) order by l.pada desc)
          from swo_koreksi_log l where l.kejadian_id = p_id), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 8. HAK MENJALANKAN
-- -----------------------------------------------------------------------------
revoke all on function public.swo__kunci(text)                     from public, anon, authenticated;
revoke all on function public.swo__awal_shift(timestamptz)         from public, anon, authenticated;
revoke all on function public.swo__jam(timestamptz, timestamptz)   from public, anon, authenticated;
revoke all on function public.swo__badge_uji(text)                 from public, anon, authenticated;
revoke all on function public.swo__nama(text)                      from public, anon, authenticated;
revoke all on function public.swo__perusahaan(text)                from public, anon, authenticated;
revoke all on function public.swo__arti_status(text, text)         from public, anon, authenticated;
revoke all on function public.swo__nilai(text, timestamptz)        from public, anon, authenticated;
revoke all on function public.swo__wajib_login()                   from public, anon, authenticated;
revoke all on function public.swo__baris(public.swo_kejadian)      from public, anon, authenticated;
revoke all on function public.swo_simpan_putaran(jsonb)            from public, anon, authenticated;
revoke all on function public.swo_operator_kejadian(bigint[])      from public, anon;
revoke all on function public.swo_status()                         from public, anon;
revoke all on function public.swo_daftar_operator()                from public, anon;
revoke all on function public.swo_koreksi(bigint, text, text, text, bigint, date) from public, anon;
revoke all on function public.swo_batal_koreksi(bigint, text)      from public, anon;
revoke all on function public.swo_riwayat_koreksi(bigint)          from public, anon;

grant execute on function public.swo_simpan_putaran(jsonb)         to service_role;
grant execute on function public.swo_operator_kejadian(bigint[])   to authenticated;
grant execute on function public.swo_status()                      to authenticated;
grant execute on function public.swo_daftar_operator()             to authenticated;
grant execute on function public.swo_koreksi(bigint, text, text, text, bigint, date) to authenticated;
grant execute on function public.swo_batal_koreksi(bigint, text)   to authenticated;
grant execute on function public.swo_riwayat_koreksi(bigint)       to authenticated;

-- Periksa sesudah menjalankan berkas ini:
--   select public.swo__kunci('DTH_05'), public.swo__awal_shift('2026-10-29T00:00:00Z');
--   → DTH5 · 2026-10-28 21:30:00+00 (09:00 WIT masuk shift siang yang mulai 06:30 WIT)
