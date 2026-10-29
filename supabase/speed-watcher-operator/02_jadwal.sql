-- =============================================================================
-- SPEED WATCHER · OPERATOR PELANGGAR · 02 · PENJADWAL
-- Jalankan SESUDAH Edge Function sw-operator ter-deploy dan lolos uji
-- (README langkah 3). Aman dijalankan ulang.
--
-- Pencatat berjalan tiap menit: '* * * * *'. Cukup sering untuk menangkap
-- setiap login baru, karena jam login diambil dari Minerva sendiri, bukan
-- dari jam putaran. ±43.200 panggilan sebulan; jatah gratis Edge Function
-- 500.000.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Kata sandi panggilan terjadwal memakai secret Vault yang SAMA dengan
-- Operator Performance (op_sync_secret = secret SYNC_SECRET Edge Function).
-- Secret Edge Function berlaku untuk semua function di project, jadi
-- sw-operator membaca SYNC_SECRET yang sudah ada. Tidak ada rahasia baru.
create or replace function public.swo_panggil()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rahasia text;
begin
  select decrypted_secret into rahasia from vault.decrypted_secrets where name = 'op_sync_secret';
  if rahasia is null then
    raise exception 'Secret op_sync_secret belum ada di Vault (lihat supabase/operator-performance/03_jadwal.sql)';
  end if;

  -- Kunci anon di bawah sama dengan yang sudah tersaji di index.html; ia
  -- hanya membuka pintu Edge Function. Izin sebenarnya dari x-sync-secret.
  return net.http_post(
    url     := 'https://qblivboqavhlugydhmjr.supabase.co/functions/v1/sw-operator',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFibGl2Ym9xYXZobHVneWRobWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MzMxNjksImV4cCI6MjA5NzIwOTE2OX0.q-rkx2lEONfstic5vlC_-3M1gosvnDd_oMje-2SZvNE',
      'x-sync-secret', rahasia
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.swo_panggil() from public, anon, authenticated;

-- Nama jadwal yang sama menimpa jadwal lama, jadi aman dijalankan ulang.
select cron.schedule('swo-rekam-tiap-menit', '* * * * *', $$ select public.swo_panggil() $$);

-- Periksa (beberapa menit sesudahnya):
--   select jobname, schedule, active from cron.job where jobname = 'swo-rekam-tiap-menit';
--   select pada, ok, unit_ditanya, unit_dijawab, login_baru, kejadian_baru, ms, pesan
--     from public.swo_putaran order by pada desc limit 10;
--
-- Menghentikan sementara:
--   select cron.unschedule('swo-rekam-tiap-menit');
