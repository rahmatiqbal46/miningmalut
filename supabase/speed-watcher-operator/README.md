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
3. **Uji sekali** di SQL Editor:
   ```sql
   select public.swo_panggil();
   ```
   Tunggu ±15 detik, lalu:
   ```sql
   select pada, ok, unit_ditanya, unit_dijawab, login_baru, kejadian_baru, ms, pesan
     from public.swo_putaran order by pada desc limit 1;
   ```
   Yang diharapkan: `ok = true`, `unit_dijawab` sekitar 45, `pesan` kosong.
   - `ok = false` dan `pesan` menyebut "saluran" → saluran login Minerva tidak
     terjangkau dari Supabase. **Berhenti di sini** dan kabari Claude.
   - Tidak ada baris sama sekali → lihat jawaban Edge Function:
     `select status_code, content::text from net._http_response order by created desc limit 1;`
4. **SQL Editor** → tempel isi `02_jadwal.sql` → **Run**. Sejak itu pencatat
   berjalan tiap menit.
5. Halaman `speed-watcher.html` di GitHub. Sebelum langkah 1–4 selesai, halaman
   diam: tidak ada baris operator, tidak ada pesan galat.

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
