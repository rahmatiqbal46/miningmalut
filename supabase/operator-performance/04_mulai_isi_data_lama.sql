-- =====================================================================
-- OPERATOR PERFORMANCE · 04 · MULAI PENGISIAN DATA LAMA
-- Jalankan HANYA setelah hasil uji di langkah 7 panduan dinyatakan cocok.
--
-- Tiap 3 menit Edge Function mengambil 7 hari ke belakang, mulai dari
-- tiga hari lalu. Berhenti sendiri setelah 30 hari kosong berturut-turut
-- (artinya data Minerva sudah habis). Setelah selesai, jadwal ini tidak
-- lagi memanggil apa pun, jadi tidak perlu dicabut.
-- =====================================================================

select cron.schedule('op-isi-data-lama', '*/3 * * * *', $$ select public.op_panggil_sync('mundur') $$);

-- ---------------------------------------------------------------------
-- Memantau (jalankan kapan saja):
--
--   select value from public.op_state where key = 'mundur';
--     kursor          tanggal yang akan diambil berikutnya
--     tertua_berisi   tanggal paling lama yang ternyata ada datanya
--     selesai         true bila sudah tuntas
--     dilewati        tanggal yang gagal 3 kali dan dilompati
--     macet           terisi bila 30 hari terbaru kosong semua
--
--   select ran_at, status, rows_saved, message
--   from public.op_sync_log where mode = 'mundur' order by id desc limit 10;
--
-- Mengulang dari awal (mis. setelah perbaikan):
--   delete from public.op_state where key = 'mundur';
-- ---------------------------------------------------------------------
