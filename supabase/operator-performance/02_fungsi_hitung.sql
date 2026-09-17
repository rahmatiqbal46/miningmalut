-- =====================================================================
-- OPERATOR PERFORMANCE · 02 · FUNGSI HITUNG
-- Jalankan setelah 01. Aman dijalankan ulang.
--
-- SISTEM PENENTU DATA VALID
--
-- Lapis 1 · baris harian yang sah. Satu baris (operator, alat, hari)
--   hanya dihitung bila:
--     a. seluruh komponennya bertarget (has_target), dan
--     b. sudah final: diambil setelah hari itu selesai.
--     c. porsi kerjanya cukup (lihat di bawah).
--   Baris lain tetap disimpan dan dihitung jumlahnya, tapi tidak masuk
--   rata-rata maupun peringkat.
--
--   Tentang porsi kerja. Minerva memberi persentase komponen yang SAMA
--   PERSIS kepada sekelompok operator pada hari yang sama (dugaan: yang
--   bergantian di unit yang sama); yang berbeda hanya Actual-nya. Contoh
--   16 Sep 2026, truck PCM: tiga operator bernilai 88,6 padahal
--   Productivity Actual salah satunya hanya 0,01.
--
--     kelompok = tanggal + jenis alat + perusahaan + seluruh
--                persentase komponen identik
--     porsi    = Productivity Actual operator ÷ jumlah di kelompoknya
--
--   Baris dengan porsi di bawah 10% tidak sah. Operator yang sendirian
--   di kelompoknya berporsi 100%. Angka 10% ada di op_ambang_porsi().
--
-- Lapis 2 · kehadiran yang cukup, untuk rentang lebih dari satu hari.
--   Pola kerja di site membuat jumlah hari tiap operator berbeda, dan
--   angka minimum yang dipatok (mis. "minimal 5 hari") akan salah
--   begitu rosternya berubah. Karena itu syaratnya dibaca dari data:
--
--     syarat hari = setengah dari median hari kerja rekan
--                   se-perusahaan dan se-jenis alat, dibulatkan ke atas,
--                   minimal 1
--
--   Contoh sebulan: median operator truck PCM bertugas 20 hari, maka
--   syaratnya 10 hari. Operator yang baru bertugas 3 hari tetap tampil
--   dengan nilainya, tapi tanpa nomor peringkat dan tidak bisa jadi
--   Top, Perlu Pendampingan, atau juara Hall of Fame.
--
--   Kalau roster berubah dan semua orang bertugas lebih jarang,
--   mediannya ikut turun dan syaratnya menyesuaikan sendiri.
--
--   Angka "setengah" ada di satu tempat: op_ambang_hadir().
--
--   Untuk rentang 28 hari atau lebih (sebulan penuh, termasuk Hall of
--   Fame), syaratnya minimal 5 hari kerja sah, mana yang lebih besar
--   di antara keduanya. Angkanya di op_min_hari_bulanan().
-- =====================================================================

create or replace function public.op_ambang_hadir()
returns numeric language sql immutable as $$ select 0.5::numeric $$;

create or replace function public.op_ambang_porsi()
returns numeric language sql immutable as $$ select 0.10::numeric $$;

-- Lantai syarat hari untuk periode sebulan atau lebih (termasuk Hall of
-- Fame). Tanpa ini, bulan dengan operator excavator yang bergantian
-- (Agustus 2026: rata-rata 4-5 hari per orang) menurunkan syarat median
-- ke 2 hari, sehingga juara 2 hari bisa mengalahkan yang konsisten.
create or replace function public.op_min_hari_bulanan()
returns int language sql immutable as $$ select 5 $$;

create or replace function public.op_panjang_bulanan()
returns int language sql immutable as $$ select 28 $$;  -- hari; Februari ikut terhitung sebulan

create or replace function public.op_hari_ini_wit()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Jayapura')::date
$$;

