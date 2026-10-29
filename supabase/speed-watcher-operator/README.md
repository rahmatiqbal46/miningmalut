# Speed Watcher · operator pelanggar · salinan kode Supabase

**Hanya salinan.** Tidak ada yang di-deploy dari folder ini, sama seperti `worker/`.
Kode yang benar-benar berjalan ada di project Supabase MiningMalut. Penjelasan
lengkap: Dokumentasi Pengembangan §34.

| Berkas | Dijalankan di | Isi |
|---|---|---|
| `01_tabel_dan_fungsi.sql` | SQL Editor | tabel `swo_*`, aturan pencocokan `swo__nilai`, penyimpan `swo_simpan_putaran`, bacaan halaman, koreksi admin |
| `sw-operator/index.ts` | Edge Functions → editor dasbor | pencatat tiap menit: saluran login Minerva + kejadian baru dari Worker |
| `02_jadwal.sql` | SQL Editor | `swo_panggil()` dan jadwal pg_cron tiap menit |

Semua SQL aman dijalankan ulang. Kalau salah satunya diubah di Supabase,
perbarui juga salinannya di sini.

Tidak ada rahasia baru. Edge Function memakai secret yang sudah ada untuk
Operator Performance dan Data 1on1 (`SYNC_SECRET`, `MINERVA_TOKEN`); secret
Edge Function berlaku untuk semua function di project. Kunci anon di
`02_jadwal.sql` sama dengan yang sudah tersaji di `index.html`.

## Cara pasang (semua lewat dasbor Supabase di browser)

1. **SQL Editor** → tempel isi `01_tabel_dan_fungsi.sql` → **Run**.
   Cek: `select public.swo__kunci('DTH_05');` → `DTH5`.
2. **Edge Functions → Deploy a new function → Via Editor**, nama **`sw-operator`**,
   tempel isi `sw-operator/index.ts`, **Deploy**. "Verify JWT" dibiarkan menyala.
   Buka **Edge Functions → Secrets** dan pastikan `SYNC_SECRET` dan
   `MINERVA_TOKEN` ada (keduanya sudah dibuat untuk Operator Performance).
3. **SQL Editor** → tempel isi `02_jadwal.sql` → **Run** (hasilnya satu angka:
   nomor jadwal). Berkas ini membuat `swo_panggil()` dan langsung menjadwalkannya
   tiap menit.
4. **Periksa** 2–3 menit kemudian:
   ```sql
   select pada, ok, unit_ditanya, unit_dijawab, login_baru, kejadian_baru, ms, pesan
     from public.swo_putaran order by pada desc limit 5;
   ```
   Yang diharapkan: satu baris per menit, `ok = true`, `unit_dijawab` sekitar 45,
   `pesan` kosong (NULL). Putaran pertama juga mengisi `login_baru` dan
   `kejadian_baru` (semua kejadian hari ini dan kemarin).
   - `ok = false` dan `pesan` menyebut "saluran" → saluran login Minerva tidak
     terjangkau dari Supabase. Hentikan dengan
     `select cron.unschedule('swo-rekam-tiap-menit');` dan kabari Claude.
   - `pesan` menyebut "daftar operator Minerva" → nama diambil dari cadangan
     `op_operators`; pencatat tetap jalan. Kabari Claude.
   - Tidak ada baris sama sekali → lihat jawaban Edge Function:
     `select status_code, content::text from net._http_response order by created desc limit 3;`
5. Halaman `speed-watcher.html` di GitHub. Sebelum langkah 1, halaman diam: tidak
   ada baris operator, tidak ada pesan galat. Sesudah langkah 1 tetapi sebelum
   putaran pertama berhasil, tab Kejadian menulis "Pencatat operator belum
   berjalan".

Terpasang 29 Oktober 2026: putaran pertama 15.59 WIT, 45 dari 45 unit menjawab,
45 kejadian hari ini dan kemarin dicocokkan, `pesan` kosong (saluran terjangkau
dari Supabase, daftar Minerva menerima token).

Uji manual kapan saja (sesudah langkah 3): `select public.swo_panggil();`

## Pemantauan

```sql
-- sepuluh putaran terakhir
select pada, ok, unit_dijawab, login_baru, kejadian_baru, ms, pesan
  from public.swo_putaran order by pada desc limit 10;

-- operator kejadian hari ini
select id, unit, mulai, badge, public.swo__nama(badge) nama, label, final, alasan
  from public.swo_kejadian where tanggal = (now() at time zone 'Asia/Jayapura')::date
  order by mulai desc;
```

Di halaman Speed Watcher, tab Kejadian menulis "Pencatat operator terhenti sejak
…" bila putaran terakhir yang berhasil lebih dari 5 menit lalu.

Menghentikan sementara: `select cron.unschedule('swo-rekam-tiap-menit');`
Menyalakan lagi: jalankan ulang `02_jadwal.sql`.
