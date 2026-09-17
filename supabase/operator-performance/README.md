# Operator Performance · salinan kode Supabase

**Hanya salinan.** Tidak ada yang di-deploy dari folder ini, sama seperti `worker/`.
Kode yang benar-benar berjalan ada di project Supabase MiningMalut.

| Berkas | Dijalankan di | Isi |
|---|---|---|
| `01_tabel_dan_keamanan.sql` | SQL Editor | tabel `op_*`, RLS, `op_simpan_hari`, `op_set_foto`, bucket `op-foto` |
| `02_fungsi_hitung.sql` | SQL Editor | aturan data sah, `op_agregat`, `op_halaman`, `op_hall_of_fame`, `op_detail`, `op_ekspor` |
| `03_jadwal.sql` | SQL Editor | Vault `op_sync_secret`, `op_panggil_sync`, jadwal 07:00 dan 19:00 WIT |
| `04_mulai_isi_data_lama.sql` | SQL Editor | jadwal pengisian data lama tiap 3 menit |
| `sync-minerva/index.ts` | Edge Functions → editor dasbor | pengambil scorecard Minerva |

Semua SQL aman dijalankan ulang. Kalau salah satunya diubah di Supabase,
perbarui juga salinannya di sini. Penjelasan lengkap: dokumentasi §22.

Tidak ada rahasia di folder ini. Token Minerva ada di Secret Edge Function,
kata sandi penjadwal di Vault. Kunci anon di `03_jadwal.sql` sama dengan
yang sudah tersaji di `index.html`.
