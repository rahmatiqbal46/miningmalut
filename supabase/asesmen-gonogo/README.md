# Asesmen Go/No-Go · salinan kode Supabase

**Hanya salinan**, sama seperti `supabase/operator-performance/` dan `worker/`.
Yang benar-benar berjalan ada di project Supabase MiningMalut. Kalau salah satunya
diubah di Supabase, perbarui juga salinannya di sini.

| Berkas | Dijalankan di | Isi |
|---|---|---|
| `01_tabel_dan_keamanan.sql` | SQL Editor | tabel `gng_*`, RLS tanpa policy, bucket privat `gng-foto` |
| `02_fungsi.sql` | SQL Editor | semua fungsi: masuk NPP/PIN, form, persetujuan, dashboard, ekspor, Kelola |
| `03_data_awal.sql` | SQL Editor | 27 pertanyaan, 203 operator (EVA), 18 pengawas (Pola Kerja), 119 unit, 31 lokasi, 2 admin |
| `gng-foto/index.ts` | Edge Functions → editor dasbor | unggah & lihat foto evidence untuk sesi NPP |

NPP boleh format apa pun; pencocokan lewat `gng__npp()` (tanpa spasi/tanda baca, huruf besar, tanpa nol di depan).

Urutan pertama kali: 01 → 02 → 03, lalu Edge Function. Semua SQL aman dijalankan
ulang; 03 tidak menimpa perubahan yang dibuat admin lewat tab Kelola.

Tidak ada rahasia di folder ini. Edge Function memakai `SUPABASE_URL` dan
`SUPABASE_SERVICE_ROLE_KEY` yang sudah tersedia otomatis.

## Siapa memakai apa

| Pengguna | Masuk dengan | Akun Supabase? | Bisa |
|---|---|---|---|
| Operator | NPP saja | Tidak | `cek-aman.html`: Beranda, Isi Form |
| Pengawas | NPP + PIN (awal = NPP; bisa diganti sendiri, admin bisa mengatur ulang) | Tidak | `cek-aman.html`: Beranda, Persetujuan |
| Mining | email + sandi (seperti sekarang) | Ya | `asesmen.html`: dashboard, arsip, unduh |
| Admin | email + sandi, email ada di `app_admin` (Mining Bureau → Kelola Admin, lihat `supabase/admin/`) | Ya | + tab Kelola |

Operator dan pengawas sengaja **tidak** dibuatkan akun Supabase: tabel modul lain
(`dashboard`, `op_*`) terbuka untuk semua pengguna `authenticated`.