-- =====================================================================
-- DASAR · setiap baris harian lengkap dengan kelompok dan porsinya.
-- Semua fungsi lain membaca dari sini.
-- =====================================================================
drop function if exists public.op_baris(date, date);
drop function if exists public.op_baris(date, date, text);
create function public.op_baris(p_from date, p_to date, p_badge text default null)
returns table (
  score_date     date,
  badge          text,
  name           text,
  company        text,
  photo_path     text,
  equipment_type text,
  overall_score  numeric,
  metrics        jsonb,
  has_target     boolean,
  final          boolean,
  source_rows    int,
  grup_n         int,
  porsi          numeric,
  porsi_cukup    boolean
)
language sql
stable
as $$
  with s as (
    select sc.score_date, sc.badge, o.name, o.company, o.photo_path, sc.equipment_type,
           sc.overall_score, sc.metrics, sc.has_target, sc.final, sc.source_rows,
           case when sc.has_target then (
             select string_agg(k || '=' || round(nullif(sc.metrics -> k ->> 'p', '')::numeric, 4)::text, ';' order by k)
             from jsonb_object_keys(sc.metrics) k
           ) end as grup_kunci,
           nullif(sc.metrics -> 'Productivity' ->> 'a', '')::numeric as aktual
    from public.op_scores sc
    join public.op_operators o on o.badge = sc.badge
    where sc.score_date between p_from and p_to
      and o.company in ('ANTAM','PCM')
      -- Untuk satu operator: cukup tanggal-tanggal ia bekerja. Rekan
      -- sekelompoknya tetap ikut terbaca, karena porsi butuh mereka.
      and (p_badge is null or sc.score_date in (
            select x.score_date from public.op_scores x
            where x.badge = p_badge and x.score_date between p_from and p_to))
  ),
  g as (
    select s.*,
           count(*)    over w as n,
           sum(aktual) over w as total
    from s
    window w as (partition by score_date, equipment_type, company, grup_kunci)
  )
  select score_date, badge, name, company, photo_path, equipment_type,
         overall_score, metrics, has_target, final, source_rows,
         case when grup_kunci is not null then n::int end,
         case when grup_kunci is not null and aktual is not null and total > 0
              then round(aktual / total, 4) end,
         -- Tanpa kelompok atau tanpa angka Actual: tidak bisa dinilai, dianggap cukup
         (grup_kunci is null or aktual is null or coalesce(total, 0) <= 0
          or aktual / total >= public.op_ambang_porsi())
  from g;
$$;

