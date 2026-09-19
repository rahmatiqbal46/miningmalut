-- =============================================================================
-- Asesmen Go/No-Go · 02 · Fungsi
-- Jalankan SETELAH 01. Aman dijalankan ulang.
--
-- Pesan galat berawalan "SESI:" berarti sesi NPP tidak berlaku lagi; aplikasi
-- lalu meminta masuk ulang. Pesan lain ditampilkan apa adanya ke pengguna.
-- =============================================================================

-- Jenis alat yang dikenal form. Urutan = urutan tombol di HP.
create or replace function public.gng_jenis_alat()
returns text[] language sql immutable as $$
  select array['Excavator','ADT','Dump Truck','Bulldozer','Wheel Loader','Grader','Compactor',
               'Water Truck','Fuel Truck','Manhaul','LV']
$$;

-- ---------------------------------------------------------------------------
-- Shift. Pergantian 06.30 dan 18.30 WIT. Form yang diisi sampai 60 menit
-- sebelum pergantian dihitung ke shift berikutnya:
--   05.30–17.29 → shift 1, tanggal hari itu
--   17.30–23.59 → shift 2, tanggal hari itu
--   00.00–05.29 → shift 2, tanggal kemarin (tanggal mulai shift)
-- Aturan yang sama ada di cek-aman.html (tentukanShift). Ubah keduanya bersama.
-- ---------------------------------------------------------------------------
create or replace function public.gng_shift_dari(p_ts timestamptz)
returns table (tanggal date, shift int)
language sql stable as $$
  with w as (select (p_ts at time zone 'Asia/Jayapura') as t),
       m as (select t, extract(hour from t)::int * 60 + extract(minute from t)::int as mnt from w)
  select case when mnt >= 330 then t::date else (t::date - 1) end,
         case when mnt >= 330 and mnt < 1050 then 1 else 2 end
  from m
$$;

create or replace function public.gng_jam(p_ts timestamptz)
returns text language sql stable as $$
  select to_char(p_ts at time zone 'Asia/Jayapura', 'HH24.MI')
$$;

-- ---------------------------------------------------------------------------
-- Admin & pengguna Mining (login Supabase)
-- ---------------------------------------------------------------------------
create or replace function public.gng_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.gng_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from gng_admin where email = gng_email() and gng_email() <> '')
$$;

create or replace function public.gng__wajib_mining()
returns void language plpgsql stable as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or gng_email() = '' then
    raise exception 'Sesi login MiningMalut berakhir. Keluar lalu masuk lagi.';
  end if;
end $$;

create or replace function public.gng__wajib_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform gng__wajib_mining();
  if not gng_is_admin() then
    raise exception 'Hanya admin Asesmen Go/No-Go yang boleh mengubah ini.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- NPP universal: format apa pun. Kunci pencocokan = huruf & angka saja, huruf
-- besar, dan tanpa nol di depan bila seluruhnya angka. Jadi "08027", "8027 ",
-- "8.027" cocok dengan 8027, dan "ad-001" cocok dengan AD001.
-- ---------------------------------------------------------------------------
create or replace function public.gng__npp(p text)
returns text language sql immutable as $$
  select case when x ~ '^[0-9]+$' then coalesce(nullif(ltrim(x, '0'), ''), '0') else x end
  from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as x) t
$$;

create or replace function public.gng__akun_npp(p text)
returns public.gng_akun language sql stable security definer set search_path = public as $$
  select * from gng_akun where gng__npp(npp) = gng__npp(p) order by aktif desc, npp limit 1
$$;

