-- =====================================================================
-- OPERATOR PERFORMANCE · 03 · PENJADWAL
-- Jalankan SETELAH Edge Function sync-minerva ter-deploy dan lolos uji.
-- Aman dijalankan ulang.
--
--   07:00 WIT = 22:00 UTC  →  '0 22 * * *'
--   19:00 WIT = 10:00 UTC  →  '0 10 * * *'
--   pg_cron di Supabase memakai UTC. Menulis '0 7 * * *' akan
--   menjalankannya pukul 16:00 WIT.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Kata sandi panggilan terjadwal. Dibuat acak sekali, disimpan di Vault
-- (brankas terenkripsi Supabase), tidak pernah ditulis di berkas mana
-- pun. Nilainya disalin ke secret SYNC_SECRET di Edge Function (lihat
-- panduan langkah 5).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'op_sync_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'op_sync_secret',
      'Operator Performance: header x-sync-secret untuk Edge Function sync-minerva');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Pemanggil Edge Function.
-- Kunci anon di bawah sama dengan yang sudah tersaji di index.html;
-- ia hanya membuka pintu Edge Function. Yang benar-benar memberi izin
-- adalah x-sync-secret dari Vault.
-- ---------------------------------------------------------------------
create or replace function public.op_panggil_sync(p_mode text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rahasia text;
  st jsonb;
begin
  -- Pengisian data lama yang sudah selesai atau macet tidak memanggil
  -- apa pun, jadi jadwal 3 menitannya tidak perlu dicabut.
  if p_mode = 'mundur' then
    select value into st from op_state where key = 'mundur';
    if coalesce((st->>'selesai')::boolean, false) or st ? 'macet' then
      return null;
    end if;
  end if;

  select decrypted_secret into rahasia from vault.decrypted_secrets where name = 'op_sync_secret';
  if rahasia is null then
    raise exception 'Secret op_sync_secret belum ada di Vault';
  end if;

  return net.http_post(
    url     := 'https://qblivboqavhlugydhmjr.supabase.co/functions/v1/sync-minerva',
    body    := jsonb_build_object('mode', p_mode),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFibGl2Ym9xYXZobHVneWRobWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MzMxNjksImV4cCI6MjA5NzIwOTE2OX0.q-rkx2lEONfstic5vlC_-3M1gosvnDd_oMje-2SZvNE',
      'x-sync-secret', rahasia
    ),
    timeout_milliseconds := 150000
  );
end;
$$;

revoke all on function public.op_panggil_sync(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Jadwal. cron.schedule dengan nama yang sama menimpa jadwal lama,
-- jadi aman dijalankan ulang.
-- ---------------------------------------------------------------------
select cron.schedule('op-sinkron-0700-wit', '0 22 * * *', $$ select public.op_panggil_sync('rutin') $$);
select cron.schedule('op-sinkron-1900-wit', '0 10 * * *', $$ select public.op_panggil_sync('rutin') $$);

-- Pengisian data lama TIDAK dijadwalkan di sini. Ia dinyalakan lewat
-- 04_mulai_isi_data_lama.sql, setelah angka hasil uji dicocokkan dengan
-- Minerva. Kalau ada yang salah, lebih baik ketahuan pada tiga hari
-- daripada tiga tahun.

-- Periksa:
-- select jobname, schedule, active from cron.job where jobname like 'op-%';
