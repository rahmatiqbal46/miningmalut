# Gudang data site — Digital Twin (23 September 2026)

Salinan SQL untuk gudang data site MiningMalut. **Tidak di-deploy dari sini**: jalankan
`01_gudang_data_site.sql` sekali di Supabase → SQL Editor. Aman dijalankan ulang.

Isinya:

- tabel `site_versi`, `site_aktif`, `site_log` (RLS menyala tanpa policy — semua akses lewat fungsi);
- fungsi `site_is_admin`, `site_saya`, `site_manifest`, `site_cap`, `site_data`, `site_riwayat`,
  `site_penyimpanan`, `site_jalan_worker` (satu-satunya yang boleh tanpa login, untuk Worker),
  `site_terbit`, `site_pulihkan`, `site_hapus_berkas`, dan pemeriksa `site__cek_jalan_worker`;
- bucket privat `site-data` beserta policy Storage (baca: semua yang login; tulis: admin).

Admin data site = `op_is_admin()` atau email di tabel `gng_admin`. Tidak ada daftar admin baru.

Cek sesudah dijalankan:

```sql
select public.site_cap();                                        -- '' sebelum disemai
select id, public from storage.buckets where id = 'site-data';   -- public = false
```

Lalu buka Digital Twin sebagai admin → **Semai sekarang**. Uraian lengkap: dokumentasi §26.
