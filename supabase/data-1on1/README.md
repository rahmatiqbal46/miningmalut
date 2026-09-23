# Data 1on1 · salinan kode Supabase

**Hanya salinan.** Tidak ada yang di-deploy dari folder ini, sama seperti `worker/`
dan `supabase/operator-performance/`. Kode yang benar-benar berjalan ada di project
Supabase MiningMalut. Kalau salah satunya diubah di Supabase, perbarui juga salinannya di sini.

| Berkas | Dijalankan di | Isi |
|---|---|---|
| `01_tabel_dan_keamanan.sql` | SQL Editor | tabel `oe_1on1` (isian per bulan), RLS: baca semua pengguna login, tulis admin; bucket privat `oe-1on1` untuk template Excel |
| `oe-minerva/index.ts` | Edge Functions → Deploy a new function → Via Editor, nama `oe-minerva` | penerus laporan FMS excavator/truck per hari dan daftar tongkang Minerva |

Urutan pasang pertama kali:

1. Jalankan `01_tabel_dan_keamanan.sql` di SQL Editor (aman dijalankan ulang).
2. Deploy Edge Function `oe-minerva` dari `oe-minerva/index.ts` ("Verify JWT" biarkan menyala).
3. Unggah `data-1on1.html` dan `index.html` ke GitHub dalam satu commit.
4. Buka MiningMalut → Mine Production → Data 1on1 → tab **Template** (admin) → unggah `oe1on1_template_v1.xlsx`.

Butuh `public.op_is_admin()` dari Operator Performance dan Secret `MINERVA_TOKEN` yang sudah ada.
Tidak ada rahasia di folder ini.

Template Excel (`oe1on1_template_v1.xlsx`) dan skrip pembuatnya **tidak** disimpan di repo karena
repo publik dan keduanya memuat nilai kontrak. Template tersimpan di bucket privat `oe-1on1`.

Penjelasan lengkap: dokumentasi §25.
