# Dashboard Produksi (Data 1on1) · salinan kode Supabase

**Hanya salinan.** Tidak ada yang di-deploy dari folder ini, sama seperti `worker/`
dan `supabase/operator-performance/`. Kode yang benar-benar berjalan ada di project
Supabase MiningMalut. Kalau salah satunya diubah di Supabase, perbarui juga salinannya di sini.

| Berkas | Dijalankan di | Isi |
|---|---|---|
| `01_tabel_dan_keamanan.sql` | SQL Editor | tabel `oe_1on1` (isian per bulan), RLS: baca semua pengguna login, tulis admin; bucket privat `oe-1on1` untuk template Excel |
| `02_dasbor.sql` | SQL Editor | tabel `oe_dasbor`: setelan dashboard (kuota tahunan, acuan OPEX; tulis admin) dan snapshot hasil hitung per bulan (`snap\|YYYY-MM`; tulis semua pengguna login) |
| `oe-minerva/index.ts` | Edge Functions → `oe-minerva` → Code | penerus laporan FMS excavator/truck per hari dan daftar tongkang Minerva. Versi 2 menyimpan laporan yang sudah lewat dua hari di `oe-1on1/minerva/<jenis>/<tanggal>.xlsx` |

Urutan pasang pertama kali:

1. Jalankan `01_tabel_dan_keamanan.sql` di SQL Editor (aman dijalankan ulang).
2. Jalankan `02_dasbor.sql` di SQL Editor (aman dijalankan ulang).
3. Deploy Edge Function `oe-minerva` dari `oe-minerva/index.ts` ("Verify JWT" biarkan menyala).
4. Unggah `data-1on1.html` dan `index.html` ke GitHub dalam satu commit.
5. Buka MiningMalut → Mine Production → Dashboard Produksi → tab **Template** (admin) → unggah `oe1on1_template_v1.xlsx`.
6. Tab **Dashboard** → bagian Tahun berjalan → isi kuota produksi tahun ini sekali (atau tab Rencana → Setelan Dashboard Produksi).

Pembaruan dari versi sebelum Dashboard Produksi: cukup langkah 2, 3 (ganti isi kode lalu Deploy), 4, dan 6.

Butuh `public.op_is_admin()` dari Operator Performance dan Secret `MINERVA_TOKEN` yang sudah ada.
Tidak ada rahasia di folder ini. Angka kuota dan rencana tidak ditulis di repo; diisi admin di halaman.

Folder `minerva/` di bucket `oe-1on1` hanya simpanan laporan Minerva: boleh dihapus kapan saja,
akan diisi ulang saat dibutuhkan (sekitar 60–80 KB per laporan per hari).

Template Excel (`oe1on1_template_v1.xlsx`) dan skrip pembuatnya **tidak** disimpan di repo karena
repo publik dan keduanya memuat nilai kontrak. Template tersimpan di bucket privat `oe-1on1`.

Penjelasan lengkap: dokumentasi §25 (Data 1on1) dan §27 (Dashboard Produksi).