-- =====================================================================
-- INTI · satu baris per (operator, jenis alat) dalam rentang
-- Semua fungsi lain membaca dari sini, supaya halaman, poster, Hall of
-- Fame, dan popup tidak pernah memakai aturan yang berbeda.
-- =====================================================================
drop function if exists public.op_agregat(date, date, boolean);
create function public.op_agregat(
  p_from date,
  p_to   date,
  p_sementara boolean default false
)
returns table (
  badge             text,
  name              text,
  company           text,
  photo_path        text,
  equipment_type    text,
  hari_valid        int,
  hari_tanpa_target int,
  hari_sementara    int,
  hari_porsi_kecil  int,
  nilai             numeric,
  nilai_min         numeric,
  nilai_max         numeric,
  komponen          jsonb,
  median_grup       numeric,
  syarat_hari       int,
  memenuhi          boolean,
  peringkat         int
)
language sql
stable
as $$
  with dasar as (
    select b.*, (b.has_target and b.porsi_cukup and (b.final or p_sementara)) as sah
    from public.op_baris(p_from, p_to) b
  ),
  per_op as (
    select d.badge, d.name, d.company, d.photo_path, d.equipment_type,
      (count(*) filter (where d.sah))::int                               as hari_valid,
      (count(*) filter (where not d.has_target))::int                    as hari_tanpa_target,
      (count(*) filter (where d.has_target and not d.final))::int        as hari_sementara,
      (count(*) filter (where d.has_target and not d.porsi_cukup))::int  as hari_porsi_kecil,
      avg(d.overall_score) filter (where d.sah)                          as nilai_mentah,
      round(avg(d.overall_score) filter (where d.sah), 1)                as nilai,
      round(min(d.overall_score) filter (where d.sah), 1)                as nilai_min,
      round(max(d.overall_score) filter (where d.sah), 1)                as nilai_max
    from dasar d
    group by d.badge, d.name, d.company, d.photo_path, d.equipment_type
  ),
  per_komponen as (
    select d.badge, d.equipment_type, k.key,
      round(avg(nullif(d.metrics -> k.key ->> 'p', '')::numeric), 1) as p,
      round(avg(nullif(d.metrics -> k.key ->> 's', '')::numeric), 2) as s
    from dasar d, lateral jsonb_object_keys(d.metrics) k(key)
    where d.sah
    group by d.badge, d.equipment_type, k.key
  ),
  komponen_json as (
    select badge, equipment_type,
           jsonb_object_agg(key, jsonb_build_object('p', p, 's', s)) as komponen
    from per_komponen group by badge, equipment_type
  ),
  grup as (
    select company, equipment_type,
           percentile_cont(0.5) within group (order by hari_valid)::numeric as median_grup
    from per_op where hari_valid > 0
    group by company, equipment_type
  ),
  lengkap as (
    select p.*, coalesce(k.komponen, '{}'::jsonb) as komponen, g.median_grup,
      case when p_to <= p_from then 1
           when (p_to - p_from) + 1 >= public.op_panjang_bulanan()
             then greatest(public.op_min_hari_bulanan(), ceil(coalesce(g.median_grup, 1) * public.op_ambang_hadir()))::int
           else greatest(1, ceil(coalesce(g.median_grup, 1) * public.op_ambang_hadir()))::int
      end as syarat_hari
    from per_op p
    left join komponen_json k on k.badge = p.badge and k.equipment_type = p.equipment_type
    left join grup g on g.company = p.company and g.equipment_type = p.equipment_type
  ),
  dinilai as (
    select l.*, (l.hari_valid > 0 and l.hari_valid >= l.syarat_hari) as memenuhi
    from lengkap l
  )
  select d.badge, d.name, d.company, d.photo_path, d.equipment_type,
         d.hari_valid, d.hari_tanpa_target, d.hari_sementara, d.hari_porsi_kecil,
         d.nilai, d.nilai_min, d.nilai_max, d.komponen,
         round(d.median_grup, 1), d.syarat_hari, d.memenuhi,
         case when d.memenuhi then
           -- Nilai sama persis → peringkat sama. Nama TIDAK dipakai
           -- sebagai pemecah seri: urutan abjad bukan ukuran kinerja.
           (rank() over (partition by d.company, d.equipment_type, d.memenuhi
                         order by round(d.nilai_mentah, 2) desc, d.hari_valid desc))::int
         end as peringkat
  from dinilai d
  order by d.company, d.equipment_type, d.memenuhi desc, d.nilai desc nulls last, d.name;
$$;

-- =====================================================================
-- STATUS SINKRONISASI · untuk pita "data terakhir diperbarui"
-- =====================================================================
create or replace function public.op_status()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'hari_ini_wit', public.op_hari_ini_wit(),
    'terakhir_ok', (select max(ran_at) from public.op_sync_log
                    where status in ('ok','sebagian') and mode = 'rutin'),
    'terakhir', (select to_jsonb(l) from (
                   select ran_at, source, mode, status, dates, rows_saved, message
                   from public.op_sync_log order by ran_at desc limit 1) l),
    'final_terakhir', (select max(score_date) from public.op_scores where final),
    'cakupan', (select jsonb_build_object(
                   'dari', min(score_date), 'sampai', max(score_date),
                   'hari', count(distinct score_date), 'baris', count(*))
                from public.op_scores),
    'mundur', (select value from public.op_state where key = 'mundur')
  );
$$;