-- ---------------------------------------------------------------------------
-- Sesi NPP
-- ---------------------------------------------------------------------------
create or replace function public.gng__hash(p_token text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.gng__sesi(p_token text, p_peran text default null)
returns public.gng_akun
language plpgsql security definer set search_path = public, extensions as $$
declare s gng_sesi; a gng_akun;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'SESI: belum masuk';
  end if;
  select * into s from gng_sesi where token_hash = gng__hash(p_token);
  if not found or s.kedaluwarsa < now() then
    raise exception 'SESI: sesi berakhir, silakan masuk lagi';
  end if;
  select * into a from gng_akun where npp = s.npp;
  if not found or not a.aktif then
    delete from gng_sesi where npp = s.npp;
    raise exception 'SESI: akun tidak aktif. Hubungi admin Biro Mining.';
  end if;
  if a.peran <> s.peran then
    delete from gng_sesi where npp = s.npp;
    raise exception 'SESI: peran akun berubah, silakan masuk lagi';
  end if;
  if p_peran is not null and a.peran <> p_peran then
    raise exception 'Menu ini hanya untuk %.', p_peran;
  end if;
  if s.terakhir < now() - interval '10 minutes' then
    update gng_sesi set terakhir = now() where token_hash = s.token_hash;
  end if;
  return a;
end $$;

create or replace function public.gng_masuk(p_npp text, p_pin text default null, p_perangkat text default null)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a gng_akun; v_npp text := trim(coalesce(p_npp, '')); v_token text; v_umur interval;
begin
  if gng__npp(v_npp) = '' then raise exception 'Isi NPP.'; end if;
  a := gng__akun_npp(v_npp);
  if a.npp is null then
    raise exception 'NPP % belum terdaftar. Hubungi admin Biro Mining.', v_npp;
  end if;
  if not a.aktif then
    raise exception 'Akun NPP % sedang nonaktif. Hubungi admin Biro Mining.', v_npp;
  end if;

  -- Galat PIN dikembalikan sebagai {galat}, bukan raise: raise membatalkan transaksi,
  -- dan hitungan PIN salah ikut batal sehingga penguncian tidak pernah terjadi.
  v_npp := a.npp;   -- selanjutnya pakai NPP persis seperti tersimpan
  if a.peran = 'pengawas' then
    if a.terkunci_sampai is not null and a.terkunci_sampai > now() then
      return json_build_object('galat', 'Terlalu banyak PIN salah. Coba lagi pukul ' || gng_jam(a.terkunci_sampai) || ' WIT.');
    end if;
    if coalesce(trim(p_pin), '') = '' then
      return json_build_object('perlu_pin', true, 'galat', 'Akun pengawas: isi PIN.');
    end if;
    if not (a.pin_hash is not null and extensions.crypt(trim(p_pin), a.pin_hash) = a.pin_hash)
       and not (a.pin_awal and gng__npp(p_pin) = gng__npp(a.npp)) then
      update gng_akun set gagal_pin = gagal_pin + 1,
        terkunci_sampai = case when gagal_pin + 1 >= 5 then now() + interval '15 minutes' else terkunci_sampai end
      where npp = v_npp returning * into a;
      if a.gagal_pin >= 5 then
        update gng_akun set gagal_pin = 0 where npp = v_npp;
        return json_build_object('perlu_pin', true, 'galat', 'PIN salah 5 kali. Akun dikunci sampai pukul ' || gng_jam(a.terkunci_sampai) || ' WIT.');
      end if;
      return json_build_object('perlu_pin', true, 'galat', 'PIN salah. Sisa ' || (5 - a.gagal_pin) || ' percobaan.');
    end if;
    update gng_akun set gagal_pin = 0, terkunci_sampai = null where npp = v_npp;
    v_umur := interval '7 days';
  else
    v_umur := interval '30 days';
  end if;

  delete from gng_sesi where kedaluwarsa < now();
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into gng_sesi (token_hash, npp, peran, kedaluwarsa, perangkat)
  values (gng__hash(v_token), v_npp, a.peran, now() + v_umur, left(p_perangkat, 200));

  return json_build_object(
    'token', v_token, 'npp', a.npp, 'nama', a.nama, 'peran', a.peran,
    'alat_bawaan', a.alat_bawaan,
    'pin_awal', (a.peran = 'pengawas' and a.pin_awal));
end $$;

create or replace function public.gng_ganti_pin(p_token text, p_pin_lama text, p_pin_baru text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a gng_akun; v_baru text := trim(coalesce(p_pin_baru, ''));
begin
  a := gng__sesi(p_token, null);
  if a.peran <> 'pengawas' then raise exception 'Hanya akun pengawas yang memakai PIN.'; end if;
  if extensions.crypt(trim(coalesce(p_pin_lama, '')), a.pin_hash) <> a.pin_hash
     and not (a.pin_awal and gng__npp(p_pin_lama) = gng__npp(a.npp)) then
    raise exception 'PIN sekarang salah.';
  end if;
  if v_baru !~ '^[0-9]{4,6}$' then raise exception 'PIN baru harus 4 sampai 6 angka.'; end if;
  if gng__npp(v_baru) = gng__npp(a.npp) then raise exception 'PIN baru tidak boleh sama dengan NPP.'; end if;
  if v_baru in ('0000','1111','1234','123456','000000') then raise exception 'PIN itu terlalu mudah ditebak. Pilih yang lain.'; end if;
  update gng_akun set pin_hash = extensions.crypt(v_baru, extensions.gen_salt('bf')),
    pin_awal = false, diubah = now(), diubah_oleh = a.npp
  where npp = a.npp;
  -- sesi lain milik pengawas ini dicabut, sesi yang sedang dipakai tetap
  delete from gng_sesi where npp = a.npp and token_hash <> gng__hash(p_token);
  return json_build_object('ok', true);
end $$;

create or replace function public.gng_keluar(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.gng_sesi where token_hash = public.gng__hash(p_token)
$$;

-- ---------------------------------------------------------------------------
-- Ringkasan satu form (daftar) dan isi lengkapnya (detail)
-- ---------------------------------------------------------------------------
create or replace function public.gng__ringkas(f public.gng_form)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', f.id, 'no', f.no, 'npp', f.npp, 'nama', f.nama, 'alat', f.alat, 'unit', f.unit,
    'unit_manual', f.unit_manual, 'lokasi', f.lokasi, 'lokasi_manual', f.lokasi_manual,
    'tanggal', f.tanggal, 'shift', f.shift, 'diisi', f.diisi, 'dikirim', f.dikirim,
    'jumlah_tidak', f.jumlah_tidak, 'status', f.status,
    'keputusan_nama', f.keputusan_nama, 'keputusan_waktu', f.keputusan_waktu, 'catatan', f.catatan,
    'kendala', (select string_agg(q ->> 'ringkas', ' · ' order by (q ->> 'no')::int)
                from jsonb_array_elements(f.pertanyaan) q
                where f.jawaban ->> (q ->> 'id') = 'T'))
$$;

create or replace function public.gng__lengkap(f public.gng_form)
returns jsonb language sql stable as $$
  select public.gng__ringkas(f) || jsonb_build_object(
    'pertanyaan', f.pertanyaan, 'jawaban', f.jawaban, 'evidence', f.evidence,
    'keputusan_npp', f.keputusan_npp)
$$;

-- ---------------------------------------------------------------------------
-- Operator
-- ---------------------------------------------------------------------------
create or replace function public.gng__master()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'alat', to_jsonb(gng_jenis_alat()),
    'pertanyaan', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'bagian', bagian, 'urut', urut, 'teks', teks, 'ringkas', ringkas,
        'alat', alat, 'shift', shift) order by bagian, urut, id)
      from gng_pertanyaan where aktif), '[]'::jsonb),
    'unit', coalesce((select jsonb_agg(jsonb_build_object('nama', nama, 'alat', alat) order by alat, nama)
      from gng_unit where aktif), '[]'::jsonb),
    'lokasi', coalesce((select jsonb_agg(nama order by nama) from gng_lokasi where aktif), '[]'::jsonb),
    'versi', greatest(
      (select max(diubah) from gng_pertanyaan), (select max(diubah) from gng_unit),
      (select max(diubah) from gng_lokasi)))
