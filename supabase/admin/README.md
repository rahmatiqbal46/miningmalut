# Admin terpadu MiningMalut

Satu daftar admin untuk semua modul: tabel `public.app_admin`, dikelola dari
**Mining Bureau → Kelola Admin** (`admin.html`). Tidak ada lagi daftar email yang
ditulis di HTML, SQL, atau Edge Function.

| Yang memeriksa admin | Cara |
|---|---|
| `index.html` (menu Kelola Admin, label Admin/Viewer) | RPC `op_is_admin` |
| `operator-performance.html` (tab Foto) | RPC `op_is_admin` |
| `data-1on1.html` | RPC `op_is_admin` (tidak berubah) |
| Policy Storage & tabel (`op-foto`, `oe_1on1`, `oe-1on1`, snapshot) | `op_is_admin()` |
| Asesmen Go/No-Go | `gng_is_admin()` → `op_is_admin()` |
| Digital Twin / gudang data site | `site_is_admin()` → `op_is_admin()` |
| Edge Function `sync-minerva` | membaca `app_admin` dengan service role |

`gng_admin` kini **VIEW** di atas `app_admin`, supaya fungsi Asesmen lama tetap jalan.

## Fungsi

- `admin_daftar()` — daftar admin, status akun Supabase (ada/belum, login terakhir), 50 riwayat terakhir. Khusus admin.
- `admin_tambah(p_email, p_paksa default false)` — email tanpa akun Supabase mengembalikan `{perlu_konfirmasi:true}` kecuali `p_paksa`.
- `admin_hapus(p_email)` — tidak bisa menghapus diri sendiri, jadi daftar tidak pernah kosong.
- Semua perubahan tercatat di `app_admin_log`.

## Pasang

1. SQL Editor: jalankan `01_admin_terpadu.sql` (aman diulang). Isi awal: tiga admin lama + isi `gng_admin` lama.
2. Edge Functions → `sync-minerva`: tempel `../operator-performance/sync-minerva/index.ts`, Deploy.
3. GitHub: `index.html`, `admin.html`, `operator-performance.html`, `asesmen.html`, folder `supabase/`.

Pemasangan baru dari nol: jalankan berkas ini **sebelum** SQL Operator Performance, Data 1on1, Digital Twin, dan Asesmen.