-- =====================================================================
-- HALAMAN · satu panggilan berisi semua isi halaman untuk satu periode
-- =====================================================================
create or replace function public.op_halaman(p_from date, p_to date)
returns jsonb
language sql
stable
as $$
  with a as (
    select * from public.op_agregat(p_from, p_to)
  ),
  sah as (
    select b.company, b.equipment_type, b.badge, b.overall_score
    from public.op_baris(p_from, p_to) b
    where b.has_target and b.final and b.porsi_cukup
  ),
  ringkasan as (
    select c.company,
      jsonb_build_object(
        'company', c.company,
        'operator', (select count(distinct badge) from sah where company = c.company),
        'rata',     (select round(avg(overall_score), 1) from sah where company = c.company),
        'exca', jsonb_build_object(
          'operator', (select count(distinct badge) from sah where company = c.company and equipment_type = 'exca'),
          'rata',     (select round(avg(overall_score), 1) from sah where company = c.company and equipment_type = 'exca')),
        'truck', jsonb_build_object(
          'operator', (select count(distinct badge) from sah where company = c.company and equipment_type = 'truck'),
          'rata',     (select round(avg(overall_score), 1) from sah where company = c.company and equipment_type = 'truck')),
        'baris_tanpa_target', (select coalesce(sum(hari_tanpa_target), 0) from a where company = c.company),
        'baris_sementara',    (select coalesce(sum(hari_sementara), 0) from a where company = c.company),
        'baris_porsi_kecil',  (select coalesce(sum(hari_porsi_kecil), 0) from a where company = c.company),
        'belum_memenuhi',     (select count(*) from a where company = c.company and not memenuhi and hari_valid > 0)
      ) as isi
    from (values ('ANTAM'), ('PCM')) c(company)
  ),
  -- Jumlah per kelompok: exca 1 orang, truck 3 orang
  kuota as (
    select * from (values ('exca', 1), ('truck', 3)) q(equipment_type, n)
  ),
  -- Top: peringkat ≤ kuota. Nilai yang seri ikut semua (juara bersama).
  top as (
    select a.*, q.n from a join kuota q using (equipment_type)
    where a.memenuhi and a.peringkat <= q.n
  ),
  -- Perlu Pendampingan: dari bawah, tidak boleh orang yang sama dengan Top.
  -- Nilai yang seri ikut semua, jadi daftar bisa lebih dari kuotanya.
  bawah as (
    select a.*, q.n,
      rank() over (partition by a.company, a.equipment_type
                   order by a.nilai asc, a.hari_valid desc) as urut_bawah
    from a join kuota q using (equipment_type)
    where a.memenuhi
      and not exists (select 1 from top t where t.badge = a.badge and t.equipment_type = a.equipment_type)
  ),
  unggulan as (
    select c.company, e.equipment_type,
      jsonb_build_object(
        'top', coalesce((select jsonb_agg(to_jsonb(t) - 'n' order by t.peringkat, t.name)
                         from top t where t.company = c.company and t.equipment_type = e.equipment_type), '[]'::jsonb),
        'perlu', coalesce((select jsonb_agg(to_jsonb(b) - 'n' - 'urut_bawah' order by b.urut_bawah, b.name)
                           from bawah b where b.company = c.company and b.equipment_type = e.equipment_type
                             and b.urut_bawah <= b.n), '[]'::jsonb)
      ) as isi
    from (values ('ANTAM'), ('PCM')) c(company), (values ('exca'), ('truck')) e(equipment_type)
  ),
  komponen as (
    select s.equipment_type, k.key, count(*) as n
    from public.op_scores s, lateral jsonb_object_keys(s.metrics) k(key)
    where s.score_date between p_from and p_to
    group by s.equipment_type, k.key
  )
  select jsonb_build_object(
    'periode', jsonb_build_object('dari', p_from, 'sampai', p_to, 'hari', (p_to - p_from) + 1,
                                  'ambang_hadir', public.op_ambang_hadir(),
                                  'ambang_porsi', public.op_ambang_porsi(),
                                  'min_hari_bulanan', public.op_min_hari_bulanan(),
                                  'panjang_bulanan', public.op_panjang_bulanan()),
    'ringkasan', (select jsonb_object_agg(company, isi) from ringkasan),
    'unggulan', (select jsonb_object_agg(company, per_alat) from (
                   select company, jsonb_object_agg(equipment_type, isi) as per_alat
                   from unggulan group by company) u),
    'ranking', coalesce((select jsonb_agg(to_jsonb(a)) from a), '[]'::jsonb),
    'komponen', coalesce((select jsonb_object_agg(equipment_type, daftar) from (
                   select equipment_type, jsonb_agg(key order by n desc, key) as daftar
                   from komponen group by equipment_type) k), '{}'::jsonb),
    'status', public.op_status()
  );