$$;

-- p_versi: versi terakhir yang dipegang HP. Bila sama, yang dikirim hanya {sama:true}
create or replace function public.gng_operator(p_token text, p_versi text default null, p_master text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a gng_akun; v text; r jsonb; m jsonb; mv text;
begin
  a := gng__sesi(p_token, 'operator');
  select coalesce(max(diubah)::text, '-') || '|' || count(*) into v from gng_form where npp = a.npp;
  m := null;
  select greatest((select max(diubah) from gng_pertanyaan), (select max(diubah) from gng_unit),
                  (select max(diubah) from gng_lokasi))::text into mv;
  if p_versi is not null and p_versi = v and p_master is not distinct from mv then
    return jsonb_build_object('sama', true);
  end if;
  if p_master is distinct from mv then m := gng__master(); end if;
  select coalesce(jsonb_agg(gng__ringkas(f) order by f.diisi desc), '[]'::jsonb) into r
  from (select * from gng_form where npp = a.npp order by diisi desc limit 15) f;
  return jsonb_build_object(
    'akun', jsonb_build_object('npp', a.npp, 'nama', a.nama, 'peran', a.peran, 'alat_bawaan', a.alat_bawaan),
    'versi', v, 'master_versi', mv, 'master', m, 'riwayat', r,
    'sekarang', now());
end $$;

create or replace function public.gng__nomor_baru(p_tanggal date)
returns text language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into gng_nomor (tanggal, n) values (p_tanggal, 1)
  on conflict (tanggal) do update set n = gng_nomor.n + 1
  returning n into v;
  return 'GNG-' || to_char(p_tanggal, 'YYYYMMDD') || '-' || lpad(v::text, 3, '0');
end $$;

create or replace function public.gng_kirim(p_token text, p_form jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a gng_akun; f gng_form; v_id uuid; v_diisi timestamptz; v_tgl date; v_shift int;
  v_alat text; v_unit text; v_lok text; q jsonb; v_j text; v_ev jsonb; v_e jsonb;
  v_tidak int := 0; v_jaw jsonb := '{}'::jsonb; v_evd jsonb := '{}'::jsonb; v_p text;
  v_unit_m boolean; v_lok_m boolean; v_hitung int := 0; v_ids int[] := '{}';
begin
  a := gng__sesi(p_token, 'operator');
  begin v_id := (p_form ->> 'id')::uuid; exception when others then raise exception 'Form tidak sah (id).'; end;

  select * into f from gng_form where id = v_id;
  if found then
    if f.npp <> a.npp then raise exception 'Form tidak sah.'; end if;
    return gng__ringkas(f);           -- kiriman ulang: kembalikan yang sudah tersimpan
  end if;

  begin v_diisi := (p_form ->> 'diisi')::timestamptz; exception when others then raise exception 'Jam pengisian tidak sah.'; end;
  if v_diisi is null or v_diisi > now() + interval '10 minutes' or v_diisi < now() - interval '3 days' then
    raise exception 'Jam pengisian di HP tidak masuk akal. Periksa jam HP lalu isi form baru.';
  end if;
  begin v_tgl := (p_form ->> 'tanggal')::date; v_shift := (p_form ->> 'shift')::int;
  exception when others then raise exception 'Tanggal atau shift tidak sah.'; end;
  if v_shift not in (1,2) or abs(v_tgl - (v_diisi at time zone 'Asia/Jayapura')::date) > 1 then
    raise exception 'Tanggal atau shift tidak sah.';
  end if;

  v_alat := p_form ->> 'alat';
  if v_alat is null or not (v_alat = any (gng_jenis_alat())) then raise exception 'Pilih jenis alat.'; end if;
  v_unit := left(trim(coalesce(p_form ->> 'unit', '')), 40);
  v_lok  := left(trim(coalesce(p_form ->> 'lokasi', '')), 80);
  if length(v_unit) < 2 then raise exception 'Isi no. unit.'; end if;
  if length(v_lok) < 2 then raise exception 'Isi lokasi / front.'; end if;

  if jsonb_typeof(p_form -> 'pertanyaan') <> 'array' or jsonb_array_length(p_form -> 'pertanyaan') = 0 then
    raise exception 'Daftar pertanyaan kosong.';
  end if;
  for q in select * from jsonb_array_elements(p_form -> 'pertanyaan') loop
    if (q ->> 'id') is null or (q ->> 'teks') is null then raise exception 'Pertanyaan tidak sah.'; end if;
    if (q ->> 'id')::int = any (v_ids) then raise exception 'Pertanyaan ganda.'; end if;
    v_ids := v_ids || (q ->> 'id')::int;
    v_hitung := v_hitung + 1;
    v_j := p_form -> 'jawaban' ->> (q ->> 'id');
    if v_j not in ('Y','T') or v_j is null then
      raise exception 'Pertanyaan no. % belum dijawab.', coalesce(q ->> 'no', q ->> 'id');
    end if;
    v_jaw := v_jaw || jsonb_build_object(q ->> 'id', v_j);
    if v_j = 'T' then
      v_tidak := v_tidak + 1;
      v_e := p_form -> 'evidence' -> (q ->> 'id');
      if length(trim(coalesce(v_e ->> 'ket', ''))) < 5 then
        raise exception 'Keterangan untuk jawaban TIDAK no. % belum diisi.', coalesce(q ->> 'no', q ->> 'id');
      end if;
      if jsonb_typeof(v_e -> 'foto') <> 'array' or jsonb_array_length(v_e -> 'foto') not between 1 and 3 then
        raise exception 'Foto untuk jawaban TIDAK no. % belum ada.', coalesce(q ->> 'no', q ->> 'id');
      end if;
      for v_p in select jsonb_array_elements_text(v_e -> 'foto') loop
        if v_p !~ ('^' || v_id::text || '/[0-9a-f-]{36}\.jpg$') then raise exception 'Foto tidak sah.'; end if;
      end loop;
      v_evd := v_evd || jsonb_build_object(q ->> 'id',
        jsonb_build_object('ket', left(trim(v_e ->> 'ket'), 1000), 'foto', v_e -> 'foto'));
    end if;
  end loop;
  if v_hitung > 60 then raise exception 'Pertanyaan terlalu banyak.'; end if;

  v_unit_m := not exists (select 1 from gng_unit where lower(nama) = lower(v_unit));
  v_lok_m  := not exists (select 1 from gng_lokasi where lower(nama) = lower(v_lok));
  if v_unit_m then
    insert into gng_manual (jenis, teks, alat, oleh) values ('unit', v_unit, v_alat, a.nama)
    on conflict (jenis, lower(teks)) do update set jumlah = gng_manual.jumlah + 1, oleh = excluded.oleh,
      terakhir = now(), alat = coalesce(gng_manual.alat, excluded.alat);
  end if;
  if v_lok_m then
    insert into gng_manual (jenis, teks, oleh) values ('lokasi', v_lok, a.nama)
    on conflict (jenis, lower(teks)) do update set jumlah = gng_manual.jumlah + 1, oleh = excluded.oleh, terakhir = now();
  end if;

  insert into gng_form (id, no, npp, nama, alat, unit, unit_manual, lokasi, lokasi_manual, tanggal, shift,
                        diisi, pertanyaan, jawaban, evidence, jumlah_tidak)
  values (v_id, gng__nomor_baru(v_tgl), a.npp, a.nama, v_alat, v_unit, v_unit_m, v_lok, v_lok_m, v_tgl, v_shift,
          v_diisi, p_form -> 'pertanyaan', v_jaw, v_evd, v_tidak)
  returning * into f;
  return gng__ringkas(f);
end $$;

-- Isi lengkap satu form. Operator: hanya miliknya. Pengawas: semua.
-- Tanpa token: pengguna Mining yang login.
create or replace function public.gng_form(p_id uuid, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a gng_akun; f gng_form;
begin
  if p_token is null then perform gng__wajib_mining(); else a := gng__sesi(p_token, null);
  end if;
  select * into f from gng_form where id = p_id;
  if not found then raise exception 'Form tidak ditemukan.'; end if;
  if p_token is not null and a.peran = 'operator' and f.npp <> a.npp then raise exception 'Form tidak ditemukan.'; end if;
  return gng__lengkap(f);
end $$;

-- ---------------------------------------------------------------------------
-- Pengawas
-- ---------------------------------------------------------------------------
create or replace function public.gng_pengawas(p_token text, p_versi text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a gng_akun; v text; s record; w jsonb; d jsonb;
begin
  a := gng__sesi(p_token, 'pengawas');
  select * into s from gng_shift_dari(now());
  select coalesce(max(diubah)::text, '-') || '|' || count(*) into v
  from gng_form where status = 'wait' or (tanggal = s.tanggal and shift = s.shift);
  if p_versi is not null and p_versi = v then return jsonb_build_object('sama', true); end if;
  select coalesce(jsonb_agg(gng__ringkas(f) order by f.dikirim), '[]'::jsonb) into w
  from (select * from gng_form where status = 'wait' order by dikirim limit 300) f;
  select coalesce(jsonb_agg(gng__ringkas(f) order by f.keputusan_waktu desc), '[]'::jsonb) into d
  from gng_form f where f.tanggal = s.tanggal and f.shift = s.shift and f.status <> 'wait';
  return jsonb_build_object(
    'akun', jsonb_build_object('npp', a.npp, 'nama', a.nama, 'peran', a.peran),
    'versi', v, 'tanggal', s.tanggal, 'shift', s.shift, 'menunggu', w, 'diputuskan', d, 'sekarang', now());
end $$;

create or replace function public.gng_putuskan(p_token text, p_id uuid, p_keputusan text, p_catatan text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a gng_akun; f gng_form; v_cat text := left(trim(coalesce(p_catatan, '')), 1000);
begin
  a := gng__sesi(p_token, 'pengawas');
  if p_keputusan not in ('go','nogo') then raise exception 'Keputusan tidak sah.'; end if;
  select * into f from gng_form where id = p_id for update;
  if not found then raise exception 'Form tidak ditemukan.'; end if;
  if f.status <> 'wait' then
    raise exception 'Form ini sudah diputuskan % oleh % pukul % WIT.',
      case f.status when 'go' then 'GO' else 'NO-GO' end, f.keputusan_nama, gng_jam(f.keputusan_waktu);
  end if;
  if p_keputusan = 'go' and f.jumlah_tidak > 0 then
    raise exception 'Form dengan jawaban TIDAK tidak bisa diberi GO. Operator mengisi form baru setelah perbaikan.';
  end if;
  if p_keputusan = 'nogo' and length(v_cat) < 5 then
    raise exception 'Tulis apa yang harus diperbaiki dulu.';
  end if;
  update gng_form set status = p_keputusan, keputusan_npp = a.npp, keputusan_nama = a.nama,
    keputusan_waktu = now(), catatan = nullif(v_cat, ''), diubah = now()
  where id = p_id returning * into f;
  return gng__ringkas(f);
end $$;

-- ---------------------------------------------------------------------------
-- Dipanggil Edge Function gng-foto (service role saja)
-- ---------------------------------------------------------------------------
create or replace function public.gng_sesi_foto(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a gng_akun;
begin
  a := gng__sesi(p_token, null);
  return jsonb_build_object('npp', a.npp, 'peran', a.peran);
end $$;

create or replace function public.gng_foto_boleh(p_token text, p_paths text[])
returns boolean language plpgsql security definer set search_path = public as $$
declare a gng_akun; p text; v_id uuid;
begin
  a := gng__sesi(p_token, null);
  foreach p in array p_paths loop
    begin v_id := split_part(p, '/', 1)::uuid; exception when others then return false; end;
    if not exists (
      select 1 from gng_form f
      where f.id = v_id and (a.peran = 'pengawas' or f.npp = a.npp)
        and exists (select 1 from jsonb_each(f.evidence) e, jsonb_array_elements_text(e.value -> 'foto') x where x = p)
    ) then return false; end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Mining (login Supabase): dashboard, detail, ekspor
-- ---------------------------------------------------------------------------
create or replace function public.gng_saya()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform gng__wajib_mining();
  return jsonb_build_object('email', gng_email(), 'admin', gng_is_admin());
end $$;

create or replace function public.gng_dashboard(p_dari date, p_sampai date, p_shift int default null, p_versi text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text; res jsonb;
begin
  perform gng__wajib_mining();
  select coalesce(max(diubah)::text, '-') || '|' || count(*) into v from gng_form;
  if p_versi is not null and p_versi = v then return jsonb_build_object('sama', true); end if;

  with p as (
    select * from gng_form
    where tanggal between p_dari and p_sampai and (p_shift is null or shift = p_shift)
  ), t as (
    select key::int as id, count(*) as n
    from p, jsonb_each_text(p.jawaban)
    where p.status = 'nogo' and value = 'T'
    group by key
  )
  select jsonb_build_object(
    'versi', v,
    'sekarang', now(),
    'alat', to_jsonb(gng_jenis_alat()),
    'shift_kini', (select jsonb_build_object('tanggal', tanggal, 'shift', shift) from gng_shift_dari(now())),
    'total', (select count(*) from p),
    'go', (select count(*) from p where status = 'go'),
    'nogo', (select count(*) from p where status = 'nogo'),
    'wait_periode', (select count(*) from p where status = 'wait'),
    'unit_dihentikan', (select count(distinct unit) from p where status = 'nogo'),
    'rata_menit', (select round(avg(extract(epoch from keputusan_waktu - dikirim) / 60)::numeric, 0)
                   from p where keputusan_waktu is not null),
    'menunggu', (select coalesce(jsonb_agg(gng__ringkas(f) order by f.dikirim), '[]'::jsonb)
                 from (select * from gng_form where status = 'wait' order by dikirim limit 300) f),
    'daftar_nogo', (select coalesce(jsonb_agg(gng__ringkas(f) order by f.diisi desc), '[]'::jsonb)
                    from (select * from p where status = 'nogo' order by diisi desc limit 300) f),
    'daftar_go', (select coalesce(jsonb_agg(gng__ringkas(f) order by f.diisi desc), '[]'::jsonb)
                  from (select * from p where status = 'go' order by diisi desc limit 300) f),
    'top_tidak', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'n', t.n,
                     'ringkas', coalesce(q.ringkas, 'Pertanyaan ' || t.id)) order by t.n desc, t.id), '[]'::jsonb)
                  from (select * from t order by n desc, id limit 5) t left join gng_pertanyaan q on q.id = t.id)
  ) into res;
  return res;
end $$;

create or replace function public.gng_ekspor(p_dari date, p_sampai date, p_alat text[] default null,
  p_keputusan text default null, p_limit int default 1000, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform gng__wajib_mining();
  select coalesce(jsonb_agg(gng__lengkap(f) order by f.tanggal, f.shift, f.diisi, f.no), '[]'::jsonb) into res
  from (select * from gng_form
        where tanggal between p_dari and p_sampai and status <> 'wait'
          and (p_alat is null or cardinality(p_alat) = 0 or alat = any (p_alat))
          and (p_keputusan is null or p_keputusan = 'semua' or status = p_keputusan)
        order by tanggal, shift, diisi, no
        limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) f;
  return res;
end $$;

create or replace function public.gng_ekspor_hitung(p_dari date, p_sampai date, p_alat text[] default null, p_keputusan text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform gng__wajib_mining();
  select jsonb_build_object('total', count(*), 'go', count(*) filter (where status = 'go'),
                            'nogo', count(*) filter (where status = 'nogo')) into res
  from gng_form
  where tanggal between p_dari and p_sampai and status <> 'wait'
    and (p_alat is null or cardinality(p_alat) = 0 or alat = any (p_alat))
    and (p_keputusan is null or p_keputusan = 'semua' or status = p_keputusan);
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: tab Kelola
-- ---------------------------------------------------------------------------
create or replace function public.gng_admin_data()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform gng__wajib_admin();
  return jsonb_build_object(
    'alat', to_jsonb(gng_jenis_alat()),
    'pertanyaan', coalesce((select jsonb_agg(to_jsonb(q) - 'diubah_oleh' order by bagian, urut, id) from gng_pertanyaan q), '[]'::jsonb),
    'akun', coalesce((select jsonb_agg(jsonb_build_object('npp', npp, 'nama', nama, 'peran', peran, 'jabatan', jabatan,
              'alat_bawaan', alat_bawaan, 'aktif', aktif, 'sumber', sumber,
              'pin_awal', (peran = 'pengawas' and pin_awal),
              'terkunci', (terkunci_sampai is not null and terkunci_sampai > now())) order by peran desc, nama) from gng_akun), '[]'::jsonb),
    'unit', coalesce((select jsonb_agg(jsonb_build_object('nama', nama, 'alat', alat, 'model', model, 'sumber', sumber, 'aktif', aktif)
              order by alat, nama) from gng_unit), '[]'::jsonb),
    'lokasi', coalesce((select jsonb_agg(jsonb_build_object('nama', nama, 'sumber', sumber, 'aktif', aktif) order by nama) from gng_lokasi), '[]'::jsonb),
    'manual', coalesce((select jsonb_agg(to_jsonb(m) order by m.jumlah desc, m.terakhir desc) from gng_manual m where status = 'baru'), '[]'::jsonb),
    'admin', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'ditambah_oleh', ditambah_oleh) order by email) from gng_admin), '[]'::jsonb));
end $$;

create or replace function public.gng_simpan_pertanyaan(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id int := nullif(p ->> 'id', '')::int; v_alat text[]; v_bag text := p ->> 'bagian';
begin
  perform gng__wajib_admin();
  if v_bag not in ('A','B','C','D','E') then raise exception 'Bagian tidak sah.'; end if;
  if length(trim(coalesce(p ->> 'teks', ''))) < 10 then raise exception 'Tulis pertanyaannya minimal 10 karakter.'; end if;
  if length(trim(coalesce(p ->> 'ringkas', ''))) < 3 then raise exception 'Isi ringkasan singkat.'; end if;
  if jsonb_typeof(p -> 'alat') = 'array' and jsonb_array_length(p -> 'alat') > 0 then
    select array_agg(x) into v_alat from jsonb_array_elements_text(p -> 'alat') x;
    if exists (select 1 from unnest(v_alat) x where not (x = any (gng_jenis_alat()))) then raise exception 'Jenis alat tidak dikenal.'; end if;
  end if;
  if v_id is null then
    insert into gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, aktif, diubah_oleh)
    values ((select coalesce(max(id), 0) + 1 from gng_pertanyaan), v_bag,
            (select coalesce(max(urut), 0) + 1 from gng_pertanyaan where bagian = v_bag),
            trim(p ->> 'teks'), trim(p ->> 'ringkas'), v_alat, nullif(p ->> 'shift', '')::int, true, gng_email());
  else
    update gng_pertanyaan set
      bagian = v_bag,
      urut = case when bagian = v_bag then urut else (select coalesce(max(urut), 0) + 1 from gng_pertanyaan where bagian = v_bag) end,
      teks = trim(p ->> 'teks'), ringkas = trim(p ->> 'ringkas'), alat = v_alat,
      shift = nullif(p ->> 'shift', '')::int,
      aktif = coalesce((p ->> 'aktif')::boolean, aktif), diubah = now(), diubah_oleh = gng_email()
    where id = v_id;
    if not found then raise exception 'Pertanyaan tidak ditemukan.'; end if;
  end if;
end $$;

create or replace function public.gng_geser_pertanyaan(p_id int, p_arah int)
returns void
language plpgsql security definer set search_path = public as $$
declare a gng_pertanyaan; b gng_pertanyaan;
begin
  perform gng__wajib_admin();
  select * into a from gng_pertanyaan where id = p_id;
  if not found then raise exception 'Pertanyaan tidak ditemukan.'; end if;
  if p_arah < 0 then
    select * into b from gng_pertanyaan where bagian = a.bagian and urut < a.urut order by urut desc limit 1;
  else
    select * into b from gng_pertanyaan where bagian = a.bagian and urut > a.urut order by urut limit 1;
  end if;
  if not found then return; end if;
  update gng_pertanyaan set urut = b.urut, diubah = now(), diubah_oleh = gng_email() where id = a.id;
  update gng_pertanyaan set urut = a.urut, diubah = now(), diubah_oleh = gng_email() where id = b.id;
end $$;

create or replace function public.gng__alat_dari_jabatan(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    when p ~* 'excavator|digger' then 'Excavator'
    when p ~* 'adt|a40' then 'ADT'
    when p ~* 'dump ?truck' then 'Dump Truck'
    when p ~* 'wheel ?loader|\mloader' then 'Wheel Loader'
    when p ~* 'dozer' then 'Bulldozer'
    when p ~* 'grader' then 'Grader'
    when p ~* 'compactor' then 'Compactor'
    when p ~* 'water ?truck' then 'Water Truck'
    when p ~* 'fuel ?truck' then 'Fuel Truck'
    when p ~* 'bus|manhaul' then 'Manhaul'
    when p ~* 'light vehicle|\mlv\M' then 'LV'
    else null end
$$;

-- Satu akun. p_baru = true untuk menambah.
create or replace function public.gng_simpan_akun(p jsonb, p_baru boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_npp text := upper(trim(coalesce(p ->> 'npp', ''))); v_peran text := p ->> 'peran';
        v_nama text := trim(coalesce(p ->> 'nama', '')); a gng_akun; b gng_akun;
begin
  perform gng__wajib_admin();
  if gng__npp(v_npp) = '' or length(v_npp) > 30 then raise exception 'Isi NPP (paling panjang 30 karakter).'; end if;
  if v_peran not in ('operator','pengawas') then raise exception 'Peran tidak sah.'; end if;
  if length(v_nama) < 3 then raise exception 'Isi nama lengkap.'; end if;
  if p_baru then
    b := gng__akun_npp(v_npp);
    if b.npp is not null then
      raise exception 'NPP % sudah terdaftar sebagai % atas nama %.', v_npp, b.npp, b.nama;
    end if;
    insert into gng_akun (npp, nama, peran, jabatan, alat_bawaan, pin_hash, pin_awal, sumber, diubah_oleh)
    values (v_npp, v_nama, v_peran, nullif(trim(p ->> 'jabatan'), ''), gng__alat_dari_jabatan(p ->> 'jabatan'),
            case when v_peran = 'pengawas' then extensions.crypt(v_npp, extensions.gen_salt('bf')) end, true, 'admin', gng_email());
  else
    select * into a from gng_akun where npp = v_npp;
    if not found then raise exception 'Akun tidak ditemukan.'; end if;
    update gng_akun set nama = v_nama, peran = v_peran,
      aktif = coalesce((p ->> 'aktif')::boolean, aktif),
      pin_hash = case when v_peran = 'pengawas' and pin_hash is null then extensions.crypt(v_npp, extensions.gen_salt('bf')) else pin_hash end,
      pin_awal = case when v_peran = 'pengawas' and a.pin_hash is null then true else pin_awal end,
      diubah = now(), diubah_oleh = gng_email()
    where npp = v_npp;
    if a.peran <> v_peran or coalesce((p ->> 'aktif')::boolean, true) = false then
      delete from gng_sesi where npp = v_npp;
    end if;
  end if;
end $$;

-- PIN pengawas kembali ke NPP-nya. Pengawas boleh menggantinya sendiri kapan saja.
create or replace function public.gng_reset_pin(p_npp text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gng__wajib_admin();
  update gng_akun set pin_hash = extensions.crypt(npp, extensions.gen_salt('bf')), pin_awal = true,
    gagal_pin = 0, terkunci_sampai = null, diubah = now(), diubah_oleh = gng_email()
  where npp = (gng__akun_npp(p_npp)).npp and peran = 'pengawas';
  if not found then raise exception 'Akun pengawas tidak ditemukan.'; end if;
  delete from gng_sesi where npp = (gng__akun_npp(p_npp)).npp;
end $$;

-- Banyak akun sekaligus (tempel dari Excel). Yang sudah ada: nama & peran diperbarui.
create or replace function public.gng_impor_akun(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; v_baru int := 0; v_ubah int := 0; v_npp text; v_peran text; b gng_akun;
begin
  perform gng__wajib_admin();
  for x in select * from jsonb_array_elements(p) loop
    v_npp := upper(trim(coalesce(x ->> 'npp', '')));
    v_peran := case when x ->> 'peran' = 'pengawas' then 'pengawas' else 'operator' end;
    if gng__npp(v_npp) = '' or length(v_npp) > 30 or length(trim(coalesce(x ->> 'nama', ''))) < 3 then continue; end if;
    b := gng__akun_npp(v_npp);
    if b.npp is not null then
      v_npp := b.npp;
      update gng_akun set nama = trim(x ->> 'nama'), peran = v_peran,
        pin_hash = case when v_peran = 'pengawas' and pin_hash is null then extensions.crypt(v_npp, extensions.gen_salt('bf')) else pin_hash end,
        diubah = now(), diubah_oleh = gng_email()
      where npp = v_npp;
      v_ubah := v_ubah + 1;
    else
      insert into gng_akun (npp, nama, peran, jabatan, alat_bawaan, pin_hash, sumber, diubah_oleh)
      values (v_npp, trim(x ->> 'nama'), v_peran, nullif(trim(x ->> 'jabatan'), ''), gng__alat_dari_jabatan(x ->> 'jabatan'),
              case when v_peran = 'pengawas' then extensions.crypt(v_npp, extensions.gen_salt('bf')) end, 'admin', gng_email());
      v_baru := v_baru + 1;
    end if;
  end loop;
  return jsonb_build_object('baru', v_baru, 'diubah', v_ubah);
end $$;

create or replace function public.gng_simpan_unit(p jsonb, p_nama_lama text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_nama text := trim(coalesce(p ->> 'nama', '')); v_alat text := p ->> 'alat';
begin
  perform gng__wajib_admin();
  if length(v_nama) < 2 or length(v_nama) > 40 then raise exception 'Isi no. unit (2–40 karakter).'; end if;
  if not (v_alat = any (gng_jenis_alat())) then raise exception 'Pilih jenis alat.'; end if;
  if p_nama_lama is null then
    if exists (select 1 from gng_unit where lower(nama) = lower(v_nama)) then raise exception 'Unit % sudah ada.', v_nama; end if;
    insert into gng_unit (nama, alat, model, sumber, diubah_oleh) values (v_nama, v_alat, nullif(trim(p ->> 'model'), ''), 'admin', gng_email());
  else
    if lower(v_nama) <> lower(p_nama_lama) and exists (select 1 from gng_unit where lower(nama) = lower(v_nama)) then
      raise exception 'Unit % sudah ada.', v_nama; end if;
    update gng_unit set nama = v_nama, alat = v_alat, model = coalesce(nullif(trim(p ->> 'model'), ''), model),
      aktif = coalesce((p ->> 'aktif')::boolean, aktif), diubah = now(), diubah_oleh = gng_email()
    where nama = p_nama_lama;
    if not found then raise exception 'Unit tidak ditemukan.'; end if;
  end if;
  update gng_manual set status = 'ditambah' where jenis = 'unit' and lower(teks) = lower(v_nama) and status = 'baru';
end $$;

-- Tempel dari sheet master_unit_population: Equipment ID · Equipment Type · Model
create or replace function public.gng_impor_unit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; v_baru int := 0; v_ubah int := 0; v_nama text; v_alat text;
begin
  perform gng__wajib_admin();
  for x in select * from jsonb_array_elements(p) loop
    v_nama := trim(coalesce(x ->> 'nama', '')); v_alat := x ->> 'alat';
    if length(v_nama) < 2 or not (v_alat = any (gng_jenis_alat())) then continue; end if;
    if exists (select 1 from gng_unit where lower(nama) = lower(v_nama)) then
      update gng_unit set alat = v_alat, model = coalesce(nullif(trim(x ->> 'model'), ''), model), diubah = now(), diubah_oleh = gng_email()
      where lower(nama) = lower(v_nama);
      v_ubah := v_ubah + 1;
    else
      insert into gng_unit (nama, alat, model, sumber, diubah_oleh) values (v_nama, v_alat, nullif(trim(x ->> 'model'), ''), 'admin', gng_email());
      v_baru := v_baru + 1;
    end if;
  end loop;
  return jsonb_build_object('baru', v_baru, 'diubah', v_ubah);
end $$;

create or replace function public.gng_simpan_lokasi(p jsonb, p_nama_lama text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_nama text := trim(coalesce(p ->> 'nama', ''));
begin
  perform gng__wajib_admin();
  if length(v_nama) < 2 or length(v_nama) > 80 then raise exception 'Isi nama lokasi (2–80 karakter).'; end if;
  if p_nama_lama is null then
    if exists (select 1 from gng_lokasi where lower(nama) = lower(v_nama)) then raise exception 'Lokasi itu sudah ada.'; end if;
    insert into gng_lokasi (nama, sumber, diubah_oleh) values (v_nama, 'admin', gng_email());
  else
    if lower(v_nama) <> lower(p_nama_lama) and exists (select 1 from gng_lokasi where lower(nama) = lower(v_nama)) then
      raise exception 'Lokasi itu sudah ada.'; end if;
    update gng_lokasi set nama = v_nama, aktif = coalesce((p ->> 'aktif')::boolean, aktif), diubah = now(), diubah_oleh = gng_email()
    where nama = p_nama_lama;
    if not found then raise exception 'Lokasi tidak ditemukan.'; end if;
  end if;
  update gng_manual set status = 'ditambah' where jenis = 'lokasi' and lower(teks) = lower(v_nama) and status = 'baru';
end $$;

-- Stasiun bernama dari peta RTUP bersama (baris dashboard rtup|jaringan|v1)
create or replace function public.gng_tarik_rtup()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  perform gng__wajib_admin();
  if to_regclass('public.dashboard') is null then return jsonb_build_object('baru', 0); end if;
  with n as (
    select distinct trim(x ->> 'name') as nama
    from dashboard d, jsonb_array_elements(d.data -> 'payload' -> 'nodes') x
    where d.id = 'rtup|jaringan|v1' and coalesce(trim(x ->> 'name'), '') <> ''
  ), ins as (
    insert into gng_lokasi (nama, sumber, diubah_oleh)
    select nama, 'rtup', gng_email() from n
    where not exists (select 1 from gng_lokasi l where lower(l.nama) = lower(n.nama))
    returning 1
  ) select count(*) into v_n from ins;
  return jsonb_build_object('baru', v_n);
end $$;

create or replace function public.gng_manual_aksi(p_id bigint, p_aksi text, p_alat text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare m gng_manual;
begin
  perform gng__wajib_admin();
  select * into m from gng_manual where id = p_id;
  if not found then raise exception 'Isian tidak ditemukan.'; end if;
  if p_aksi = 'abaikan' then
    update gng_manual set status = 'diabaikan' where id = p_id;
  elsif p_aksi = 'tambah' then
    if m.jenis = 'unit' then
      if not (coalesce(p_alat, m.alat) = any (gng_jenis_alat())) then raise exception 'Pilih jenis alat.'; end if;
      insert into gng_unit (nama, alat, sumber, diubah_oleh) values (m.teks, coalesce(p_alat, m.alat), 'admin', gng_email())
      on conflict do nothing;
    else
      insert into gng_lokasi (nama, sumber, diubah_oleh) values (m.teks, 'admin', gng_email()) on conflict do nothing;
    end if;
    update gng_manual set status = 'ditambah' where id = p_id;
  else raise exception 'Aksi tidak sah.';
  end if;
end $$;

create or replace function public.gng_simpan_admin(p_email text, p_aksi text)
returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_email, '')));
begin
  perform gng__wajib_admin();
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Alamat email tidak sah.'; end if;
  if p_aksi = 'tambah' then
    insert into gng_admin (email, ditambah_oleh) values (v, gng_email()) on conflict do nothing;
  elsif p_aksi = 'hapus' then
    if v = gng_email() then raise exception 'Tidak bisa menghapus diri sendiri. Minta admin lain.'; end if;
    delete from gng_admin where email = v;
  else raise exception 'Aksi tidak sah.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Hak panggil
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'gng%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Operator & pengawas (token NPP; tanpa akun Supabase)
grant execute on function public.gng_masuk(text, text, text)          to anon, authenticated;
grant execute on function public.gng_ganti_pin(text, text, text)      to anon, authenticated;
grant execute on function public.gng_keluar(text)                     to anon, authenticated;
grant execute on function public.gng_operator(text, text, text)       to anon, authenticated;
grant execute on function public.gng_kirim(text, jsonb)               to anon, authenticated;
grant execute on function public.gng_form(uuid, text)                 to anon, authenticated;
grant execute on function public.gng_pengawas(text, text)             to anon, authenticated;
grant execute on function public.gng_putuskan(text, uuid, text, text) to anon, authenticated;
-- Mining & admin (login Supabase)
grant execute on function public.gng_saya()                                        to authenticated;
grant execute on function public.gng_dashboard(date, date, int, text)              to authenticated;
grant execute on function public.gng_ekspor(date, date, text[], text, int, int)    to authenticated;
grant execute on function public.gng_ekspor_hitung(date, date, text[], text)       to authenticated;
grant execute on function public.gng_admin_data()                                  to authenticated;
grant execute on function public.gng_simpan_pertanyaan(jsonb)                      to authenticated;
grant execute on function public.gng_geser_pertanyaan(int, int)                    to authenticated;
grant execute on function public.gng_simpan_akun(jsonb, boolean)                   to authenticated;
grant execute on function public.gng_reset_pin(text)                               to authenticated;
grant execute on function public.gng_impor_akun(jsonb)                             to authenticated;
grant execute on function public.gng_simpan_unit(jsonb, text)                      to authenticated;
grant execute on function public.gng_impor_unit(jsonb)                             to authenticated;
grant execute on function public.gng_simpan_lokasi(jsonb, text)                    to authenticated;
grant execute on function public.gng_tarik_rtup()                                  to authenticated;
grant execute on function public.gng_manual_aksi(bigint, text, text)               to authenticated;
grant execute on function public.gng_simpan_admin(text, text)                      to authenticated;
-- Edge Function gng-foto
grant execute on function public.gng_sesi_foto(text)          to service_role;
grant execute on function public.gng_foto_boleh(text, text[]) to service_role;