$$;

-- =====================================================================
-- HALL OF FAME · juara tiap bulan yang sudah lewat, per jenis alat,
-- ANTAM dan PCM tidak dipisah. Syarat hadir dihitung per bulan dengan
-- aturan yang sama (op_agregat), jadi tidak ada angka minimum yang
-- dipatok di sini.
-- =====================================================================
create or replace function public.op_hall_of_fame()
returns jsonb
language sql
stable
as $$
  -- Aturannya sama persis dengan op_agregat (sah, median per kelompok,
  -- syarat hari, urutan nilai lalu hari), tapi dihitung sekali untuk semua
  -- bulan. Memanggil op_agregat per bulan terlalu lambat untuk data
  -- bertahun-tahun.
  with b as (
    select x.*, date_trunc('month', x.score_date)::date as bulan
    from public.op_baris(
           (select min(score_date) from public.op_scores),
           (date_trunc('month', public.op_hari_ini_wit()) - interval '1 day')::date) x
    where x.has_target and x.final and x.porsi_cukup
  ),
  per_op as (
    select bulan, badge, name, company, photo_path, equipment_type,
           count(*)::int as hari_valid,
           avg(overall_score) as nilai_mentah,
           round(avg(overall_score), 1) as nilai
    from b
    group by bulan, badge, name, company, photo_path, equipment_type
  ),
  grup as (
    select bulan, company, equipment_type,
           percentile_cont(0.5) within group (order by hari_valid)::numeric as median_grup
    from per_op group by bulan, company, equipment_type
  ),
  lolos as (
    select p.*, greatest(public.op_min_hari_bulanan(), ceil(g.median_grup * public.op_ambang_hadir()))::int as syarat_hari
    from per_op p
    join grup g using (bulan, company, equipment_type)
    where p.hari_valid >= greatest(public.op_min_hari_bulanan(), ceil(g.median_grup * public.op_ambang_hadir()))
  ),
  hasil as (
    select l.*,
      dense_rank() over (partition by l.bulan, l.equipment_type
                         order by round(l.nilai_mentah, 2) desc, l.hari_valid desc) as urut
    from lolos l
  ),
  ringkas as (
    select bulan, equipment_type,
      jsonb_agg(jsonb_build_object('badge', badge, 'name', name, 'company', company,
                                   'photo_path', photo_path, 'equipment_type', equipment_type,
                                   'nilai', nilai, 'hari_valid', hari_valid, 'syarat_hari', syarat_hari)
                order by name) filter (where urut = 1) as juara,
      jsonb_agg(name order by name) filter (where urut = 2) as kedua
    from hasil
    where urut <= 2
    group by bulan, equipment_type
  )
  select coalesce(jsonb_agg(baris order by bulan desc), '[]'::jsonb)
  from (
    select bulan, jsonb_build_object(
      'bulan', bulan,
      'exca',  (select jsonb_build_object('juara', juara, 'kedua', kedua) from ringkas r
                where r.bulan = m.bulan and r.equipment_type = 'exca'),
      'truck', (select jsonb_build_object('juara', juara, 'kedua', kedua) from ringkas r
                where r.bulan = m.bulan and r.equipment_type = 'truck')
    ) as baris
    from (select distinct bulan from ringkas) m
  ) t;
$$;

-- =====================================================================
-- DETAIL SATU OPERATOR · untuk popup
-- =====================================================================
create or replace function public.op_detail(p_badge text)
returns jsonb
language sql
stable
as $$
  with info as (
    select badge, name, company, photo_path, first_seen, last_seen
    from public.op_operators where badge = p_badge
  ),
  sah as (
    select * from public.op_baris(
             (select coalesce(first_seen, '2000-01-01') from public.op_operators where badge = p_badge),
             public.op_hari_ini_wit(), p_badge)
    where badge = p_badge and has_target and final and porsi_cukup
  ),
  alat as (
    select distinct equipment_type from public.op_scores where badge = p_badge
  ),
  awal_bulan as (
    select date_trunc('month', public.op_hari_ini_wit())::date as d
  ),
  bulan_ini as (
    select x.* from awal_bulan, lateral public.op_agregat(awal_bulan.d, public.op_hari_ini_wit()) x
  )
  select jsonb_build_object(
    'operator', (select to_jsonb(i) from info i),
    'alat', coalesce((
      select jsonb_agg(jsonb_build_object(
        'equipment_type', al.equipment_type,
        'sepanjang', (select jsonb_build_object(
                        'rata', round(avg(overall_score), 1),
                        'hari', count(*),
                        'terbaik', round(max(overall_score), 1),
                        'terendah', round(min(overall_score), 1),
                        'dari', min(score_date),
                        'sampai', max(score_date))
                      from sah where equipment_type = al.equipment_type),
        'komponen', (select jsonb_object_agg(kk.key, jsonb_build_object('p', kk.p, 's', kk.s)) from (
                       select k.key,
                              round(avg(nullif(z.metrics -> k.key ->> 'p', '')::numeric), 1) as p,
                              round(avg(nullif(z.metrics -> k.key ->> 's', '')::numeric), 2) as s
                       from sah z, lateral jsonb_object_keys(z.metrics) k(key)
                       where z.equipment_type = al.equipment_type
                       group by k.key) kk),
        'bulan_ini', (select jsonb_build_object(
                        'rata', b.nilai, 'hari', b.hari_valid, 'syarat_hari', b.syarat_hari,
                        'memenuhi', b.memenuhi, 'peringkat', b.peringkat,
                        'dari_n', (select count(*) from bulan_ini z
                                   where z.company = b.company and z.equipment_type = b.equipment_type and z.memenuhi))
                      from bulan_ini b where b.badge = p_badge and b.equipment_type = al.equipment_type),
        'bulanan', coalesce((select jsonb_agg(jsonb_build_object('bulan', bln, 'rata', rata, 'hari', hari) order by bln)
                    from (select date_trunc('month', score_date)::date bln,
                                 round(avg(overall_score), 1) rata, count(*) hari
                          from sah where equipment_type = al.equipment_type group by 1) m), '[]'::jsonb),
        'terakhir', coalesce((select jsonb_agg(jsonb_build_object('tanggal', score_date, 'nilai', overall_score) order by score_date)
                     from (select score_date, overall_score from sah
                           where equipment_type = al.equipment_type
                           order by score_date desc limit 30) r), '[]'::jsonb)
      ) order by al.equipment_type)
      from alat al), '[]'::jsonb)
  );
$$;

-- =====================================================================
-- EKSPOR EXCEL · data mentah per hari, termasuk baris yang tidak sah,
-- lengkap dengan penandanya supaya penerima berkas tahu kenapa.
-- =====================================================================
drop function if exists public.op_ekspor(date, date, text);
create function public.op_ekspor(
  p_from date,
  p_to   date,
  p_company text default null
)
returns table (
  score_date date, badge text, name text, company text,
  equipment_type text, overall_score numeric,
  has_target boolean, final boolean, source_rows int,
  grup_n int, porsi numeric, porsi_cukup boolean, metrics jsonb
)
language sql
stable
as $$
  select b.score_date, b.badge, b.name, b.company, b.equipment_type,
         b.overall_score, b.has_target, b.final, b.source_rows,
         b.grup_n, b.porsi, b.porsi_cukup, b.metrics
  from public.op_baris(p_from, p_to) b
  where (p_company is null or b.company = p_company)
  order by b.score_date, b.company, b.equipment_type, b.overall_score desc, b.name;
$$;

-- =====================================================================
-- HAK AKSES FUNGSI · hanya pengguna yang login
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.op_baris(date, date, text)',
    'public.op_agregat(date, date, boolean)',
    'public.op_status()',
    'public.op_halaman(date, date)',
    'public.op_hall_of_fame()',
    'public.op_detail(text)',
    'public.op_ekspor(date, date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
