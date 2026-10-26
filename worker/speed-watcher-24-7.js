// =============================================================================
// Speed Watcher 24/7 — Cloudflare Worker
// Versi 16.2 (26 Oktober 2026)
//
// Perubahan dari versi 1:
//  - Batas 40 → 35 km/jam, sama dengan batas umum Pulau Pakal di halaman.
//  - Deteksi tidak lagi percaya satu pembacaan. Sebuah pelanggaran baru dibuka
//    setelah DUA sampel sah berturut-turut melewati batas, dengan perataan
//    median tiga sampel — aturan yang sama persis dengan speed-watcher.html.
//    Tanpa ini, satu pembacaan GPS rusak sudah cukup menuduh orang.
//  - Pembacaan divalidasi: koordinat masuk akal, satelit cukup, tidak ada
//    loncatan posisi, tidak ada kecepatan mustahil. Yang gagal dibuang dan
//    dihitung, bukan dicatat sebagai pelanggaran.
//  - Waktu pelanggaran memakai waktu pesan GPS, bukan waktu server. Pesan yang
//    sama tidak diproses dua kali, jadi unit dengan posisi membeku tidak lagi
//    memperpanjang pelanggaran terus-menerus.
//  - Kejadian ditutup rapi setelah kecepatan turun, dan durasinya bisa dipakai.
//  - Data lebih tua dari 120 hari dibuang sekali sehari.
//  - /api/pelanggaran menerima rentang tanggal (dari & sampai) untuk ekspor.
//  - Satu baris tulis per putaran, bukan tiga: state, cek terakhir, dan jumlah
//    unit digabung.
//
// Versi 4 memperbaiki pelanggaran batas CPU (10 ms per pemanggilan di paket
// gratis). Cloudflare menghentikan Worker di tengah jalan saat batas terlampaui,
// jadi ini bukan soal biaya — sebagian pemeriksaan tidak selesai dan pelanggaran
// bisa lolos. Dua penyebabnya:
//
//  1. `siapkanTabel()` berjalan pada SETIAP permintaan, termasuk 8.640 panggilan
//     /api/unit per hari dari satu tab yang terbuka. Isinya dua CREATE TABLE plus
//     tiga ALTER TABLE yang SELALU gagal karena kolomnya sudah ada — tiga
//     pengecualian dilempar dan ditangkap, setiap kali, tanpa guna. Sekarang
//     berjalan sekali per isolate dan kolom yang kurang diperiksa lewat
//     PRAGMA table_info, bukan dengan mencoba lalu gagal.
//  2. Cron menjalankan 6 putaran dalam SATU pemanggilan, dan CPU keenamnya
//     dijumlahkan ke satu anggaran 10 ms. Tiap putaran membaca lalu menulis
//     ulang seluruh state (±25 KB JSON, 45 unit) — 12 operasi D1 dan 12 kali
//     parse/stringify per menit. Sekarang state dibaca sekali di awal, disimpan
//     di memori selama enam putaran, lalu ditulis sekali di akhir.
//
// Nomor sesi Wialon juga disimpan di memori isolate, jadi tidak dibaca ulang
// dari D1 tiap permintaan.
//
// Versi 5 memindahkan BATAS KECEPATAN PER RUAS ke sini. Sebelumnya server
// memakai satu angka datar 35 km/jam dan halaman punya aturan berlapis yang
// kebetulan setara karena tidak satu ruas pun diisi angkanya. Sekarang tiap ruas
// punya batasnya sendiri, jadi kesetaraan itu putus dan pencocokan ruas harus
// dikerjakan di server — persis yang diperingatkan di §10.2 dokumentasi.
// Konsekuensinya geometri jalan ikut tinggal di sini.
//
// Batas TIDAK bisa diubah dari dashboard. Ia ketentuan tetap yang perlu kajian
// untuk diubah, jadi tempatnya di kode, bukan di panel Setelan. Halaman
// menariknya lewat /api/batas supaya angka di layar selalu ikut server.
//
// Versi 6 memperbaiki KUOTA BACA D1. Pada 16 September 2026 akun melewati batas
// paket gratis 5 juta baris terbaca per hari, dan D1 menolak semua pembacaan
// sampai 00.00 UTC. Yang mahal bukan jumlah pelanggarannya, melainkan cara
// membacanya: tabel `pelanggaran` tidak punya indeks, jadi setiap kueri memindai
// SELURUH tabel — dan D1 menagih tiap baris yang dipindai, bukan yang dikirim.
//
//  1. /api/ringkas menjalankan TIGA pemindaian penuh per panggilan, dan dipanggil
//     tiap 60 detik oleh setiap tab dashboard yang terbuka — juga saat halaman
//     Home tidak sedang dilihat, bahkan di layar login.
//  2. /api/pelanggaran?tanggal= memindai seluruh tabel tiap 60 detik untuk setiap
//     Speed Watcher yang pernah dibuka, termasuk iframe yang sudah ditinggalkan.
//  3. Biaya tiap panggilan tumbuh bersama tabel. Tanpa perubahan apa pun, tagihan
//     harian naik sendiri setiap hari sampai umur simpan 120 hari tercapai.
//
// Perbaikannya:
//  - Dua indeks, (tanggal, mulai) dan (mulai). Diperiksa lewat sqlite_schema
//    sekali per isolate dan hanya dibuat bila belum ada — membangun indeks
//    menulis satu baris per baris tabel, jadi tidak boleh diulang tiap permintaan.
//  - /api/ringkas memakai SATU kueri, dan hasilnya dibagi bersama lewat baris
//    `kv` selama 55 detik. Berapa pun tab yang membuka Home, D1 menghitung
//    ringkasan paling banyak sekali per menit.
//  - /api/pelanggaran menerima ?sejak=<id>&buka=<id,…>. Halaman cukup menarik
//    baris baru dan baris yang masih berjalan, bukan seluruh hari tiap menit.
//  - Galat saat membaca state TIDAK lagi dianggap state kosong. Versi 5 menelan
//    galat itu, lalu cron berjalan tanpa ingatan dan bisa menimpa state tersimpan
//    — kejadian yang sedang terbuka kehilangan pemiliknya dan tidak pernah
//    ditutup. Sekarang putaran menit itu dilewati utuh.
//  - Kejadian yatim (masih berjalan tapi tidak diperbarui lebih dari satu jam)
//    ditutup sekali sehari bersama pembersihan data lama.
//
// Versi 6b (18 September 2026) — TIDAK pernah dicatat di kepala berkas ini,
// dan itu menimbulkan kerusakan tersendiri. /api/ringkas menerima ?dari=&sampai=
// untuk tombol Kemarin / Last 7 Days di kartu Home, simpanan ringkasan dikunci
// per jendela (bukan satu baris `kv` yang diperebutkan dua jendela), dan
// /api/isi-nama ditambahkan. Salinan di GitHub tidak ikut diperbarui, sehingga
// pada 21 September 2026 perbaikan CPU dibangun di atas salinan usang dan
// sempat memundurkan fitur filter periode saat dipasang.
//
// > ATURAN: berkas di Cloudflare adalah sumber kebenaran. Sesudah setiap deploy,
// > salin isinya ke worker/speed-watcher-24-7.js di GitHub, dan NAIKKAN nomor
// > versi di baris ketiga berkas ini. Nomor versi yang tidak bergerak membuat
// > salinan usang tampak mutakhir.
//
// Versi 7 memperbaiki BATAS CPU lagi — 21 September 2026, 1.000+ pelampauan
// dalam 24 jam, 8,3% pemanggilan gagal, dan seluruhnya bertipe "Exceeded CPU
// Time Limits". Errornya rata ±14 per 15 menit sementara jumlah pemanggilan
// naik-turun antara 100 dan 260: laju tetap seperti itu hanya mungkin datang
// dari cron, bukan dari permintaan halaman.
//
// Yang DIUKUR lebih dulu, supaya perbaikannya tidak menebak. Jalur panas
// direplikasi di Node dengan armada 45 unit, 6 putaran, state ±25 KB:
//
//    seluruh hitungan JS enam putaran ........ ±1,6 ms
//    parsing jawaban Wialon 6× (33 KB) ....... ±1,0 ms
//    ------------------------------------------------
//    total kerja hitung ...................... ±2,6 ms dari anggaran 10 ms
//
// Jadi pencocokan ruas BUKAN penyebabnya: indeks grid 55 m dari versi 5 bekerja
// (589 sel, rata-rata 4,3 penggal per sel). Sisanya habis di operasi I/O yang
// keenam putarannya ditagih ke SATU anggaran — dan yang paling banyak di situ
// adalah penulisan D1.
//
//  1. Selama sebuah unit melanggar, barisnya DITULIS ULANG ke D1 pada setiap
//     putaran — 6 kali per menit per unit. Sekarang penulisan dikumpulkan lalu
//     dikirim SEKALI di akhir pemanggilan, dalam satu `batch` D1. Diuji atas
//     deret pembacaan yang sama dengan versi sebelumnya: isi tabel akhir
//     identik baris demi baris, operasi D1 turun dari 15,4 jadi 5,6 per menit,
//     dan panggilan D1 terpisah dari 123 jadi 22.
//  2. `ambilUnit()` mencocokkan ruas untuk SETIAP unit pada setiap panggilan —
//     termasuk enam panggilan cron per menit, yang sudah punya pencocokan
//     sendiri di jalur deteksi dan sengaja dilewati untuk unit di bawah
//     BATAS_MIN. Penjaga anggaran versi 5 itu jadi percuma. Sekarang cron
//     memanggil `ambilUnit(env, false)`; hanya /api/unit yang butuh kolom ruas.
//  3. Enam baris log per pemanggilan digabung jadi SATU. Angka `sah` per putaran
//     tetap tercatat — justru itu yang dipakai menilai apakah enam kali tanya
//     per menit masih sepadan — tapi peristiwa observability turun dari ±8.640
//     jadi ±1.440 per hari.
//
// > Pelajaran umum, sama dengan §21.6: pekerjaan yang benar tapi diulang pada
// > tiap putaran menghabiskan anggaran yang tidak kelihatan di kode.
//
// Versi 8 MEMBAGI MENIT KE TIGA PEMICU (§21.11). v7 menghapus error CPU selama
// 3,5 jam setelah dipasang, lalu error kembali tiap menit — saat dua tab Speed
// Watcher terbuka dan front mulai bergerak. Enam putaran di SATU pemanggilan
// memang tidak punya ruang: sedikit tambahan kerja saja sudah melewati 10 ms.
//
// Menurunkan jumlah cek (3 kali per menit) atau membayar Workers Paid sama-sama
// ditolak: yang dibagi adalah JATAH CPU-nya, bukan jumlah cek-nya.
//
//  1. Tiga pemicu cron, masing-masing menjalankan satu BLOK berisi dua putaran:
//       */1 * * * *   → blok A, detik 0 dan 10
//       * * * * *     → blok B, detik 20 dan 30
//       0-59 * * * *  → blok C, detik 40 dan 50
//     Ketiganya berarti "tiap menit"; tulisannya dibedakan supaya Cloudflare
//     menyimpannya sebagai tiga pemicu. Paket gratis mengizinkan 5 pemicu per
//     akun, dan tiap pemanggilan punya jatah 10 ms sendiri. Jadwal cek tidak
//     berubah sedikit pun: enam kali per menit, jeda 10 detik, aturan sama.
//  2. Tiap blok diklaim ATOMIK di D1 sebelum dijalankan (INSERT … ON CONFLICT
//     … WHERE), jadi satu blok tidak pernah dijalankan dua kali.
//  3. Blok A adalah jangkar: sesudah bloknya sendiri ia mencoba mengklaim blok B
//     dan C. Pemilik yang hadir sudah mengklaim sejak detik 0, jadi percobaan A
//     gagal dan tidak terjadi apa-apa. Pemilik yang tidak muncul — pemicunya
//     belum ditambahkan, ditolak, atau sesekali tidak berjalan — bloknya
//     diambil alih A. Cek TIDAK PERNAH berkurang diam-diam; paling buruk A
//     kembali memikul enam putaran seperti v7.
//  4. Sesi Wialon dibagi lewat kv. Bila sebuah panggilan ditolak, nomor sesi
//     terbaru dibaca dulu dari kv — mungkin bagian lain Worker baru saja login —
//     dan login ulang hanya dilakukan bila memang belum ada yang lebih baru.
//     Tanpa ini, isolate yang berbeda bisa saling membuat sesi lawannya basi
//     (§6.5), dan tiap putaran membayar tiga panggilan Wialon tambahan.
//  5. Batas tunggu 5 detik per panggilan Wialon, supaya satu jawaban yang
//     menggantung tidak menahan sebuah blok melewati giliran blok berikutnya.
//  6. Cron tidak lagi menjalankan siapkanTabel(): tabel sudah ada, dan
//     pemeriksaan skema itu memakan tiga panggilan D1 pada setiap isolate baru.
//     Jalur HTTP selain /api/unit dan /api/batas tetap menjalankannya.
//
// Versi 8.1 — blok dibagikan menurut URUTAN KEDATANGAN, bukan tulisan cron.
// v8 memetakan tulisan ekspresi cron ke blok (`*/1 * * * *` → A, dst.). Dua
// puluh menit sesudah dua pemicu ditambahkan, blok B dan C masih dijalankan A:
// tulisan yang sampai ke Worker tidak sama dengan yang dipetakan, atau pemicunya
// tidak berjalan sama sekali — dari luar keduanya tampak sama. Sekarang setiap
// pemanggilan mengklaim blok kosong pertama dengan urutan A → B → C, jadi
// tulisan cron-nya tidak lagi berpengaruh apa pun. Tulisan itu tetap dicatat
// dan ditampilkan /api/status (`pemicu`), supaya bisa dibaca dari luar.
//
// Versi 9 — JALAN DAN BATAS KECEPATAN DARI GUDANG DATA SITE (23 September 2026).
// Batas kecepatan kini bisa diubah admin dari Digital Twin (Kelola data → Jalan
// & batas kecepatan). Keputusan ini mengubah catatan versi 5 ("batas hanya bisa
// diubah lewat kode"): yang berwenang tetap admin yang sama, perubahan tercatat
// sebagai versi di Supabase, dan setiap versi bisa dipulihkan.
//
//  1. Geometri ruas, batas per ruas, batas di luar ruas, dan toleransi dibaca dari
//     fungsi Supabase `site_jalan_worker` (tanpa login; isinya sama dengan yang
//     sudah terbuka di /api/batas). Pemeriksaan dilakukan blok A pada menit
//     kelipatan lima — tanpa pemicu cron baru. Bila versi yang dipegang masih
//     aktif, jawabannya hanya {versi, sama:true}, jadi hampir tidak ada data.
//  2. Versi baru DIPERIKSA dulu (batas 5–80 km/jam, toleransi 5–60 m, nama ruas
//     huruf/angka, koordinat di wilayah Pulau Pakal, tiap ruas ≥ 2 titik, paling
//     banyak 20.000 titik dan 15.000 sel indeks grid — jaringan sekarang ±2.500,
//     ±6.300 dengan toleransi 60 m; membangun 15.000 sel ±11 ms di isolate dingin).
//     Yang tidak sah ditolak dan Worker tetap memakai versi terakhir yang sah.
//     Gudang tidak terjangkau atau belum disemai → tetap RUAS_BAWAAN di bawah,
//     sama persis dengan versi 8.1. Aturan yang sama dipakai Supabase
//     (site__cek_jalan_worker) dan Digital Twin sebelum terbit.
//  3. Versi yang dipakai disimpan di baris `kv` 'jalan' (isi) dan 'jalan:versi'
//     (nomor), dan nomornya ikut di state (`jv`). Blok B/C membaca state setiap
//     menit, jadi langsung tahu bila versi berganti; SEMUA jalur HTTP memeriksa
//     nomor versi paling sering sekali per lima menit per isolate. Nomor versi
//     di state tidak pernah ditimpa 0: isolate yang gagal memuat kv tidak bisa
//     menyeret isolate lain kembali ke RUAS_BAWAAN.
//     Pelebaran sel indeks grid mengikuti toleransi, jadi toleransi di atas 23 m
//     tetap berlaku penuh.
//  4. JEJAK GPS untuk putar ulang shift dan saran jalan di Digital Twin: tiap
//     blok menulis satu baris `kv` 'jejak:<menit>:<blok>' berisi posisi baru
//     tiap unit (±1–3 KB), dalam batch yang sama dengan state — tidak ada
//     panggilan D1 tambahan. Disimpan 3 hari, dibersihkan bersama data lama.
//  5. Alamat baru: /api/jalan (jalan + batas yang sedang dipakai, untuk halaman
//     Speed Watcher) dan /api/jejak?dari=&sampai= (maks. 3 jam sekali minta).
//     /api/status dan /api/batas menyebut versi jalan yang dipakai.
//  6. Penangan /api/isi-nama yang tertulis dua kali dirapikan menjadi satu.
//
// Versi 9.1 — BATAS SHIFT 06.30 DAN 18.30 WIT (24 September 2026).
// Jendela "shift berjalan" di /api/ringkas (dan ?shift=DS/NS) kini mengikuti
// pergantian shift sebenarnya di site: siang 06.30–18.30, malam 18.30–06.30,
// sama dengan label shift di Home, Digital Twin, dan proxy /api/minerva.
// Sebelumnya 07.00/19.00 — itu hanya jadwal sinkronisasi Operator Performance,
// bukan batas shift. Deteksi, perekaman, jejak, dan /api/ringkas?dari=&sampai=
// tidak berubah.
//
// Versi 10 — BIAYA ISOLATE DINGIN (19 Oktober 2026). Batas CPU jebol lagi:
// 1.000+ kali per hari, 10 e-mail di bulan Oktober, ±2 error per menit saat
// front aktif. Dengan dua pemicu, blok C (dipikul A) tidak tersimpan 67 menit
// berturut-turut, dan blok B ikut mati saat beban penuh — padahal B hanya
// mengerjakan dua putaran.
//
// Yang DIUKUR lebih dulu (Node, isolate baru tiap pemanggilan, armada 45 unit):
// pekerjaan sekali-per-isolate di jalur cron menghabiskan sebagian besar jatah,
// dan biayanya ikut tumbuh bersama kerapatan titik jalan dari Digital Twin:
//
//                              493 titik    1.444 titik    2.842 titik
//    bangunGrid() .............  1,3 ms       3,1 ms         4,8 ms
//    periksaJalan() dari kv ....  0,5 ms       0,8 ms         1,8 ms
//    JSON.parse jalan ..........  0,1 ms       0,3 ms         0,6 ms
//
// Cloudflare sering menjalankan cron di isolate baru, jadi biaya itu dibayar
// hampir di setiap pemanggilan — bukan sekali seumur Worker seperti dugaan v5.
//
//  1. Indeks grid sel 55 m diganti INDEKS POTONGAN dua tingkat: kotak batas per
//     ruas, lalu per potongan 8 penggal, keduanya dilebarkan toleransi dan
//     disimpan di typed array. Membangunnya satu lintasan atas titik tanpa Map
//     dan tanpa kunci teks (2.842 titik: 4,8 → 0,46 ms); mencari = memeriksa
//     kotak lalu mengukur jarak penggal di kotak yang kena. Hasil cariRuas()
//     IDENTIK dengan grid: himpunan penggal dalam toleransi sama, urutan
//     pemeriksaan sama (ruas lalu penggal), aturan batas terendah sama. Diuji
//     pada 1.080.000 titik acak di 36 kombinasi jalan/toleransi/batas: 0 beda.
//  2. Jalan yang dimuat dari baris kv 'jalan' tidak diperiksa ulang. Baris itu
//     hanya ditulis Worker ini sendiri SESUDAH periksaJalan() lolos (blok A,
//     periksaGudangJalan). Pemeriksaan penuh tetap berlaku untuk isi dari
//     gudang Supabase. MAKS_SEL tetap dihitung, karena aturannya harus sama
//     dengan Supabase dan Digital Twin.
//  3. /api/unit — dipanggil tiap 10 detik oleh tiap tab — dijawab JSON ringkas,
//     bukan berindentasi. /api/status tetap berindentasi untuk dibaca manusia.
//  4. Log klaim menyebut isolate=baru|lama, supaya seberapa sering cron jatuh
//     ke isolate dingin bisa dibaca di Workers Logs, bukan ditebak.
//
// Aturan deteksi, jadwal enam cek per menit, klaim blok, jejak, dan seluruh
// alamat API tidak berubah: pada simulasi 25 menit dengan 1, 2, dan 3 pemicu,
// isolate dingin dan hangat, tabel pelanggaran, state, dan jejak identik byte
// demi byte dengan versi 9.1. CPU rata-rata per pemanggilan (Node, isolate
// dingin, tiga pemicu): jalan 493 titik 6,1–7,2 → 5,2–5,5 ms; 2.842 titik
// 17,4–19,6 → 5,3–5,9 ms.
//
// WAJIB bersama versi ini: pemicu cron KETIGA. Dengan dua pemicu, blok A masih
// memikul blok C sendirian dan pemanggilannya dua kali lebih berat.
//
// Versi 11 — PEMBACAAN GPS DARI UNIT YANG DIAM (23 Oktober 2026, §21.15).
// 9RD26 sedang stand by/breakdown, tapi tercatat empat kali melanggar pada
// 22–23 Oktober: 145, 101, 39, dan 34 km/jam. Jejak GPS-nya menunjukkan unit
// itu parkir di ujung RD_SubaimBawah sepanjang waktu. Dua pola GPS rusak:
//
//  1. Posisi ngawur 6–7 km di luar site (utara Pulau Pakal) dengan kecepatan
//     TETAP 145 atau 101 km/jam, posisinya tidak bergeser satu meter pun selama
//     ±5 menit. Loncatan itu sempat ditolak — tetapi pembandingnya sampel sah
//     terakhir, jadi jarak yang "boleh" ditempuh ikut tumbuh bersama waktu.
//     Setelah ±3 menit, 7 km tampak terjangkau di bawah 150 km/jam dan
//     pembacaannya diterima; sesudah itu tidak ada aturan yang menolak
//     "145 km/jam tapi posisinya diam".
//  2. Posisi unit yang parkir "melayang" 75–500 m lalu kembali dalam 1–2 menit
//     dengan kecepatan acak. Contoh: diam 0 km/jam, sembilan detik kemudian
//     sudah 209 m jauhnya dengan 62 km/jam — mustahil bagi dump truck yang
//     berangkat dari diam.
//
// Empat aturan baru di sampelSah(), semuanya untuk pembacaan yang tidak mungkin
// datang dari unit yang benar-benar bergerak. Yang ditolak dicatat per alasan
// di baris log tiap blok (`alasan=wilayah:4,diam:2,…`).
//
//  - wilayah: posisi di luar kotak WILAYAH (Pulau Pakal ± 2–3 km — kotak yang
//    sama dengan pemeriksaan jalan) dibuang. Batas kecepatan site tidak berlaku
//    di luar site, dan posisi seperti itu tidak boleh menjadi pembanding.
//  - diam: kecepatan ≥ 15 km/jam, jeda ≤ 20 dtk, tetapi perpindahannya (+10 m
//    galat GPS) lebih pendek dari jarak yang PASTI sudah ditempuh untuk sampai
//    di kecepatan itu — walau unitnya baru berangkat dari diam dengan percepatan
//    2 m/s²: v²/2a, mis. 17 m untuk 30 km/jam, 180 m untuk 101 km/jam dalam
//    10 dtk. Dinilai terhadap sampel sah sebelumnya DAN terhadap pesan tepat
//    sebelumnya bila pesan itu ditolak: pembanding sah bisa sudah berumur
//    menit-menit, sedangkan pesan ngawur yang membeku datang berderet tiap
//    10 detik. Tanpa yang kedua, deret 145 km/jam beku lolos sekali-sekali.
//    (Versi pertama aturan ini memakai "kurang dari ¼ kecepatan × jeda" dan
//    salah menolak truk yang baru berangkat di tengah jeda 16–20 detik;
//    ketahuan pada simulasi armada.)
//  - arah: kecepatan ≥ 15 km/jam, jeda ≤ 20 dtk, pindah ≥ 20 m, tetapi arah GPS
//    berselisih lebih dari 150° dengan arah perpindahan sebenarnya — arahnya
//    terbalik. Pembacaan 9RD26 pukul 06.17.24: 166°. Manuver tertajam di data
//    nyata 20–22 Oktober: 89° (DTH_40 berbelok 131° dalam 13 detik di RD_EFO);
//    di simulasi, kait 139° di ujung RD_Harmoni yang dilalui 27 km/jam: 131°.
//  - tempuh: perpindahan lebih jauh dari yang mungkin ditempuh dari kecepatan
//    sebelumnya dengan percepatan 2 m/s², pengereman 4 m/s², dan puncak
//    72 km/jam (lebih tinggi bila kecepatan lapornya lebih tinggi), ditambah
//    30 m galat GPS. Kecepatan sebelumnya diambil yang lebih besar antara
//    kecepatan lapor dan kecepatan hitung (jarak ÷ waktu), supaya satu
//    pembacaan 0 di tengah perjalanan tidak memperketat batasnya.
//  Aturan tempuh hanya dipakai untuk jeda ≤ 60 detik. Angkanya batas fisik
//  alat berat, bukan setelan: armada yang dipantau hanya dump truck dan
//  excavator (§6.6), dan dump truck nyata berakselerasi ±0,5–1,5 m/s².
//
// Aturan buka/tutup kejadian, median, batas per ruas, jadwal cek, klaim blok,
// jejak, dan seluruh alamat API TIDAK berubah. Jejak tetap mencatat semua posisi,
// termasuk yang ditolak, supaya putar ulang Digital Twin menampilkan data mentah.
//
// Versi 12 — ADMIN BISA MENGHAPUS KEJADIAN (23 Oktober 2026, §21.16).
// Permintaan Iqbal sesudah kasus 9RD26: kejadian yang terbukti salah harus bisa
// dihapus dari dashboard, tanpa SQL. Tiga alamat baru, semuanya khusus admin:
//
//   POST /api/hapus     {id, alasan}  kejadian dipindah ke arsip terhapus
//   GET  /api/terhapus  ?tanggal= atau ?dari=&sampai=   daftar arsip terhapus
//   POST /api/pulihkan  {id}          kejadian dikembalikan dengan id yang sama
//
//  - Admin = daftar yang sama dengan seluruh MiningMalut (tabel app_admin,
//    Mining Bureau → Kelola Admin). Halaman mengirim token login Supabase di
//    header Authorization; Worker menanyakan RPC op_is_admin ke Supabase dengan
//    token itu. Token palsu, kedaluwarsa, atau bukan admin ditolak Supabase,
//    jadi Worker tidak perlu menyimpan rahasia apa pun. Email penghapus dibaca
//    dari isi token SESUDAH Supabase menerimanya.
//  - Bukan dihapus permanen: baris dipindah utuh (JSON) ke tabel
//    pelanggaran_dihapus bersama siapa, kapan, dan alasannya, lalu dihapus dari
//    `pelanggaran`. Karena itu semua pembaca lama — tab Kejadian, Home, Unduh
//    Excel — otomatis tidak melihatnya tanpa satu pun kueri diubah. Tabel arsip
//    dibuat saat pertama dipakai, bukan di siapkanTabel(), supaya jalur yang
//    ramai tidak menanggung kueri tambahan.
//  - Kejadian yang masih berjalan tidak bisa dihapus: barisnya masih dipegang
//    state cron dan akan diperbarui terus.
//  - Simpanan ringkasan Home (baris kv 'ringkas:*') dibuang setiap hapus dan
//    pulihkan. Kartu Home menyesuaikan dalam ±1 menit untuk shift berjalan;
//    rentang tanggal yang sudah lewat bisa tertahan di memori isolate lain
//    paling lama 10 menit (RINGKAS_TUTUP).
//  - id tidak pernah dipakai ulang (AUTOINCREMENT), jadi pemulihan aman memakai
//    id lama.
//
// Deteksi, jadwal cek, jejak, dan alamat lama TIDAK berubah dari versi 11.
//
// Versi 13 — MESIN MATI (23 Oktober 2026, §21.17).
// Usulan Ariq (Dispatch, pembuat Speed Watcher V.2): pembacaan dari unit yang
// mesinnya mati (ignition/engine off) tidak sah. Unit yang stand by atau
// breakdown seperti 9RD26 tidak mungkin melaju, jadi kecepatan yang dilaporkan
// GPS-nya — termasuk "melayang" yang geraknya mulus dan lolos aturan gerak v11 —
// bukan pelanggaran.
//
//  - Sumber: sensor jenis "engine operation" (sensor kunci kontak) di Wialon.
//    Blok A memetakannya sedikit demi sedikit: 4 unit per menit lewat
//    core/search_item flag 4097 (nama + sensor), unit baru lebih dulu, lalu
//    diperiksa ulang sekali sehari. Hasilnya di baris kv 'mesin'. Nilainya dibaca
//    dari pesan terakhir (lmsg) yang SUDAH ikut di jawaban flag 1024 tiap
//    putaran, jadi tidak ada panggilan Wialon tambahan per putaran.
//  - Yang dipakai hanya parameter tunggal (io_239, ign, acc, …) atau bit masukan
//    digital (in1, …), lengkap dengan tabel kalkulasi dan batas bawah/atas
//    sensornya. Parameter berupa rumus dilewati. Unit tanpa sensor mesin tetap
//    dinilai seperti versi 12.
//  - Aturan: bacaan yang LOLOS semua aturan gerak, ≥ 15 km/jam, dengan sensor
//    mesin melapor mati → ditolak, alasan `mesin`.
//  - Pengaman sensor macet: bila satu unit mengumpulkan 30 bacaan bergerak wajar
//    dengan mesin "mati" dalam sejam (±5 menit berjalan), sensornya dianggap
//    macet dan diabaikan 3 hari, supaya pelanggaran sungguhan unit itu tidak
//    terus hilang. Harganya: ±5 menit berjalan pertama unit itu tidak dinilai
//    sekali per 3 hari. Dicatat di log dan di /api/mesin.
//  - /api/unit mengirim `mesin` (true/false/null) supaya halaman menolak bacaan
//    yang sama; /api/mesin baru merinci peta sensor dan nilainya per unit;
//    /api/status mendapat ringkasan `mesin`.
//
// Aturan gerak v11, deteksi, jadwal cek, jejak, hapus/pulihkan v12, dan alamat
// lama TIDAK berubah.
//
// Versi 14 — SATU KEJADIAN, SATU BARIS (24 Oktober 2026, butir 69).
// Satu kejadian kadang tersimpan dua baris dengan unit dan `mulai` yang sama
// (pasangan yang diketahui: 90/91, 144/145, 146/147, 157/158, 1474/1475), jadi
// kartu Home, Unduh Excel, dan tab Kejadian menghitungnya dua kali.
//
// Penyebabnya DIREPRODUKSI di simulator Node (D1 tiruan di atas SQLite, Wialon
// tiruan, jam virtual, isolate baru tiap pemanggilan), bukan ditebak. INSERT
// pembuka langsung tersimpan, sedangkan state yang mencatat "kejadian ini sudah
// dibuka" baru disimpan di akhir pemanggilan. Bila di antaranya ada yang putus,
// pemanggilan berikutnya membaca state lama — sampel pertama yang melewati batas
// sudah ada di sana — lalu membuka kejadian yang sama sekali lagi, dengan waktu
// mulai yang persis sama. Hasil simulasi 30 menit, 45 unit, tiga pemicu:
//
//    pemanggilan dihentikan sesudah INSERT (batas CPU) ..... 17 pasangan ganda
//    batch akhir ditolak D1 sesudah INSERT ................. 13
//    pemicu pertama baru menyala sesudah detik 20, pemicu
//      kedua menyusul sebelum blok A menyimpan state ........  5
//    satu putaran tersendat (sesi Wialon basi, jawaban
//      lambat) sampai menit berikutnya mulai ................  5
//    /api/uji dipanggil saat cron berjalan ..................  5
//    /api/reconnect di tengah blok; jalan normal ............  0
//
// Dua yang pertama adalah pola September–Oktober (batas CPU jebol sampai versi
// 10). Tiga berikutnya adalah dua pemanggilan yang bekerja di atas state yang
// sama: keduanya memproses pesan yang sama, jadi waktu mulainya sama dan nomor
// barisnya berurutan — persis pasangan yang ditemukan. Pembersihan kejadian
// yatim harian hanya menutup baris, tidak pernah membuat baris.
//
// Perbaikannya:
//  1. Membuka kejadian kini IDEMPOTEN: INSERT … WHERE NOT EXISTS (unit_id dan
//     mulai sama), satu batch dengan pembacaan nomor barisnya. D1 menjalankan
//     pernyataan satu per satu, jadi dua pemanggilan yang berbarengan pun tidak
//     bisa sama-sama menulis. Bila barisnya sudah ada, baris itu yang dipakai
//     dan diperbarui terus. Kecepatan tertinggi (dengan posisinya) diambil yang
//     terbesar, karena baris lama bisa memuat sampel sah yang tidak terlihat
//     pemanggilan ini; jumlah sampel, rata-rata, dan waktu selesai tetap milik
//     state yang berjalan (sampel yang sama tidak boleh terhitung dua kali).
//     Tidak bergantung pada indeks unik di bawah, jadi Worker tetap merekam
//     dengan cara yang sama walau indeks itu belum ada atau gagal dibuat.
//  2. Pembaruan dan penutupan baris memakai kunci (unit_id, mulai), bukan nomor
//     baris. Baris yang tersisa sesudah pembersihan tetap diperbarui walau state
//     atau pemanggilan yang sedang berjalan masih memegang nomor salinannya.
//  3. Kejadian di state yang belum punya nomor baris — INSERT pembukanya ditolak
//     atau jawabannya hilang — dibuka ulang pada sampel berikutnya, juga saat
//     ditutup aturan 15 menit (nama unit ikut dicatat di kejadian saat dibuka,
//     untuk unit yang keburu hilang dari daftar Wialon). Dulu kejadian itu tidak
//     pernah diperbarui lagi (simulasi: 10 dari 40 membeku) atau tidak tercatat
//     sama sekali (10 dari 40 hilang). Galat pembukaan juga tidak lagi
//     menghentikan putaran untuk unit-unit sesudahnya.
//  4. Pembersihan sekali jalan, otomatis, di jalur HTTP (bukan di putaran cron):
//     permintaan pertama sebuah isolate yang melihat indeks unik belum ada
//     memindahkan salinan ganda ke arsip terhapus — mekanisme hapus admin versi
//     12, dihapus_oleh "sistem", alasan "Catatan ganda · sama dengan kejadian
//     #n" — lalu membuat indeks unik idx_pelanggaran_unit_mulai, dalam SATU
//     transaksi. Yang disimpan adalah baris paling lengkap: sampel terbanyak,
//     lalu selesai paling akhir, lalu yang sudah ditutup. Bila baris itu sudah
//     ditutup (atau lebih dari sejam diam), kecepatan tertinggi seluruh salinan
//     digabung ke dalamnya dan nilai sebelumnya disimpan, jadi bisa dibalik
//     persis; baris yang masih berjalan dibiarkan untuk cron. Pindai ganda satu
//     lintasan atas tabel. Hasilnya di baris kv 'ganda' — dihitung dari isi
//     arsip, bukan dari rencana isolate yang kebetulan menulis terakhir — dan di
//     /api/status (`ganda`). Gagal → dicoba lagi dengan jeda berlipat 5, 10, 20
//     menit … paling lama 24 jam, karena tiap percobaan membaca seluruh tabel dua
//     kali; percobaan tiap 5 menit selamanya bisa menghabiskan kuota baca harian.
//     Indeks yang tidak bisa dibuat tidak menahan pemindahan.
//  5. /api/pulihkan menolak salinan ganda dengan 409 yang menyebut baris yang
//     tersimpan, bukan galat. Arsip hanya dihapus bila barisnya benar kembali.
//
// Deteksi, jadwal cek, klaim blok, jejak, mesin, dan alamat lama TIDAK berubah.
// Diuji di simulator yang sama — 30 menit, 45 unit, 1/2/3 pemicu, isolate dingin
// dan hangat, jalan 493 dan 2.842 titik, data unit terputus, pembersihan harian
// 00.00 WIT: tabel pelanggaran, state, jejak, dan peta mesin IDENTIK dengan
// versi 13, sampai nomor barisnya; state hanya bertambah nama unit di kejadian
// yang masih terbuka. Pada skenario yang membuat ganda di versi 13,
// versi 14 menyimpan tepat satu baris per kejadian, sama dengan baris yang
// dipegang state versi 13 (satu kejadian puncaknya naik karena digabung dari
// salinan beku). CPU per pemanggilan cron (Node, isolate dingin, tiga pemicu,
// 14–16 pasang proses berselang-seling, dua putaran ukur): ±6,5–6,9 ms tanpa JIT
// dan ±6,9–7,2 ms dengan JIT di KEDUA versi; selisih berpasangan −0,1…+0,3 ms
// dengan sebaran ±2 ms, jadi di dalam derau ukur (isolate hangat ±2,3–2,6 ms).
// Membuka satu kejadian memakan ±20–30 µs CPU di isolate dingin (versi 13:
// ±16 µs), ±5 µs bila sudah hangat; dengan beberapa pembukaan per pemanggilan
// selisihnya di bawah 0,05 ms.
// Permintaan HTTP yang menjalankan pembersihan ±2,5 ms (biasanya ±1,7).
//
// Sesudah deploy: buka /api/status → `ganda.indeks` true dan `ganda.dipindah`
// = jumlah salinan yang dipindah (rinciannya di `ganda.rincian`, nilai baris
// yang digabung sebelum diubah di `ganda.sebelum`).
//
// Yang TIDAK ditangani versi ini: kejadian yang terbelah dua baris dengan waktu
// mulai BERBEDA. Terjadi bila pemanggilan terhenti sesudah membuka kejadian yang
// sampel pertamanya juga baru dilihat pemanggilan itu (simulasi: 2 dari 19
// pemanggilan yang dihentikan), atau saat dua pemanggilan memakai state yang sama
// tapi melihat pesan yang berbeda. Salinan pertamanya baris "berjalan" yang beku
// dan ditutup pembersihan yatim harian; ia tidak bisa dikenali dari kuncinya.
//
// Versi 15 — RUAS TERDEKAT, PEMBAGIAN BLOK, DAN SISA TEMUAN VERSI 14
// (24 Oktober 2026, keputusan Iqbal hari yang sama; §17 butir 36 dan 78–80).
//
//  1. Di persimpangan yang berlaku RUAS TERDEKAT, bukan lagi batas terendah.
//     Penggal yang paling dekat dengan posisi unit menentukan ruas dan batasnya;
//     dua jarak yang berselisih ≤ 1e-6 m dianggap seri, lalu batas terendah, lalu
//     nama ruas. Aturan lama selalu memilih angka terkecil, jadi aturan baru hanya
//     bisa MENAIKKAN batas di simpang, tidak pernah menurunkannya. Simulasi armada
//     di jalan bawaan (12.442 pembacaan > 15 km/jam): nama ruas berubah pada 5,0%,
//     batasnya pada 1,5% — mis. RD_Harmoni 30 → RD_Kasuari 35, RD_EFO 15 → RD_Alur1
//     25 di simpangnya. speed-watcher.html (ruasBerlaku) dan putar ulang Digital
//     Twin (cariRuasLokal) memakai aturan yang sama: identik dengan Worker pada
//     300.000 titik, sepertiganya tepat di simpul. cariRuas() identik dengan
//     pemeriksaan seluruh penggal pada 1.000.000 titik di 24 kombinasi jalan (asli,
//     rapat 10 m, rapat 4 m) × toleransi (5/20/37/60 m) × batas (asli, acak).
//     Biayanya tanpa JIT +1–4 µs per panggilan, karena potongan yang kotaknya
//     sudah lebih jauh dari penggal terdekat dilewati. Halaman juga tidak lagi
//     memotong batas ruas dengan batas umum, sama dengan server sejak versi 5.
//
//  2. PEMBAGIAN BLOK (butir 36). Pemicu kedua dan ketiga datang di detik ±21 dan
//     ±23 (§21.14), sesudah A mengklaim B dan C di batch akhir bloknya (detik ±11),
//     jadi satu pemanggilan selalu memikul keenam putaran. Sekarang A mencoba
//     mengklaim B di detik 18 dan C di detik 38, satu per satu. Dengan jeda pemicu
//     produksi, A memikul A+B dan pemicu kedua mendapat C; pemicu yang datang
//     sebelum detik 18 mendapat B. Jadwal cek tidak berubah: B tetap mulai di detik
//     20 dan C di detik 40, siapa pun pemiliknya. Pemanggilan terberat turun dari
//     enam putaran ke empat (simulasi tanpa JIT, isolate dingin, p90 per
//     pemanggilan, beberapa putaran ukur: jalan 493 titik 13,1–14,0 → 10,4–10,8
//     ms; 2.612 titik 17,1–19,1 → 14,1–16,1 ms).
//     State kini disimpan di akhir SETIAP blok, karena blok berikutnya bisa milik
//     pemanggilan lain.
//
//  3. BLOK MENUNGGU SIMPANAN BLOK SEBELUMNYA (butir 78). Bila blok sebelumnya (A
//     sebelum B, B sebelum C, C menit lalu sebelum A) sudah diklaim tetapi belum
//     menyimpan, blok ini menunggu — kueri kecil tiap 0,75 detik — paling lama
//     sampai 6 detik sesudah awal jendelanya, lalu berjalan dengan state yang ada
//     seperti versi 14. Blok yang batch-nya ditolak D1 menandai klaimnya (`g`),
//     jadi penunggunya tidak menunggu sia-sia. Klaim dibaca dalam batch yang sama
//     dengan state: pada jalan normal tidak ada tunggu dan tidak ada panggilan D1
//     tambahan. Lama tunggu dicatat di baris log blok (`tunggu=4.6s:tersimpan`).
//
//  4. /api/uji KERING (butir 80): dinilai dari state cron, tidak ada yang ditulis.
//
//  5. KEJADIAN TERBELAH (butir 79), dua lapis:
//     a. Pembukaan kejadian meneruskan baris unit yang sama dengan batas yang sama
//        yang tertinggal berjalan dan berakhir ≤ 25 detik sebelumnya (atau
//        sesudahnya), bukan membuat baris kedua — kecuali state ini sendiri melihat
//        unit itu melambat di antaranya, atau baris itu baru saja ia tutup sendiri
//        di blok ini (satu sampel jatuh di ruas berbatas lain; lihat
//        bukaPelanggaran).
//     b. Sekali sehari di jalur HTTP, baris unit dan batas yang sama yang rentang
//        waktunya bertumpang digabung ke satu baris; sisanya dipindah ke arsip
//        terhapus (sistem, "Catatan terbelah · bagian dari kejadian #n"). Baris
//        berurutan tanpa tumpang tindih tidak disentuh. Hasilnya di kv 'belah' dan
//        /api/status (`belah`). /api/pulihkan menolak baris yang rentang waktunya
//        bertumpang dengan baris lain unit itu berbatas sama (409), seperti
//        salinan ganda versi 14.
//
//  6. Dari tinjauan terpisah (24 Oktober 2026): penutupan yang masih tertunda di
//     blok yang sama tidak pernah diteruskan (5a); batch akhir blok yang ditolak
//     dicoba sekali lagi sesudah 0,5 detik, dan blok yang dilewati karena state
//     tidak terbaca ikut menandai `g`; pembersihan terbelah membuat tabel arsip
//     lebih dulu dan mencatat galatnya tanpa tabel itu (jeda sejam tetap
//     tersimpan), mengurutkan pasangan per unit dan menunda unit yang terpotong
//     batas 300 pasangan, membaca `berikut` tanpa mengurai baris kv-nya, dan
//     menyimpan `sebelum` paling banyak 200 nilai (90 hari).
//
// Diuji di simulator v14 (D1 tiruan di atas SQLite, Wialon dan Supabase tiruan,
// jam virtual, isolate baru tiap pemanggilan):
//  - Jalan normal, enam susunan pemicu (jeda produksi, serentak, 1 dan 2 pemicu,
//    dingin dan hangat), 20 menit, 45 unit: tabel pelanggaran, state, dan jejak
//    IDENTIK byte demi byte dengan versi 14 yang diberi aturan ruas terdekat.
//    Butir 2–6 tidak mengubah apa pun pada jalan normal. Simpang RD_Harmoni
//    dengan satu sampel di ujung RD_Atom atau di luar jalan: dua baris, sama
//    dengan versi 14, di semua letak sampel dan susunan pemicu.
//  - Gangguan, 30 menit (versi 14 → 15; pasangan bertumpang / baris beku yang
//    disusul baris baru / baris tertinggal berjalan · kejadian tidak tercatat):
//      Wialon lambat 14 dtk di putaran kedua A ....... 12/3/13·15 → 0/0/0·7
//      /api/uji tiap ±37 dtk ........................ 1/0/0·0 → 0/0/0·0
//      batch akhir blok ditolak D1 (1 dari 5) ....... 0/8/16·10 → 0/0/0·2
//      pemanggilan mati sesudah membuka kejadian .... 1/1/7·88 → 1/0/2·75
//    Baris tertinggal yang tersisa adalah kejadian tunggal yang penutupannya
//    hilang bersama pemanggilannya; ditutup pembersihan kejadian yatim harian.
//  - Pembersihan terbelah atas tabel buatan versi 14 (12 pasangan): 12 baris
//    dipindah, 0 tersisa, baris lain tidak berubah; diulang dan dijalankan dua
//    isolate berbarengan: tidak ada perubahan tambahan.
//  - CPU per pemanggilan satu blok (tanpa JIT, isolate dingin, median): jalan 493
//    titik 5,18 → 5,53 ms; 2.612 titik 8,83 → 9,26 ms — hampir seluruhnya aturan
//    ruas terdekat.
//
// Sesudah deploy: /api/status → `versi_worker: 15`; `blok.C.oleh` "C" (pemicu
// kedua mengambil C), `blok.B.oleh` biasanya "A", jadi `terbagi` tetap false
// selama pemicu datang terlambat — bukan kerusakan. `belah.diperiksa` terisi
// sesudah permintaan HTTP pertama; `belah.dipindah` = baris terbelah lama.
//
// Versi 16 — JALAN BARU DIPAKAI SEKETIKA (26 Oktober 2026).
// Batas yang diterbitkan admin di Digital Twin pukul 09.10 WIT baru tampil di
// Speed Watcher belasan menit kemudian. Tiga jeda lima menit bertumpuk: blok A
// hanya bertanya ke gudang di menit kelipatan lima, jalur HTTP membaca nomor
// versi di kv paling sering tiap lima menit per isolate, dan halaman menarik
// /api/jalan tiap lima menit. Ketiganya dipangkas:
//
//  1. /api/jalan/segarkan (GET/POST, tanpa login). Digital Twin memanggilnya
//     sesaat sesudah Terbitkan atau Pulihkan jalan. Worker bertanya ke gudang
//     saat itu juga (isi lengkap, p_versi null), memeriksanya dengan
//     periksaJalan(), memasangnya, lalu menulis kv 'jalan' + 'jalan:versi'. Bila
//     penulisan kv gagal, isolate kembali ke jalan sebelumnya: isolate tidak
//     pernah melayani versi yang tidak tersimpan. Pemanggil hanya bisa membuat
//     Worker menyamakan diri dengan gudang; isi gudang tetap hanya bisa diubah
//     admin. Paling sering sekali per SEGAR_JEDA_MS per isolate. Pemeriksaan
//     blok A di menit kelipatan lima tetap ada sebagai cadangan.
//  2. Blok cron membaca baris kv 'jalan:versi' dalam batch yang sama dengan
//     state (muatSimpananBlok): tanpa perjalanan D1 tambahan, satu baris terbaca
//     lebih per blok. Versi baru dipakai menilai pelanggaran mulai blok berikutnya.
//  3. Jalur HTTP membaca nomor versi di kv paling sering tiap 30 detik (dulu
//     lima menit): satu baris terbaca per isolate per 30 detik.
//  4. Waktu aktif. Kunci jalan kini "versi@aktif" (sejak 16.1 di baris 'jalan:kunci',
//     lihat di bawah), aktif = saat versi itu
//     diaktifkan di gudang (site_aktif.diubah_pada, ms). Nomor versi saja tidak
//     bisa mengurutkan, karena Pulihkan mengaktifkan lagi nomor lama; waktu aktif
//     selalu maju. Baris kv versi 15 ("5") dibaca sebagai aktif 0 (belum
//     diketahui) dan dilengkapi pada pemanggilan /api/jalan/segarkan berikutnya.
//  5. /api/unit membawa `versi_jalan` dan `jalan_aktif`. Halaman yang memang
//     menarik /api/unit tiap 10 detik jadi tahu ada versi baru tanpa permintaan
//     tambahan. /api/jalan menambah `aktif` (cache 60 → 15 detik); /api/batas dan
//     /api/status menambah `jalan_aktif`.
//
// Kejadian yang SEDANG berjalan saat batas berganti tetap terikat pada batas
// ketika ia dibuka (satu baris = satu ruas + satu batas), sampai unitnya melambat
// atau pindah ke batas lain — sama dengan versi 15. Kejadian baru langsung
// dinilai dengan batas baru.
//
// Diuji (D1 tiruan di atas SQLite, Supabase dan Wialon tiruan, jam virtual,
// isolate = konteks vm baru):
//  - HTTP, 29 cek: baris kv versi 15 terbaca; segarkan pertama melengkapi waktu
//    aktif; panggilan kedua < 5 detik tidak bertanya ke gudang; v6 terpasang di
//    isolate pemanggil seketika dan di isolate lain ≤ 30 detik; Pulihkan v5
//    sesudah v6 → semua isolate kembali ke v5 dengan waktu aktif baru; isi tidak
//    sah (batas 200) ditolak tanpa mengubah kv; gudang mati → 502 tanpa perubahan;
//    kv gagal ditulis → 502 dan isolate kembali ke versi sebelumnya; gudang
//    belum disemai → jalan bawaan.
//  - Cron, 13 cek: isolate cron hangat yang memegang v5 memakai v6 mulai blok
//    pertama sesudah segarkan, tanpa bertanya ke gudang; unit 27 km/jam di
//    RD_EFO dibuka dengan batas 25 (v6), kejadian berbatas 20 ditutup; isolate
//    dingin memakai v6 dari kv; tanpa segarkan, blok A menit kelipatan lima
//    tetap menemukan versi baru.
//  - Kesetaraan dengan versi 15 pada jalan normal, 25 menit, tiga unit, isolate
//    dingin dan hangat: tabel pelanggaran dan seluruh 85 baris kv IDENTIK byte
//    demi byte. (Tanpa baris state, versi 15 menilai dengan RUAS_BAWAAN sampai
//    menit kelipatan lima; versi 16 langsung memakai kv.)
//  - CPU /api/jalan/segarkan di isolate dingin (Node tanpa kompilator optimasi):
//    jalan sekarang 31 potong · 506 titik → versi baru ±2 ms (p90 ±4), sama
//    ±1 ms; jalan 4× lebih rapat (1.882 titik) ±6,5 ms (p90 ±10,7). Pekerjaan
//    ini dulu dipikul pemanggilan cron blok A.
//
// Versi 16.1 (26 Oktober 2026, sebelum v16 sempat ditempel) — temuan tinjauan
// terpisah atas v16:
//  a. (sedang) v16 menulis 'jalan:versi' = "6@aktif". Worker yang di-rollback ke
//     v15 membacanya sebagai NaN dan jalur HTTP-nya melayani RUAS_BAWAAN sampai
//     jalan terbit lagi. Sekarang 'jalan:versi' kembali nomor polos, dan
//     "versi@aktif" pindah ke baris baru 'jalan:kunci' (KUERI_KUNCI_JALAN membaca
//     keduanya; bila nomornya tidak sama, 'jalan:versi' yang menang).
//  b. Tulisan jalan ke kv bersyarat waktu aktif (perintahSimpanJalan): batch akhir
//     blok A yang mendarat ±10 detik sesudah bertanya ke gudang tidak lagi bisa
//     menimpa versi lebih baru yang sudah ditulis /api/jalan/segarkan.
//  c. /api/jalan/segarkan hanya POST (GET → 405); gudang ditanya nomornya saja
//     bila waktu aktif di kv sudah diketahui (jawaban {sama:true} yang kecil);
//     periksa → simpan → baru pasang, jadi isolate tidak pernah memegang versi
//     yang belum tersimpan.
//
// Sesudah deploy: /api/status → `versi_worker: 16.1`; POST /api/jalan/segarkan →
// {ok: true, versi, aktif, berubah, hasil}.
//
// Binding yang dibutuhkan: D1 bernama `DB`, secret `WIALON_TOKEN`.
// Opsional: variabel SUPABASE_URL dan SUPABASE_ANON_KEY bila proyek Supabase
// berganti (bawaan: proyek MiningMalut, kunci anon publik yang sama dengan
// index.html).
// Cron (Settings → Triggers): TIGA pemicu yang masing-masing menyala tiap menit,
// tulisannya bebas asal berbeda. Terpasang per 19 Oktober 2026:
//   */1 * * * *  ·  0-59 * * * *  ·  (ketiga, ditambahkan bersama v10) * 0-23 * * *
// Dengan hanya satu pemicu, Worker tetap bekerja penuh (blok A memikul semuanya).
// =============================================================================

const HOST = "https://hst-api.wialon.com";

// ====== BATAS KECEPATAN — ketentuan tetap, ubah hanya lewat kajian ======
//
// Batas untuk posisi yang tidak jatuh di ruas mana pun: area loading, dumping,
// stockpile, workshop. Juga dipakai halaman sebagai batas umum.
const BATAS_LUAR_BAWAAN = 35; // km/jam
let BATAS_LUAR = BATAS_LUAR_BAWAAN;
//
// Batas per ruas ada di dalam RUAS di bawah (kolom `b`). Ringkasannya:
//   15  RD_EFO
//   25  RD_Alur1
//   30  RD_Alur2 · RD_Alur3 · RD_Bicoli · RD_Buli · RD_Harmoni · RD_ParaPara
//       RD_ParaParaBawah · RD_Subaim · RD_SubaimBawah · RD_Triwan · RD_Wayamli
//   35  RD_Atom · RD_Kasuari · RD_Pos2 · RD_Reksol · RD_Sofifi · RD_Sosolat
//       RD_Utara · dan seluruh posisi di luar ruas
// =======================================================================

// Toleransi jarak dari sumbu jalan, meter. Setara `lebarRuas: 40` di halaman.
const TOLERANSI_RUAS_BAWAAN = 20;
let TOLERANSI_RUAS = TOLERANSI_RUAS_BAWAAN;

/* Geometri jalan: 30 polyline, 493 titik, dari Koordinat_Jalan_Mei2026 (EPSG:32652)
   lewat AMORA. `bb` adalah kotak batas [lonMin, latMin, lonMax, latMax] yang
   dipakai sebagai saringan awal supaya perhitungan jarak yang berat dilewati.

   SALINAN KEDUA. Geometri yang sama juga ada di speed-watcher.html untuk
   menggambar peta. Kalau jaringan jalan diperbarui di AMORA, KEDUANYA harus
   di-regen bersama — kalau tidak, server dan layar akan menilai ruas berbeda. */
const RUAS_BAWAAN = [{"n":"RD_EFO","b":15,"bb":[128.325754,0.792975,128.325759,0.793106],"p":[[128.325754,0.793106],[128.325759,0.792975]]},{"n":"RD_EFO","b":15,"bb":[128.324438,0.788403,128.325768,0.792761],"p":[[128.325768,0.792761],[128.3256,0.792506],[128.325383,0.792316],[128.325044,0.791906],[128.324873,0.791655],[128.324709,0.791332],[128.324563,0.791095],[128.324484,0.790937],[128.324442,0.790764],[128.324438,0.790499],[128.324499,0.79037],[128.324492,0.790208],[128.324531,0.790068],[128.324684,0.789802],[128.324759,0.789659],[128.324791,0.789242],[128.324866,0.789023],[128.324963,0.788865],[128.325034,0.788653],[128.325202,0.788449],[128.325275,0.788403]]},{"n":"RD_Alur1","b":25,"bb":[128.325275,0.785006,128.326735,0.788403],"p":[[128.325275,0.788403],[128.325569,0.788223],[128.32624,0.787957],[128.326464,0.787831],[128.326628,0.78763],[128.326735,0.787365],[128.326725,0.78725],[128.326636,0.787052],[128.326547,0.786905],[128.326475,0.786722],[128.326415,0.786481],[128.326318,0.786226],[128.326194,0.786022],[128.32614,0.785867],[128.326072,0.785523],[128.326062,0.7853],[128.326037,0.785164],[128.325987,0.785042],[128.325961,0.785006]]},{"n":"RD_Alur2","b":30,"bb":[128.324443,0.782613,128.325961,0.785006],"p":[[128.325961,0.785006],[128.325919,0.784948],[128.325734,0.78484],[128.325609,0.784801],[128.325498,0.784697],[128.325345,0.784474],[128.325131,0.784302],[128.32497,0.784244],[128.324874,0.784151],[128.324781,0.784011],[128.324617,0.783684],[128.324475,0.783436],[128.324443,0.783264],[128.324503,0.782973],[128.324568,0.782744],[128.324574,0.782613]]},{"n":"RD_Alur3","b":30,"bb":[128.324154,0.779638,128.325385,0.782613],"p":[[128.324574,0.782613],[128.324578,0.782384],[128.324529,0.782234],[128.324457,0.781896],[128.324472,0.781713],[128.324443,0.781394],[128.324293,0.780769],[128.32424,0.780589],[128.32419,0.780388],[128.324158,0.780205],[128.324154,0.780004],[128.324254,0.779803],[128.324472,0.779724],[128.324804,0.779638],[128.325007,0.779652],[128.325224,0.779681],[128.325385,0.779789]]},{"n":"RD_Bicoli","b":30,"bb":[128.325385,0.779789,128.327963,0.783128],"p":[[128.325385,0.779789],[128.325442,0.779914],[128.325453,0.780177],[128.325438,0.78037],[128.325417,0.780543],[128.325445,0.780769],[128.325549,0.780938],[128.325666,0.781027],[128.325852,0.78115],[128.326016,0.781243],[128.326298,0.781351],[128.326579,0.78148],[128.326765,0.781627],[128.326997,0.781846],[128.327268,0.782274],[128.327428,0.7825],[128.327574,0.782758],[128.327774,0.782974],[128.327963,0.783128]]},{"n":"RD_Buli","b":30,"bb":[128.327963,0.783128,128.329325,0.784978],"p":[[128.327963,0.783128],[128.32827,0.783222],[128.328612,0.78339],[128.328812,0.783477],[128.329026,0.783649],[128.329101,0.783832],[128.329108,0.784015],[128.329101,0.784188],[128.329129,0.784389],[128.329176,0.784572],[128.329272,0.784791],[128.329325,0.784978]]},{"n":"RD_Subaim","b":30,"bb":[128.329325,0.784978,128.332471,0.78551],"p":[[128.332471,0.78551],[128.332386,0.785465],[128.331955,0.785324],[128.331613,0.785168],[128.331344,0.785089],[128.331154,0.785065],[128.330928,0.785079],[128.330707,0.785125],[128.330236,0.785173],[128.329832,0.785134],[128.329675,0.785108],[128.329542,0.785065],[128.329325,0.784978]]},{"n":"RD_Atom","b":35,"bb":[128.33859,0.788689,128.3386,0.788692],"p":[[128.3386,0.788692],[128.33859,0.788689]]},{"n":"RD_Atom","b":35,"bb":[128.332471,0.78551,128.342989,0.791159],"p":[[128.332471,0.78551],[128.332819,0.7857],[128.333024,0.78584],[128.333326,0.785982],[128.333751,0.786072],[128.333939,0.786101],[128.334152,0.786193],[128.334622,0.786501],[128.334742,0.786591],[128.334818,0.786679],[128.335378,0.787266],[128.335565,0.787449],[128.335879,0.787685],[128.335982,0.787723],[128.336128,0.787813],[128.336288,0.787983],[128.336432,0.788192],[128.336567,0.788315],[128.336779,0.788411],[128.33711,0.788518],[128.337281,0.788629],[128.33745,0.788765],[128.337636,0.78884],[128.337878,0.788809],[128.338129,0.788748],[128.338255,0.788736],[128.338443,0.788733],[128.338658,0.788669],[128.338877,0.788664],[128.338999,0.788643],[128.339527,0.788499],[128.339624,0.788459],[128.340435,0.788243],[128.340621,0.788135],[128.341019,0.787657],[128.34116,0.787509],[128.341354,0.787366],[128.341436,0.787272],[128.341523,0.787186],[128.341658,0.787103],[128.34181,0.787042],[128.342008,0.787058],[128.34237,0.7871],[128.342522,0.787167],[128.342624,0.787253],[128.342706,0.787479],[128.342748,0.787804],[128.342799,0.788036],[128.342891,0.788193],[128.342925,0.788327],[128.342989,0.788532],[128.342984,0.788708],[128.342923,0.78889],[128.342866,0.788986],[128.342744,0.789162],[128.342645,0.789279],[128.342586,0.789336],[128.34254,0.789446],[128.342481,0.789539],[128.341941,0.79055],[128.341852,0.790692],[128.341781,0.790882],[128.341696,0.791029],[128.341579,0.791159]]},{"n":"RD_Atom","b":35,"bb":[128.331545,0.787216,128.33155,0.787217],"p":[[128.331545,0.787217],[128.33155,0.787216]]},{"n":"RD_Atom","b":35,"bb":[128.332386,0.785465,128.332387,0.785465],"p":[[128.332386,0.785465],[128.332387,0.785465]]},{"n":"RD_Atom","b":35,"bb":[128.328348,0.781783,128.328349,0.781785],"p":[[128.328349,0.781783],[128.328348,0.781785]]},{"n":"RD_Atom","b":35,"bb":[128.330525,0.781088,128.330536,0.781104],"p":[[128.330525,0.781104],[128.330536,0.781088]]},{"n":"RD_Atom","b":35,"bb":[128.331525,0.786869,128.331527,0.78687],"p":[[128.331525,0.786869],[128.331527,0.78687]]},{"n":"RD_ParaPara","b":30,"bb":[128.331186,0.790836,128.336892,0.792943],"p":[[128.331186,0.790836],[128.331288,0.790978],[128.331399,0.791173],[128.331513,0.791298],[128.331718,0.791436],[128.332312,0.791707],[128.332586,0.791865],[128.332847,0.791992],[128.333116,0.792004],[128.333311,0.792061],[128.334243,0.79243],[128.334507,0.792495],[128.334707,0.792562],[128.335192,0.792696],[128.335598,0.792794],[128.336045,0.792861],[128.336416,0.792943],[128.336709,0.792943],[128.336851,0.792852],[128.336892,0.792648],[128.336851,0.792261],[128.336864,0.792117]]},{"n":"RD_ParaPara","b":30,"bb":[128.33686,0.79039,128.337535,0.792117],"p":[[128.337535,0.79039],[128.337486,0.790495],[128.337452,0.791091],[128.33735,0.791361],[128.337241,0.791545],[128.337098,0.791749],[128.336901,0.79196],[128.33686,0.79211],[128.336864,0.792117]]},{"n":"RD_ParaPara","b":30,"bb":[128.337532,0.788689,128.338784,0.79039],"p":[[128.337535,0.79039],[128.337532,0.790202],[128.337611,0.789858],[128.337728,0.789391],[128.337871,0.789305],[128.338124,0.789244],[128.338435,0.789082],[128.33872,0.78891],[128.338784,0.788817],[128.338652,0.788709],[128.33859,0.788689]]},{"n":"RD_SubaimBawah","b":30,"bb":[128.32915,0.784978,128.331618,0.790999],"p":[[128.329325,0.784978],[128.329332,0.785135],[128.329257,0.785451],[128.32919,0.785674],[128.329161,0.7859],[128.32915,0.786141],[128.329179,0.786586],[128.329186,0.786949],[128.329339,0.787243],[128.329468,0.787419],[128.329785,0.787904],[128.330281,0.788496],[128.330616,0.788726],[128.331054,0.78911],[128.331301,0.789419],[128.331618,0.790069],[128.331596,0.79046],[128.331539,0.790669],[128.331436,0.790791],[128.331318,0.790834],[128.331076,0.790837],[128.330698,0.790791],[128.330541,0.79078],[128.32987,0.790783],[128.329863,0.790898],[128.329809,0.790999]]},{"n":"RD_Wayamli","b":30,"bb":[128.325385,0.778241,128.327434,0.781473],"p":[[128.327434,0.781473],[128.327406,0.781279],[128.327327,0.781049],[128.327227,0.780568],[128.32722,0.78031],[128.327106,0.779505],[128.327064,0.779139],[128.327049,0.778306],[128.326928,0.778241],[128.326793,0.778478],[128.326736,0.778636],[128.326629,0.778679],[128.326493,0.778636],[128.326343,0.77855],[128.326058,0.778493],[128.325922,0.778521],[128.325794,0.778701],[128.325751,0.778923],[128.325794,0.779153],[128.325865,0.779433],[128.325908,0.779649],[128.325687,0.779692],[128.325558,0.779692],[128.325466,0.779735],[128.325385,0.779789]]},{"n":"RD_Harmoni","b":30,"bb":[128.326997,0.780799,128.332256,0.78194],"p":[[128.326997,0.781846],[128.327106,0.781652],[128.32722,0.781523],[128.327434,0.781473],[128.328197,0.781746],[128.328611,0.781854],[128.329011,0.78194],[128.329417,0.781868],[128.329731,0.781674],[128.329895,0.781473],[128.330152,0.781251],[128.330423,0.781157],[128.330823,0.780949],[128.331151,0.780863],[128.33175,0.780799],[128.332121,0.780835],[128.332256,0.78105],[128.331935,0.781273]]},{"n":"RD_Kasuari","b":35,"bb":[128.330525,0.778163,128.332414,0.781104],"p":[[128.330525,0.781104],[128.330816,0.780662],[128.330908,0.780246],[128.330894,0.780044],[128.33103,0.779772],[128.331229,0.779585],[128.331479,0.779535],[128.331743,0.779449],[128.332135,0.779312],[128.332257,0.779248],[128.332349,0.779018],[128.332414,0.778738],[128.332114,0.778565],[128.331843,0.778364],[128.33175,0.778163]]},{"n":"RD_Reksol","b":35,"bb":[128.333375,0.784607,128.334694,0.786378],"p":[[128.334694,0.786378],[128.334052,0.78604],[128.333802,0.785878],[128.333636,0.785543],[128.333571,0.78525],[128.333375,0.784753],[128.333388,0.784607],[128.333383,0.784668]]},{"n":"RD_Reksol","b":35,"bb":[128.334694,0.785215,128.341535,0.787427],"p":[[128.334694,0.786378],[128.334908,0.786285],[128.335304,0.786238],[128.335742,0.786112],[128.336028,0.785922],[128.33632,0.785423],[128.336545,0.785276],[128.336827,0.785215],[128.337105,0.785326],[128.337208,0.785492],[128.337262,0.785657],[128.33724,0.785861],[128.337119,0.78608],[128.337069,0.786274],[128.337083,0.786475],[128.33719,0.786741],[128.337251,0.786921],[128.337358,0.787125],[128.337629,0.787326],[128.337993,0.787427],[128.338246,0.787391],[128.338599,0.787283],[128.338884,0.78724],[128.339252,0.787255],[128.340036,0.787427],[128.340322,0.787391],[128.340511,0.787244],[128.340853,0.787054],[128.341345,0.786975],[128.341515,0.78699],[128.34153,0.787007],[128.341535,0.787178],[128.34153,0.787007]]},{"n":"RD_Sofifi","b":35,"bb":[128.330835,0.78551,128.332471,0.789058],"p":[[128.330995,0.789058],[128.330914,0.788912],[128.330835,0.788792],[128.330864,0.788667],[128.331156,0.788294],[128.331251,0.788153],[128.331427,0.787945],[128.33151,0.787806],[128.331544,0.78772],[128.331546,0.787466],[128.331556,0.787296],[128.33153,0.787097],[128.331527,0.78687],[128.331553,0.786494],[128.33166,0.78631],[128.331832,0.786054],[128.332008,0.785862],[128.3323,0.785623],[128.332448,0.785561],[128.332471,0.78551]]},{"n":"RD_Sosolat","b":35,"bb":[128.332387,0.781384,128.335669,0.785465],"p":[[128.332387,0.785465],[128.332684,0.785406],[128.33287,0.785327],[128.333116,0.785137],[128.333266,0.784921],[128.333389,0.784607],[128.333404,0.784448],[128.33328,0.783957],[128.333387,0.783317],[128.333571,0.782946],[128.333791,0.782395],[128.333833,0.782054],[128.334017,0.781659],[128.334195,0.781486],[128.334433,0.781384],[128.33476,0.781414],[128.335004,0.781462],[128.335188,0.781654],[128.335355,0.781965],[128.335533,0.78215],[128.335658,0.782312],[128.335669,0.782629],[128.335592,0.78288]]},{"n":"RD_Pos2","b":35,"bb":[128.335004,0.78008,128.338368,0.782624],"p":[[128.335004,0.781462],[128.335164,0.781348],[128.335301,0.781151],[128.335396,0.780894],[128.335664,0.780511],[128.335878,0.78011],[128.336074,0.78008],[128.336312,0.78017],[128.336603,0.780224],[128.336859,0.780236],[128.337132,0.780326],[128.337186,0.780475],[128.337049,0.780613],[128.336978,0.780828],[128.337049,0.781014],[128.337287,0.781169],[128.337631,0.781235],[128.337857,0.781493],[128.337976,0.781756],[128.33816,0.782127],[128.338368,0.78239],[128.338327,0.782624]]},{"n":"RD_Utara","b":35,"bb":[128.331186,0.78825,128.334673,0.791553],"p":[[128.331186,0.78825],[128.331418,0.788382],[128.332188,0.788698],[128.332805,0.789029],[128.333483,0.789219],[128.333757,0.789223],[128.333996,0.789309],[128.334171,0.789517],[128.33431,0.789772],[128.334378,0.789945],[128.334399,0.790207],[128.334424,0.790372],[128.33442,0.79053],[128.334392,0.790849],[128.334417,0.791072],[128.334499,0.791255],[128.334673,0.791402],[128.334673,0.791553]]},{"n":"RD_ParaParaBawah","b":30,"bb":[128.336864,0.78996,128.339959,0.793245],"p":[[128.336864,0.792117],[128.336986,0.792314],[128.337191,0.792776],[128.337317,0.793034],[128.337426,0.793231],[128.337604,0.793245],[128.337716,0.793082],[128.33784,0.792745],[128.337966,0.79252],[128.338149,0.792448],[128.33838,0.792434],[128.338734,0.792489],[128.339012,0.792448],[128.339164,0.792398],[128.339433,0.792163],[128.339554,0.791993],[128.339259,0.791409],[128.33921,0.791237],[128.339217,0.791069],[128.339298,0.791002],[128.339469,0.790928],[128.339778,0.790828],[128.339916,0.790718],[128.339954,0.790512],[128.339959,0.79034],[128.339898,0.790173],[128.339852,0.790024],[128.339842,0.78996]]},{"n":"RD_Triwan","b":30,"bb":[128.337535,0.788284,128.340798,0.79039],"p":[[128.340287,0.788284],[128.340368,0.788401],[128.340504,0.788568],[128.340615,0.788757],[128.340775,0.788942],[128.340798,0.789054],[128.340713,0.789179],[128.340608,0.789306],[128.340539,0.78942],[128.340432,0.789564],[128.34027,0.789684],[128.340101,0.789837],[128.339754,0.790002],[128.339001,0.790165],[128.338798,0.790174],[128.338534,0.790169],[128.338232,0.790179],[128.337752,0.790231],[128.337576,0.790301],[128.337535,0.79039]]}];

/* RUAS yang sedang dipakai. Mulai dari salinan bawaan di atas, lalu diganti
   versi dari gudang data site bila ada yang sah (versi 9). */
let RUAS = RUAS_BAWAAN;
/* `aktif` (versi 16): saat versi ini diaktifkan di gudang, ms; 0 = belum diketahui. */
let JALAN = { versi: 0, judul: "bawaan Worker (Mei 2026)", dimuat: null, aktif: 0 };

// Gudang data site (Supabase). Kunci anon ini publik — sama dengan index.html.
const SUPA_URL = "https://qblivboqavhlugydhmjr.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFibGl2Ym9xYXZobHVneWRobWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MzMxNjksImV4cCI6MjA5NzIwOTE2OX0.q-rkx2lEONfstic5vlC_-3M1gosvnDd_oMje-2SZvNE";
const JALAN_TIAP_MENIT = 5;     // blok A memeriksa gudang tiap 5 menit (cadangan /api/jalan/segarkan, v16)
const JALAN_HTTP_MS = 30000;    // jalur HTTP memeriksa nomor versi di kv paling sering tiap 30 detik (v16; dulu 5 menit)
const SEGAR_JEDA_MS = 5000;     // /api/jalan/segarkan paling sering sekali per 5 detik per isolate (v16)
let jalanDiperiksa = 0;
let segarTerakhir = 0;

/* Versi 16.1 — versi jalan di dua baris kv:
   - 'jalan:versi' = nomor polos ("6"), PERSIS seperti versi 15. Temuan tinjauan:
     versi 16 sempat menulis "6@aktif" di sini, dan versi 15 membacanya sebagai
     Number("6@…") = NaN — Worker yang di-rollback lalu melayani RUAS_BAWAAN di
     jalur HTTP sampai jalan terbit lagi.
   - 'jalan:kunci' = "versi@aktif", aktif = saat versi itu diaktifkan di gudang
     (site_aktif.diubah_pada, ms). Nomor saja tidak bisa mengurutkan: Pulihkan
     mengaktifkan lagi nomor lama (v5 → v6 → v5); waktu aktif selalu maju, jadi
     halaman bisa menolak jawaban isolate yang belum menyusul.
   Keduanya dibaca sekaligus (KUERI_KUNCI_JALAN). Bila nomornya tidak sama —
   versi 15 sesudah rollback menulis 'jalan:versi' tanpa tahu 'jalan:kunci' —
   'jalan:versi' yang menang, dengan aktif 0 (tidak diketahui). */
/* Versi 16.2: dua pencarian kunci utama yang terpisah, BUKAN `k IN (...)`. Di D1 produksi
   `IN` memindai seluruh tabel kv (±14.900 baris tiap panggilan, terukur 26 Okt 2026),
   sedangkan `k = ?` membaca satu baris. */
const KUERI_KUNCI_JALAN =
  `SELECT k, v FROM kv WHERE k = 'jalan:versi' UNION ALL SELECT k, v FROM kv WHERE k = 'jalan:kunci'`;
function kunciJalan(versi, aktif) {
  return String(Number(versi) || 0) + "@" + String(Math.round(Number(aktif) || 0));
}
function uraiKunciJalan(teks) {
  const [v, a] = String(teks ?? "").split("@");
  return { versi: Number(v) || 0, aktif: Math.round(Number(a) || 0) };
}
/* Baris hasil KUERI_KUNCI_JALAN → {versi, aktif}, atau null bila keduanya tidak ada. */
function kunciDariBaris(baris) {
  let nomor = null, kunci = null;
  for (const r of baris || []) {
    if (r.k === "jalan:versi") nomor = uraiKunciJalan(r.v);       // "6", atau "6@…" tulisan versi 16
    else if (r.k === "jalan:kunci") kunci = uraiKunciJalan(r.v);
  }
  if (kunci && kunci.versi && (!nomor || nomor.versi === kunci.versi)) return kunci;
  if (nomor && nomor.versi) return nomor;
  return null;
}
/* Isolate ini memegang versi yang disebut kunci k (nomor dan waktu aktif sama). */
function jalanSama(k) {
  return k.versi === JALAN.versi && k.aktif === (JALAN.aktif || 0);
}

/* Pemeriksaan isi jalan dari gudang. Mengembalikan pesan galat, atau null.
   Aturannya sama dengan site__cek_jalan_worker di Supabase dan terbitJalan()
   di Digital Twin — ketiganya harus sepakat, supaya versi yang diterima
   Supabase tidak pernah ditolak di sini.
   - Titik harus di wilayah Pulau Pakal (± 2–3 km dari site).
   - Jumlah sel indeks grid dibatasi: penggal yang sangat panjang tanpa titik
     antara, atau jaringan yang jauh lebih besar, membuat bangunGrid() di isolate
     dingin menghabiskan anggaran CPU 10 ms dan blok dihentikan Cloudflare.
     (Sejak versi 10 grid itu diganti indeks potongan, tapi batas MAKS_SEL
     dipertahankan: aturannya dipakai bersama Supabase dan Digital Twin.) */
const WILAYAH = { lonMin: 128.30, lonMaks: 128.38, latMin: 0.75, latMaks: 0.83 };
const MAKS_TITIK = 20000;
const MAKS_SEL = 15000;           // aturan bersama Supabase/Digital Twin (lihat bangunIndeks)
const POLA_NAMA = /^[A-Za-z0-9][A-Za-z0-9 _.()\/+-]{0,39}$/;
function periksaJalan(d) {
  if (!d || typeof d !== "object") return "isi kosong";
  const bl = Number(d.batas_luar);
  if (!(bl >= 5 && bl <= 80)) return "batas di luar ruas";
  const tol = d.toleransi_m == null ? TOLERANSI_RUAS_BAWAAN : Number(d.toleransi_m);
  if (!(tol >= 5 && tol <= 60)) return "toleransi";
  if (!Array.isArray(d.ruas) || !d.ruas.length || d.ruas.length > 400) return "daftar ruas";
  const pad = padSel(tol);
  let titik = 0, sel = 0;
  for (const r of d.ruas) {
    if (!r || typeof r.n !== "string" || !POLA_NAMA.test(r.n.trim())) return "nama ruas";
    const b = Number(r.b);
    if (!(b >= 5 && b <= 80)) return "batas " + r.n;
    if (!Array.isArray(r.p) || r.p.length < 2) return "titik " + r.n;
    titik += r.p.length;
    for (let i = 0; i < r.p.length; i++) {
      const q = r.p[i];
      if (!Array.isArray(q) || typeof q[0] !== "number" || typeof q[1] !== "number" ||
          !(q[0] >= WILAYAH.lonMin && q[0] <= WILAYAH.lonMaks) || !(q[1] >= WILAYAH.latMin && q[1] <= WILAYAH.latMaks)) return "koordinat " + r.n;
      if (i) {
        const a = r.p[i - 1];
        sel += (Math.floor((Math.max(a[0], q[0]) + pad) / SEL) - Math.floor((Math.min(a[0], q[0]) - pad) / SEL) + 1) *
               (Math.floor((Math.max(a[1], q[1]) + pad) / SEL) - Math.floor((Math.min(a[1], q[1]) - pad) / SEL) + 1);
      }
    }
  }
  if (titik > MAKS_TITIK) return "terlalu banyak titik (" + titik + ")";
  if (sel > MAKS_SEL) return "indeks grid terlalu besar (" + sel + " sel)";
  return null;
}

/* Memasang jalan yang sudah diperiksa. Indeks potongan dibangun ulang saat dipakai.
   `aktif` (versi 16) = saat versi ini diaktifkan di gudang, ms (0 = tidak diketahui). */
function pasangJalan(d, versi, judul, aktif) {
  RUAS = d.ruas.map((r) => {
    let bb = r.bb;
    if (!Array.isArray(bb) || bb.length !== 4) {
      bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const q of r.p) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }
    }
    return { n: r.n.trim(), b: Number(r.b), bb, p: r.p };
  });
  BATAS_LUAR = Number(d.batas_luar);
  TOLERANSI_RUAS = d.toleransi_m == null ? TOLERANSI_RUAS_BAWAAN : Number(d.toleransi_m);
  BATAS_MIN = RUAS.reduce((m, r) => Math.min(m, r.b), BATAS_LUAR);
  indeks = null;
  JALAN = { versi, judul: judul || ("jalan v" + versi), dimuat: Date.now(), aktif: Math.round(Number(aktif) || 0) };
}

/* Isi jalan dari baris kv 'jalan' (ditulis blok A atau /api/jalan/segarkan saat
   versi berganti).

   Versi 10: TIDAK diperiksa ulang dengan periksaJalan(). Baris ini hanya ditulis
   sesudah pemeriksaan penuh lolos (siapkanJalan), dan memeriksanya lagi di setiap
   isolate dingin memakan 0,5–1,8 ms dari jatah 10 ms. Yang dicek di sini hanya
   bentuknya, supaya isi yang rusak tidak dipasang. */
async function muatJalanKV(env) {
  const teks = await ambilKV(env, "jalan");
  if (!teks) return false;
  let j = null;
  try { j = JSON.parse(teks); } catch (e) { return false; }
  const d = j && j.data;
  if (!j || !j.versi || !d || !Array.isArray(d.ruas) || !d.ruas.length || !(Number(d.batas_luar) > 0)) return false;
  const aktif = Math.round(Number(j.aktif) || 0);
  if (j.versi !== JALAN.versi || aktif !== (JALAN.aktif || 0)) pasangJalan(j.data, j.versi, j.judul, aktif);
  return true;
}

/* Dipanggil tiap blok cron sesudah state dibaca. Versi 16: patokannya kunci jalan
   di kv yang ikut terbaca bersama state (`s.jk`, KUERI_KUNCI_JALAN), supaya versi
   yang ditulis /api/jalan/segarkan langsung dipakai blok berikutnya. Tanpa baris
   itu (gudang belum pernah terbaca) tetap nomor versi di state, seperti versi 15. */
async function sesuaikanJalan(env, s) {
  const k = s.jk && s.jk.versi ? s.jk : null;
  if (k ? jalanSama(k) : (!s.jv || s.jv === JALAN.versi)) return;
  try { await muatJalanKV(env); }
  catch (e) { console.log(`jalan v${k ? k.versi : s.jv} tidak terbaca dari kv: ${String(e.message || e)}`); }
}

/* Jalur HTTP: kunci jalan di kv dibaca paling sering sekali per JALAN_HTTP_MS. */
async function segarkanJalan(env) {
  const kini = Date.now();
  if (kini - jalanDiperiksa < JALAN_HTTP_MS) return;
  jalanDiperiksa = kini;
  try {
    const k = kunciDariBaris((await env.DB.prepare(KUERI_KUNCI_JALAN).all()).results);
    if (k && !jalanSama(k)) await muatJalanKV(env);
  } catch (e) { /* tetap memakai yang dipegang */ }
}

/* Tanya gudang data site. pVersi = versi yang dipegang (jawabannya cukup
   {versi, sama:true} bila masih aktif), atau null untuk meminta isi lengkap
   beserta waktu aktifnya. Melempar galat berpesan bila gagal. */
async function tanyaGudangJalan(env, pVersi) {
  const url = (env.SUPABASE_URL || SUPA_URL).replace(/\/+$/, "") + "/rest/v1/rpc/site_jalan_worker";
  const key = env.SUPABASE_ANON_KEY || SUPA_KEY;
  const opsi = {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_versi: pVersi || null }),
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") opsi.signal = AbortSignal.timeout(BATAS_TUNGGU_MS);
  let r;
  try { r = await fetch(url, opsi); }
  catch (e) { throw new Error(`gudang jalan tidak terjangkau: ${String(e.message || e)}`); }
  if (!r.ok) throw new Error(`gudang jalan HTTP ${r.status}`);
  return await r.json();
}

/* Versi 16.1 — tiga upsert jalan BERSYARAT waktu aktif (temuan tinjauan): tulisan
   yang lebih tua tidak menimpa yang lebih baru. Contohnya batch akhir blok A, yang
   mendarat ±10 detik sesudah ia bertanya ke gudang — di sela itu admin bisa saja
   menerbitkan versi lain yang langsung ditulis /api/jalan/segarkan. Patokannya
   waktu aktif di baris 'jalan' SEBELUM batch, karena itu baris 'jalan' ditulis
   terakhir; baris tanpa waktu aktif (versi 15) dianggap 0, jadi selalu boleh
   ditimpa. Baris yang belum ada selalu dibuat. */
const AKTIF_TERSIMPAN =
  `coalesce((SELECT CASE WHEN json_valid(v) THEN json_extract(v, '$.aktif') END FROM kv WHERE k = 'jalan'), 0)`;
function perintahSimpanJalan(env, j, aktif, judul) {
  const isi = JSON.stringify({ versi: j.versi, judul, aktif, data: j.data });
  const upsert = (k, v) => env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE ${AKTIF_TERSIMPAN} <= ?`
  ).bind(k, v, aktif);
  return [upsert("jalan:versi", String(j.versi)), upsert("jalan:kunci", kunciJalan(j.versi, aktif)), upsert("jalan", isi)];
}

/* Memeriksa isi jalan dari gudang dan menyiapkan perintah simpannya, TANPA
   memasangnya. Mengembalikan {aktif, judul, perintah} atau {galat}. */
function siapkanJalan(env, j) {
  const galat = periksaJalan(j.data);
  if (galat) return { galat };
  const aktif = Date.parse(j.diubah_pada) || Date.now();
  const judul = j.judul || ("jalan v" + j.versi);
  return { aktif, judul, perintah: perintahSimpanJalan(env, j, aktif, judul) };
}

/* Blok A, menit kelipatan lima: tanya gudang. Versi baru langsung dipasang dan
   dipakai putaran blok ini (seperti versi 15); perintah simpannya ikut batch
   akhir blok. Mengembalikan perintah itu, atau daftar kosong. Sejak versi 16 ini
   cadangan: biasanya versi baru sudah dipasang /api/jalan/segarkan. */
async function periksaGudangJalan(env) {
  let j;
  try { j = await tanyaGudangJalan(env, JALAN.versi); }
  catch (e) { console.log(`${String(e.message || e)}, tetap jalan v${JALAN.versi}`); return []; }
  if (!j || !j.versi || j.sama || j.versi === JALAN.versi) return [];
  const p = siapkanJalan(env, j);
  if (p.galat) { console.log(`jalan v${j.versi} DITOLAK (${p.galat}); tetap jalan v${JALAN.versi}`); return []; }
  pasangJalan(j.data, j.versi, j.judul, p.aktif);
  console.log(`jalan v${j.versi} dipasang: ${RUAS.length} potong, batas luar ${BATAS_LUAR}`);
  return p.perintah;
}

/* Versi 16 — POST /api/jalan/segarkan. Digital Twin memanggilnya sesaat sesudah
   admin menerbitkan atau memulihkan jalan, supaya Worker tidak menunggu
   pemeriksaan menit kelipatan lima. Pembandingnya kunci di kv, bukan isolate ini:
   kv itulah yang dibaca cron dan isolate lain.

   Versi 16.1 (temuan tinjauan):
   - Hanya POST. GET bisa terpicu perayap, pratinjau tautan, atau tag <img>.
   - Bila kv sudah tahu waktu aktifnya, gudang cukup ditanya nomornya: jawabannya
     {sama:true} yang kecil selama tidak ada perubahan. Isi lengkap (p_versi null)
     hanya diminta bila waktu aktif di kv belum diketahui (baris versi 15).
     Pulihkan selalu mengganti nomor yang aktif, jadi "nomor sama" berarti isi sama.
   - Periksa → simpan → BARU pasang. Isolate ini tidak pernah memegang versi yang
     belum tersimpan, dan tidak ada lagi pemulihan keadaan bila penulisan gagal.
     Bila kv ternyata sudah memegang versi yang lebih baru (upsert bersyarat
     dilewati), isolate ini menyusul kv.
   Tanpa login: pemanggil hanya bisa membuat Worker menyamakan diri dengan gudang.
   Tidak memeriksa skema — tabel kv dibuat cron. */
async function segarkanDariGudang(env, req) {
  const jawab = (o, s = 200) =>
    json(Object.assign({ versi: JALAN.versi, judul: JALAN.judul, aktif: JALAN.aktif || 0 }, o), s);
  if (req.method !== "POST") return json({ error: "pakai POST" }, 405);
  const kini = Date.now();
  if (kini - segarTerakhir < SEGAR_JEDA_MS) return jawab({ ok: true, berubah: false, hasil: "baru saja diperiksa" });
  segarTerakhir = kini;
  const susulKv = async (hasil) => { jalanDiperiksa = 0; await segarkanJalan(env); return jawab({ ok: true, berubah: false, hasil }); };

  let k, j;
  try { k = kunciDariBaris((await env.DB.prepare(KUERI_KUNCI_JALAN).all()).results); }
  catch (e) { return jawab({ ok: false, berubah: false, hasil: `kv tidak terbaca: ${String(e.message || e)}` }, 502); }
  try { j = await tanyaGudangJalan(env, k && k.aktif ? k.versi : null); }
  catch (e) { return jawab({ ok: false, berubah: false, hasil: String(e.message || e) }, 502); }
  if (!j || !j.versi) return jawab({ ok: false, berubah: false, hasil: "gudang belum berisi jalan" });
  if (j.sama) return await susulKv("sama");
  if (!j.data) return jawab({ ok: false, berubah: false, hasil: "jawaban gudang tidak lengkap" });
  const aktifGudang = Date.parse(j.diubah_pada) || 0;
  if (k && j.versi === k.versi && aktifGudang && aktifGudang === k.aktif) return await susulKv("sama");

  const p = siapkanJalan(env, j);
  if (p.galat) {
    console.log(`jalan v${j.versi} DITOLAK lewat /api/jalan/segarkan (${p.galat}); tetap jalan v${JALAN.versi}`);
    return jawab({ ok: false, berubah: false, hasil: `ditolak: ${p.galat}` });
  }
  let tulis;
  try { tulis = await env.DB.batch(p.perintah); }
  catch (e) {
    console.log(`jalan v${j.versi} gagal disimpan lewat /api/jalan/segarkan: ${String(e.message || e)}`);
    return jawab({ ok: false, berubah: false, hasil: `gagal disimpan: ${String(e.message || e)}` }, 502);
  }
  if (!(Number(tulis?.[2]?.meta?.changes) > 0)) return await susulKv("kv sudah memegang versi yang lebih baru");
  pasangJalan(j.data, j.versi, j.judul, p.aktif);
  jalanDiperiksa = Date.now();
  console.log(`jalan v${j.versi} dipasang lewat /api/jalan/segarkan: ${RUAS.length} potong, batas luar ${BATAS_LUAR}`);
  return jawab({ ok: true, berubah: true, hasil: "baru" });
}

/* ------------------------------------------------------------------ jejak GPS
   Satu sampel = "dt,dlat,dlon,kec,arah": dt detik dari awal menit blok,
   dlat/dlon = (lat − 0,77)·1e5 dan (lon − 128,31)·1e5 (±1,1 m), bulat. */
const JEJAK_DASAR = [0.77, 128.31];
const JEJAK_SKALA = 100000;
const JEJAK_HARI = 3;
function catatJejak(jejak, T0, u, t) {
  if (!jejak) return;
  const k = String(u.id);
  const s = (t - Math.floor(T0 / 1000)) + "," + Math.round((u.lat - JEJAK_DASAR[0]) * JEJAK_SKALA) + "," +
            Math.round((u.lon - JEJAK_DASAR[1]) * JEJAK_SKALA) + "," + Math.round(u.kecepatan || 0) + "," + Math.round(u.arah || 0);
  const a = jejak.get(k);
  if (a) a.push(s); else jejak.set(k, [s]);
}
function perintahJejak(env, T, nama, jejak) {
  if (!jejak || !jejak.size) return null;
  const bag = [];
  for (const [k, a] of jejak) bag.push(k + ":" + a.join("|"));
  return env.DB.prepare(`INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind("jejak:" + T + ":" + nama, bag.join(";"));
}

const FLAGS      = 1025;      // 1 = nama unit, 1024 = pesan terakhir + lokasi
const TICK_MS    = 10000;     // ambil data tiap 10 detik
const TICK_COUNT = 6;         // 6 kali per menit, dibagi ke tiga blok di bawah

/* Satu menit = tiga blok × dua putaran. Setiap blok dijalankan pemicu cron
   miliknya sendiri, jadi masing-masing punya jatah CPU 10 ms sendiri (§21.11). */
const BLOK = [
  { nama: "A", mulai: 0 },        // detik 0 dan 10
  { nama: "B", mulai: 20000 },    // detik 20 dan 30
  { nama: "C", mulai: 40000 },    // detik 40 dan 50
];
const PUTARAN_PER_BLOK = TICK_COUNT / BLOK.length;
const BLOK_PETA = Object.fromEntries(BLOK.map((b) => [b.nama, b]));

/* Blok TIDAK dipetakan dari tulisan ekspresi cron. Setiap pemanggilan
   mengklaim blok kosong pertama (A → B → C), jadi pemicu mana pun yang datang
   duluan menjadi A. Tulisan cron-nya hanya dicatat untuk /api/status. */

// Batas tunggu satu panggilan Wialon. Biasanya ±200 ms.
const BATAS_TUNGGU_MS = 5000;
const WIT        = 9 * 60 * 60000;

// Aturan deteksi — menyalin nilai bawaan readConfig() di speed-watcher.html.
const KONFIRMASI  = 2;        // sampel berturut-turut sebelum dibuka/ditutup
const HISTERESIS  = 5;        // km/jam di bawah batas sebelum dianggap selesai
const MIN_SATELIT = 4;
const KEC_MAKS    = 150;      // di atas ini pembacaan dianggap rusak
const LOMPAT_M    = 150;      // meter
const LOMPAT_DT   = 5;        // detik
const UMUR_MAKS   = 300;      // detik; pesan lebih tua diabaikan
const SIMPAN_HARI = 120;

/* Versi 11 — aturan gerak (lihat kepala berkas). Batas fisik alat berat, bukan
   setelan. Halaman speed-watcher.html memakai angka yang sama (GERAK di sana);
   keduanya harus diubah bersama. */
const KEC_CEK    = 15;        // km/jam; di bawah ini aturan diam dan arah tidak dipakai
const JEDA_PENDEK = 20;       // detik; aturan diam dan arah hanya untuk jeda sesingkat ini
const GERAK_DT   = 60;        // detik; aturan tempuh hanya untuk jeda sesingkat ini
const DIAM_TOL   = 10;        // meter, galat GPS pada aturan diam
const ARAH_MIN_M = 20;        // meter; perpindahan minimal supaya arahnya bermakna
const ARAH_MAKS  = 150;       // derajat
const PERCEPATAN = 2;         // m/s²
const PENGEREMAN = 4;         // m/s²
const PUNCAK_MS  = 20;        // m/s (72 km/jam), puncak dalam profil jarak terjauh
const TEMPUH_TOL = 30;        // meter, galat GPS di dua ujung

/* Versi 13 — mesin mati (lihat kepala berkas, §21.17). Sensor "engine operation"
   tiap unit di Wialon dipetakan sedikit demi sedikit oleh blok A, lalu nilainya
   dibaca dari pesan terakhir yang memang sudah ikut di jawaban flag 1024. */
const MESIN_FLAG      = 4097;    // flag Wialon: 1 nama unit + 4096 daftar sensor
const MESIN_SEGAR     = 86400;   // detik; peta sensor tiap unit diperiksa ulang sekali sehari
const MESIN_ULANG     = 3600;    // detik; unit yang jawabannya galat dicoba lagi sejam kemudian
const MESIN_PER_MENIT = 4;       // unit yang dipetakan per menit (satu panggilan kecil per unit)
const MESIN_LMSG_TOL  = 60;      // detik; pesan terakhir tidak boleh lebih tua dari pesan posisi
const MESIN_CURIGA    = 30;      // bacaan "bergerak, mesin mati" dalam sejam → sensor dicurigai macet
const MESIN_JENDELA   = 3600;    // detik
const MESIN_ABAIKAN   = 259200;  // detik (3 hari); sensor yang dicurigai macet diabaikan selama ini
const MESIN_CACHE_MS  = 60000;   // salinan baris kv 'mesin' di memori isolate

// Bertahan selama isolate hidup, jadi pekerjaan sekali-jalan tidak diulang
// pada tiap permintaan.
let tabelSiap = false;
let sidCache = null;
/* Versi 14: indeks unik (unit_id, mulai) sudah ada? true/false sesudah
   siapkanTabel() isolate ini memeriksanya, null bila belum diperiksa. */
let unikAda = null;
// true sampai pemanggilan cron pertama di isolate ini — untuk log (versi 10).
let isolateBaru = true;
/* Peta sensor mesin (versi 13), salinan baris kv 'mesin':
     u[id] = { t, p, n, tb, lb, ub, ket }  — p null: tidak ada sensor yang bisa dipakai
     x[id] = detik (epoch) sampai kapan sensor unit itu diabaikan karena dicurigai macet
   `mesinUbah` menampung perubahan yang belum tersimpan; dikirim sebagai json_patch
   supaya blok lain yang menulis di menit yang sama tidak saling menimpa. */
let MESIN = { u: {}, x: {}, dimuat: 0 };
let mesinUbah = { u: {}, x: {} };

// Ringkasan shift untuk kartu Home dipakai bersama selama ini, lintas tab dan
// lintas isolate (lewat baris `kv`), supaya jumlah penonton tidak melipatgandakan
// pembacaan D1. Halaman menariknya tiap 60 detik, jadi 55 detik tidak menambah
// keterlambatan yang terasa.
const RINGKAS_SEGAR = 55000;  // ms
// Rentang tanggal yang sudah tertutup tidak bertambah barisnya lagi, jadi
// simpanannya boleh jauh lebih lama daripada shift yang sedang berjalan.
const RINGKAS_TUTUP = 600000;  // ms
// Jumlah jendela yang ditahan di memori isolate (shift berjalan + beberapa
// rentang yang sedang dilihat orang).
const RINGKAS_SIMPAN = 8;
let ringkasMem = new Map();

// Kejadian yang masih berstatus berjalan tapi tidak diperbarui selama ini
// dianggap yatim dan ditutup oleh pembersihan harian. Cron sendiri menutup
// kejadian menggantung setelah 15 menit, jadi satu jam hanya mengenai baris yang
// state-nya benar-benar hilang.
const YATIM_MS = 3600000;

/* Versi 14 — satu kejadian satu baris. Nama indeks unik WAJIB tetap: dipakai
   sebagai penanda bahwa pembersihan catatan ganda sudah selesai. */
const IDX_UNIK = "idx_pelanggaran_unit_mulai";
const GANDA_ULANG_MS = 300000;      // jeda pertama sesudah percobaan pembersihan yang gagal (5 menit)
const GANDA_JEDA_MAKS_MS = 86400000; // jeda berlipat paling lama 24 jam
const GANDA_MAKS = 200;             // kelompok ganda per percobaan (sisanya di percobaan berikutnya)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  // Authorization sejak versi 12: token login admin untuk hapus/pulihkan.
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
/* Berindentasi hanya bila diminta (/api/status, dibaca manusia). /api/unit
   dipanggil tiap 10 detik oleh tiap tab, jadi jawabannya dibuat ringkas (v10). */
const json = (d, s = 200, rapi = false) =>
  new Response(rapi ? JSON.stringify(d, null, 2) : JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tanggalWIT = (ms) => new Date(ms + WIT).toISOString().slice(0, 10);
// "23/10 14.03" dalam WIT, untuk pesan yang dibaca manusia (versi 14).
const waktuWIT = (ms) => {
  const t = new Date(Number(ms) + WIT).toISOString();
  return t.slice(8, 10) + "/" + t.slice(5, 7) + " " + t.slice(11, 13) + "." + t.slice(14, 16);
};

async function wialon(svc, params, sid) {
  const u = new URL(`${HOST}/wialon/ajax.html`);
  u.searchParams.set("svc", svc);
  u.searchParams.set("params", JSON.stringify(params));
  if (sid) u.searchParams.set("sid", sid);
  /* Tanpa batas tunggu, satu jawaban yang menggantung bisa menahan sebuah blok
     melewati giliran blok berikutnya, lalu menimpa state yang lebih baru. */
  const opsi = { method: "POST" };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    opsi.signal = AbortSignal.timeout(BATAS_TUNGGU_MS);
  }
  return (await fetch(u, opsi)).json();
}

// ------------------------------------------------------------------ database

async function siapkanTabel(env) {
  if (tabelSiap) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS pelanggaran (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         unit_id INTEGER, unit TEXT, tanggal TEXT,
         mulai INTEGER, selesai INTEGER,
         kecepatan_max REAL, batas REAL,
         lat REAL, lon REAL)`
    ),
  ]);
  // Kolom tambahan untuk basis data yang terlanjur dibuat versi 1. Diperiksa
  // dulu, bukan dicoba lalu gagal: melempar tiga pengecualian pada tiap
  // permintaan adalah pemborosan CPU yang tidak kelihatan di kode.
  const info = await env.DB.prepare(`PRAGMA table_info(pelanggaran)`).all();
  const punya = new Set((info.results || []).map((r) => r.name));
  const perlu = { kecepatan_rata: "REAL", sampel: "INTEGER", berjalan: "INTEGER DEFAULT 0",
                  ruas: "TEXT", ruas_dekat: "TEXT", jarak_ruas: "REAL" };
  for (const k of Object.keys(perlu)) {
    if (!punya.has(k)) {
      await env.DB.prepare(`ALTER TABLE pelanggaran ADD COLUMN ${k} ${perlu[k]}`).run();
    }
  }

  /* Indeks untuk kueri yang dipanggil berulang. Tanpa indeks, D1 memindai seluruh
     tabel pada setiap kueri dan menagih setiap baris yang dipindai — itulah yang
     menghabiskan kuota 5 juta baris terbaca pada 16 September 2026.

       idx_pelanggaran_tanggal_mulai  → ?tanggal= , rentang ekspor, hitungan hari
                                        ini, pembersihan data lama
       idx_pelanggaran_mulai          → jendela shift di /api/ringkas

     Nama indeks WAJIB sama dengan yang dibuat lewat Console D1, supaya tidak
     terbangun kembar. Diperiksa dulu lewat sqlite_schema: membangun indeks
     menulis satu baris per baris tabel, jadi tidak boleh dicoba tiap permintaan.

     Bagian ini dibungkus try karena ia jaring pengaman, bukan jalur utama: indeks
     dibuat lewat Console D1. Kalau pemeriksaannya gagal, permintaan tetap
     dilayani — lebih lambat tanpa indeks, tapi tidak mati. */
  try {
    const idx = await env.DB.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'pelanggaran'`
    ).all();
    const adaIdx = new Set((idx.results || []).map((r) => r.name));
    const indeks = {
      idx_pelanggaran_tanggal_mulai:
        `CREATE INDEX IF NOT EXISTS idx_pelanggaran_tanggal_mulai ON pelanggaran(tanggal, mulai)`,
      idx_pelanggaran_mulai:
        `CREATE INDEX IF NOT EXISTS idx_pelanggaran_mulai ON pelanggaran(mulai)`,
    };
    let dibuat = false;
    for (const k of Object.keys(indeks)) {
      if (!adaIdx.has(k)) {
        await env.DB.prepare(indeks[k]).run();
        dibuat = true;
      }
    }
    // Statistik tabel untuk perencana kueri, hanya sesudah indeks baru dibuat.
    if (dibuat) await env.DB.prepare(`PRAGMA optimize`).run().catch(() => {});

    /* Versi 14: indeks unik (unit_id, mulai). Selama belum ada, catatan ganda
       lama dirapikan lebih dulu (pastikanUnik). Daftar indeks di atas sudah
       terbaca, jadi sesudah indeks itu ada pemeriksaan ini tidak memakan kueri
       tambahan sama sekali. */
    unikAda = adaIdx.has(IDX_UNIK) || await pastikanUnik(env);
    /* Versi 15: catatan terbelah, sekali sehari (baris kv 'belah'). Butuh indeks
       unik: pasangannya dicari lewat indeks itu, dan catatan ganda (mulai sama)
       sudah dirapikan lebih dulu. */
    if (unikAda) {
      try { await rapikanBelah(env); }
      catch (e) { console.log(`catatan terbelah: dilewati, dicoba isolate berikutnya: ${String(e.message || e).slice(0, 200)}`); }
    }
  } catch (e) {
    console.log(`pemeriksaan indeks gagal: ${String(e.message || e)}`);
  }

  tabelSiap = true;
}

const ambilKV = async (env, k) =>
  (await env.DB.prepare(`SELECT v FROM kv WHERE k=?`).bind(k).first())?.v ?? null;

const simpanKV = (env, k, v) =>
  env.DB.prepare(`INSERT INTO kv (k,v) VALUES (?,?)
                  ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind(k, String(v)).run();

// -------------------------------------------------------------------- wialon

// Login lalu daftarkan SEMUA unit sekaligus. Pendaftaran inilah yang dulu
// harus dilakukan manusia lewat panel Setelan → Unit dipantau.
async function login(env) {
  if (!env.WIALON_TOKEN) throw new Error("WIALON_TOKEN belum diisi");

  const r = await wialon("token/login", { token: env.WIALON_TOKEN });
  if (r.error) throw new Error(`login gagal, kode ${r.error}`);

  const daftar = await wialon(
    "core/update_data_flags",
    { spec: [{ type: "type", data: "avl_unit", flags: FLAGS, mode: 0 }] },
    r.eid
  );
  if (daftar.error) throw new Error(`daftar unit gagal, kode ${daftar.error}`);

  await simpanKV(env, "sid", r.eid);
  sidCache = r.eid;
  return r.eid;
}

/* `denganRuas` hanya perlu true untuk /api/unit, yang mengirim kolom ruas dan
   batas ke layar. Cron memanggilnya false: jalur deteksi sudah mencocokkan ruas
   sendiri di dalam satuPutaran(), dan di sana pencocokan itu SENGAJA dilewati
   untuk unit di bawah BATAS_MIN. Mencocokkan di sini lebih dulu membatalkan
   penjaga anggaran tersebut — enam kali per menit, untuk seluruh armada. */
async function ambilUnit(env, denganRuas = true) {
  const kini = Math.floor(Date.now() / 1000);
  return (await ambilItem(env)).map((it) => ({
    id: it.id,
    nama: it.nm,
    lat: it.pos?.y ?? null,
    lon: it.pos?.x ?? null,
    kecepatan: it.pos?.s ?? null,
    arah: it.pos?.c ?? null,
    satelit: it.pos?.sc ?? null,
    waktu: it.pos?.t ? it.pos.t * 1000 : null,
    /* true nyala, false mati, null tidak diketahui / tanpa sensor / diabaikan
       (versi 13). Cron hanya butuh status untuk bacaan ≥ KEC_CEK — di bawah itu
       aturan mesin tidak berlaku — jadi unit lambat dan parkir tidak dihitung. */
    mesin: (denganRuas || (it.pos && it.pos.s >= KEC_CEK)) ? mesinUnit(it, kini) : null,
  })).map((u) => {
    // Ruas dan batas yang berlaku ikut dikirim supaya layar tidak perlu
    // menghitung sendiri dan tidak bisa berbeda dengan penilaian server.
    if (!denganRuas) return u;
    const rz = (u.lat != null && u.lon != null) ? cariRuas(u.lat, u.lon)
                                                : { nama: null, batas: BATAS_LUAR };
    u.ruas = rz.nama;
    u.batas = rz.batas;
    return u;
  });
}

/* Jawaban mentah core/search_items (flag 1025) — dipakai ambilUnit dan /api/mesin. */
async function ambilItem(env) {
  let sid = sidCache || (await ambilKV(env, "sid"));
  if (!sid) sid = await login(env);
  sidCache = sid;

  const spec = {
    spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
    force: 1, flags: FLAGS, from: 0, to: 0,
  };

  let r = await wialon("core/search_items", spec, sid);
  if (r.error) {
    /* Sesi ditolak. Sebelum login ulang, lihat dulu apakah bagian lain Worker
       — cron di mesin lain, atau /api/unit dari tab yang terbuka — baru saja
       login dan menyimpan sesi yang lebih baru. Login dengan token yang sama
       membuat sesi sebelumnya basi (§6.5); kalau setiap isolate langsung login
       sendiri, keduanya saling menjatuhkan tanpa henti dan tiap putaran
       membayar tiga panggilan Wialon tambahan. */
    const terbaru = await ambilKV(env, "sid");
    if (terbaru && terbaru !== sid) {
      sid = terbaru;
      sidCache = terbaru;
      r = await wialon("core/search_items", spec, sid);
    }
    if (r.error) {
      sidCache = null;
      console.log(`sesi Wialon ditolak (kode ${r.error}), login ulang`);
      sid = await login(env);
      r = await wialon("core/search_items", spec, sid);
      if (r.error) throw new Error(`ambil unit gagal, kode ${r.error}`);
    }
  }

  return r.items || [];
}

// ------------------------------------------------------------- mesin (v13)

/* Baris kv 'mesin' dibaca paling sering sekali per menit per isolate. Galat baca
   tidak dinaikkan: peta lama tetap dipakai, dan tanpa peta aturan mesin diam —
   tidak menolak apa pun. */
async function muatMesin(env, paksa = false) {
  if (!paksa && MESIN.dimuat && Date.now() - MESIN.dimuat < MESIN_CACHE_MS) return;
  try {
    const d = JSON.parse((await ambilKV(env, "mesin")) || "{}") || {};
    const obj = (x) => (x && typeof x === "object") ? x : {};
    MESIN = { u: obj(d.u), x: obj(d.x), dimuat: Date.now() };
    // Perubahan isolate ini yang belum sempat tersimpan tetap berlaku.
    Object.assign(MESIN.u, mesinUbah.u);
    for (const k in mesinUbah.x) {
      if (mesinUbah.x[k] == null) delete MESIN.x[k]; else MESIN.x[k] = mesinUbah.x[k];
    }
  } catch (e) {
    MESIN.dimuat = Date.now();
  }
}

/* Perubahan peta dikirim sebagai merge patch (RFC 7396): kunci yang dikirim
   ditimpa, yang tidak dikirim dibiarkan, null menghapus. Blok lain yang menulis
   unit lain pada menit yang sama tidak tertimpa. Sengaja di luar batch state:
   galat di sini tidak boleh menggagalkan penyimpanan state dan pelanggaran. */
async function simpanMesin(env) {
  if (!Object.keys(mesinUbah.u).length && !Object.keys(mesinUbah.x).length) return null;
  const patch = mesinUbah;
  mesinUbah = { u: {}, x: {} };
  try {
    await env.DB.prepare(
      `INSERT INTO kv (k, v) VALUES ('mesin', ?)
         ON CONFLICT(k) DO UPDATE SET
           v = CASE WHEN json_valid(kv.v) THEN json_patch(kv.v, excluded.v) ELSE excluded.v END`
    ).bind(JSON.stringify(patch)).run();
    return null;
  } catch (e) {
    // Dikembalikan ke antrean; dicoba lagi di akhir blok berikutnya.
    for (const k in patch.u) if (!(k in mesinUbah.u)) mesinUbah.u[k] = patch.u[k];
    for (const k in patch.x) if (!(k in mesinUbah.x)) mesinUbah.x[k] = patch.x[k];
    return String(e.message || e);
  }
}

const angkaAtauNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);

/* Sensor mesin dari daftar sensor satu unit (flag 4096): jenis "engine operation"
   — sensor kunci kontak/ignition Wialon. Hanya parameter tunggal yang dipakai:
   nama parameter pesan (io_239, ign, acc, …) atau bit masukan/keluaran digital
   (in1, out2, …). Rumus dilewati: lebih baik aturan diam daripada salah tafsir. */
function definisiMesin(sens) {
  const daftar = Object.values(sens || {})
    .filter((x) => x && x.t === "engine operation")
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  if (!daftar.length) return { p: null, ket: "tanpa sensor mesin" };
  const x = daftar[0];
  const n = String(x.n || "").slice(0, 40);
  const p = String(x.p || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(p)) return { p: null, n, ket: "parameter berupa rumus" };
  const d = { p, n };
  if (Array.isArray(x.tbl) && x.tbl.length) {
    const tb = x.tbl.map((r) => [angkaAtauNull(r?.x), angkaAtauNull(r?.a), angkaAtauNull(r?.b)])
      .filter((r) => r.every((v) => v !== null))
      .sort((a, b) => a[0] - b[0]);
    if (tb.length) d.tb = tb;
  }
  let c = null;
  try { c = typeof x.c === "string" ? JSON.parse(x.c) : x.c; } catch (e) { c = null; }
  const lb = angkaAtauNull(c?.lower_bound), ub = angkaAtauNull(c?.upper_bound);
  // Batas 0/0 atau terbalik = tidak diatur.
  if (lb !== null && ub !== null && lb >= ub) return d;
  if (lb !== null) d.lb = lb;
  if (ub !== null) d.ub = ub;
  return d;
}

/* Nilai mentah sensor mesin dari pesan terakhir (lmsg, sudah ikut di jawaban
   flag 1024): parameter pesan, atau bit in/out dari bilangan masukan/keluaran.
   null bila tidak terbaca, atau bila pesan terakhir lebih tua dari pesan posisi.
   Jalur panas (dipanggil per unit per putaran, sering di isolate dingin tanpa
   JIT): tanpa alokasi objek, angka biasa langsung dipakai. */
function nilaiMentahMesin(d, it) {
  const m = it.lmsg;
  if (!m) return null;
  const tPos = it.pos ? it.pos.t : 0;
  if (tPos && !(m.t >= tPos - MESIN_LMSG_TOL)) return null;
  const v = m.p ? m.p[d.p] : undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v !== undefined) return angkaAtauNull(v);
  const c = d.p.charCodeAt(0);
  if (c !== 105 && c !== 111) return null;                    // bukan "in…"/"out…"
  const r = /^(in|out)(\d{1,2})$/.exec(d.p);
  if (!r) return null;
  const semua = angkaAtauNull(r[1] === "in" ? m.i : m.o), bit = Number(r[2]);
  return (semua !== null && bit >= 1 && bit <= 32) ? Math.floor(semua / 2 ** (bit - 1)) % 2 : null;
}

/* Status dari nilai mentah: tabel kalkulasi Wialon (y = a·x + b dari baris
   terakhir yang x-nya ≤ nilai) → di luar batas bawah/atas: tidak diketahui →
   y > 0 nyala, y = 0 mati. */
function statusMesin(d, v) {
  let y = v;
  if (d.tb) {
    let baris = null;
    for (const r of d.tb) { if (r[0] <= v) baris = r; else break; }
    if (!baris) return null;
    y = baris[1] * v + baris[2];
  }
  if (d.lb != null && (v < d.lb || y < d.lb)) return null;
  if (d.ub != null && (v > d.ub || y > d.ub)) return null;
  return y > 0 ? true : (y === 0 ? false : null);
}

/* Untuk /api/mesin: nilai mentah dan statusnya. */
function bacaMesin(d, it) {
  if (!d || !d.p) return { v: null, nyala: null };
  const v = nilaiMentahMesin(d, it);
  return { v, nyala: v === null ? null : statusMesin(d, v) };
}

/* Yang dipakai deteksi dan /api/unit: null bila unit belum dipetakan, tidak
   punya sensor mesin, atau sensornya sedang diabaikan karena dicurigai macet. */
function mesinUnit(it, kini) {
  const d = MESIN.u[it.id];
  if (!d || !d.p) return null;
  const abai = MESIN.x[it.id];
  if (abai && abai > kini) return null;
  const v = nilaiMentahMesin(d, it);
  return v === null ? null : statusMesin(d, v);
}

/* Blok A: petakan sensor mesin beberapa unit per menit — yang belum pernah
   dipetakan lebih dulu, lalu yang petanya paling tua. Satu unit satu panggilan
   kecil (core/search_item, flag 4096), jadi biaya CPU per menit tetap kecil
   walau armada bertambah. Mengembalikan jumlah perubahan peta. */
async function petakanMesin(env, ids) {
  const kini = Math.floor(Date.now() / 1000);
  let n = 0;
  // Masa abai yang sudah lewat dibuang dari baris kv (null = hapus pada merge patch).
  for (const k of Object.keys(MESIN.x)) {
    if (!(Number(MESIN.x[k]) > kini)) { delete MESIN.x[k]; mesinUbah.x[k] = null; n++; }
  }
  const calon = ids
    .filter((id) => { const d = MESIN.u[id]; return !d || !(kini - (Number(d.t) || 0) < MESIN_SEGAR); })
    .sort((a, b) => (Number(MESIN.u[a]?.t) || 0) - (Number(MESIN.u[b]?.t) || 0))
    .slice(0, MESIN_PER_MENIT);
  if (!calon.length) return n;
  const sid = sidCache || (await ambilKV(env, "sid"));
  if (!sid) return n;
  const hasil = await Promise.all(calon.map((id) =>
    wialon("core/search_item", { id: Number(id), flags: MESIN_FLAG }, sid).catch(() => null)));
  hasil.forEach((r, i) => {
    const id = calon[i];
    if (!r) return;                                  // jaringan: coba lagi menit berikutnya
    if (r.error === 1) return;                       // sesi basi: putaran berikutnya login ulang
    let d;
    if (r.error || !r.item) {
      // Galat lain (mis. tanpa hak baca sensor): dicatat supaya tidak diulang tiap menit.
      d = { p: null, ket: "galat Wialon " + (r.error ?? "tanpa item"), t: kini - MESIN_SEGAR + MESIN_ULANG };
    } else {
      d = definisiMesin(r.item.sens);
      d.t = kini;
    }
    const lama = MESIN.u[id];
    // Kolom kosong bisa tersimpan sebagai null atau tidak ada sama sekali — disamakan dulu.
    const sama = (k) => JSON.stringify(lama?.[k] ?? null) === JSON.stringify(d[k] ?? null);
    if (!lama || !["p", "n", "tb", "lb", "ub", "ket"].every(sama)) {
      const nama = r.item?.nm ? ` (${r.item.nm})` : "";
      console.log(`mesin unit=${id}${nama} ` + (d.p
        ? `sensor="${d.n}" param=${d.p}${d.tb ? " tabel=" + d.tb.length : ""}${d.lb != null || d.ub != null ? ` batas=${d.lb ?? ""}..${d.ub ?? ""}` : ""}`
        : d.ket));
    }
    MESIN.u[id] = d;
    /* Merge patch MENGGABUNG objek: kolom lama yang tidak ikut dikirim akan
       tertinggal (mis. tabel kalkulasi sensor lama). Karena itu semua kolom
       dikirim, yang kosong sebagai null — null pada merge patch menghapusnya. */
    const lengkap = {};
    for (const kol of ["t", "p", "n", "tb", "lb", "ub", "ket"]) lengkap[kol] = d[kol] ?? null;
    mesinUbah.u[id] = lengkap;
    n++;
  });
  return n;
}

// ------------------------------------------------------------------ deteksi

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function median(a) {
  const b = [...a].sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function koordSah(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
         Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/* Jarak titik ke ruas memakai pendekatan bidang datar dengan skala derajat
   setempat — rumus yang sama dengan degScale()/distToSegment() di halaman,
   supaya server dan layar mencocokkan ruas dengan cara yang identik. */
function skalaDerajat(lat) {
  return { x: 111320 * Math.cos((lat * Math.PI) / 180), y: 110540 };
}
/* Versi 15: skala derajat dihitung pemanggilnya SEKALI per titik, bukan sekali
   per penggal. Hasilnya sama persis — skala itu hanya bergantung pada lintang
   titik — tetapi pencocokan ruas tidak lagi membayar Math.cos tiap penggal. */
function jarakSkala(lon, lat, x1, y1, x2, y2, mx, my) {
  const px = (lon - x1) * mx, py = (lat - y1) * my;
  const vx = (x2 - x1) * mx, vy = (y2 - y1) * my;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? (px * vx + py * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - vx * t, py - vy * t);
}
function jarakKeSegmen(lon, lat, x1, y1, x2, y2) {
  const m = skalaDerajat(lat);
  return jarakSkala(lon, lat, x1, y1, x2, y2, m.x, m.y);
}

/* Ruas mana yang berlaku di satu titik.

   Memeriksa seluruh penggal jalan untuk tiap unit, enam kali per menit, memakan
   ~35 ms CPU — tiga kali anggaran paket gratis. Karena itu penggal jalan
   diindeks sekali per isolate.

   Versi 5–9 memakai grid sel ~55 m (Map berkunci teks "x:y"). Grid itu murah
   saat dicari tapi MAHAL saat dibangun: 1,3 ms untuk 493 titik, 4,8 ms untuk
   2.842 titik — dan Cloudflare sering menjalankan cron di isolate baru, jadi
   biaya bangun itu dibayar hampir di setiap pemanggilan (versi 10).

   Sekarang INDEKS POTONGAN: tiap ruas dipotong per SEGMEN_PER_POTONG penggal,
   dan tiap potongan — juga tiap ruas utuh — menyimpan kotak batasnya yang
   dilebarkan padSel(toleransi), dalam typed array. Membangunnya satu lintasan atas titik, tanpa Map dan tanpa
   kunci teks. Mencari = memeriksa kotak (perbandingan angka saja), lalu
   mengukur jarak penggal hanya di potongan yang kotaknya memuat titik.

   Hasilnya identik dengan grid. Penggal yang berjarak ≤ toleransi pasti berada
   di dalam kotak potongannya (pelebaran > toleransi pada kedua sumbu), jadi
   himpunan penggal yang lolos uji jarak sama persis.

   Bila beberapa ruas bertumpang tindih — hal biasa di persimpangan — yang
   dipakai sejak versi 15 adalah RUAS TERDEKAT: penggal yang paling dekat dengan
   titik menentukan ruas dan batasnya (keputusan Iqbal, 24 Oktober 2026). Sampai
   versi 14 yang dipakai batas terendah, sehingga unit yang sudah keluar dari
   simpang ke ruas 35 km/jam tetap dinilai 25 km/jam selama masih dalam
   toleransi ruas sebelah. Dua jarak yang berselisih tidak lebih dari SERI_M
   dianggap sama (mis. titik di luar ujung dua ruas yang bertemu di satu simpul:
   jaraknya ke simpul itu sama); di situ batas terendah yang menang, lalu nama
   ruas menurut abjad. Aturan ini tidak bergantung pada urutan ruas, jadi
   ruasBerlaku() di speed-watcher.html dan cariRuasLokal() di Digital Twin yang
   memeriksa ruas dengan urutan lain memberi hasil yang sama. */
/* Batas terendah yang ada di tabel. Di bawah angka ini tidak ada yang bisa
   dilanggar, jadi pencocokan ruas boleh dilewati sama sekali. */
let BATAS_MIN = RUAS.reduce((m, r) => Math.min(m, r.b), BATAS_LUAR);

/* SEL dan PAD_SEL tetap dipakai periksaJalan() untuk menghitung MAKS_SEL —
   aturan yang dipakai bersama Supabase (site__cek_jalan_worker) dan Digital Twin,
   jadi tidak boleh berubah sendirian di sini, walau grid-nya sudah tidak ada. */
const SEL = 0.0005;               // sisi sel grid lama, derajat (aturan MAKS_SEL)
const PAD_SEL = 0.00025;          // pelebaran kotak, ~28 m
/* Pelebaran harus melebihi toleransi. Dengan toleransi 20 m cukup 28 m; bila
   admin menaikkannya (paling besar 60 m) pelebaran ikut naik, supaya titik yang
   masih dalam toleransi tetap menemukan ruasnya. */
function padSel(tol) { return Math.max(PAD_SEL, (tol + 5) / 111000); }

const SEGMEN_PER_POTONG = 8;
/* Dua tingkat: kotak per RUAS (dilewati utuh bila titik di luarnya), lalu kotak
   per POTONGAN di dalam ruas itu. Di isolate dingin kode berjalan tanpa JIT,
   jadi yang dihemat adalah jumlah putaran loop, bukan hanya alokasi. */
let indeks = null;   // { nr, kotakRuas, c0, c1, kotak, dari, sampai }

function bangunIndeks() {
  const PAD = padSel(TOLERANSI_RUAS);
  const nr = RUAS.length;
  let n = 0;
  for (let i = 0; i < nr; i++) {
    const seg = RUAS[i].p.length - 1;
    if (seg > 0) n += Math.ceil(seg / SEGMEN_PER_POTONG);
  }
  const kotakRuas = new Float64Array(nr * 4), c0 = new Int32Array(nr), c1 = new Int32Array(nr);
  const kotak = new Float64Array(n * 4), dari = new Int32Array(n), sampai = new Int32Array(n);
  let c = 0;
  for (let i = 0; i < nr; i++) {
    const p = RUAS[i].p, seg = p.length - 1;
    let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
    c0[i] = c;
    for (let j0 = 0; j0 < seg; j0 += SEGMEN_PER_POTONG) {
      const j1 = Math.min(seg, j0 + SEGMEN_PER_POTONG);   // penggal j0 … j1-1, titik j0 … j1
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = j0; j <= j1; j++) {
        const x = p[j][0], y = p[j][1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const o = c * 4;
      kotak[o] = x0 - PAD; kotak[o + 1] = y0 - PAD; kotak[o + 2] = x1 + PAD; kotak[o + 3] = y1 + PAD;
      dari[c] = j0; sampai[c] = j1;
      if (x0 < rx0) rx0 = x0; if (x1 > rx1) rx1 = x1;
      if (y0 < ry0) ry0 = y0; if (y1 > ry1) ry1 = y1;
      c++;
    }
    c1[i] = c;
    const o = i * 4;
    kotakRuas[o] = rx0 - PAD; kotakRuas[o + 1] = ry0 - PAD; kotakRuas[o + 2] = rx1 + PAD; kotakRuas[o + 3] = ry1 + PAD;
  }
  /* dRuas/calon: ruang kerja cariRuas() (jarak tiap ruas calon dan nomornya),
     disiapkan sekali supaya pencarian tidak membuat objek baru. */
  indeks = { nr, kotakRuas, c0, c1, kotak, dari, sampai, pad: PAD,
             dRuas: new Float64Array(nr), calon: new Int32Array(nr) };
}

/* Dua jarak (meter) yang selisihnya tidak lebih dari ini dianggap sama. Jauh di
   bawah ketelitian GPS, jauh di atas galat pembulatan (±1e-12 m). */
const SERI_M = 1e-6;

/* Versi 15: ruas TERDEKAT dalam toleransi (lihat di atas). Dua lintasan: yang
   pertama mencari jarak terdekat tiap ruas yang kotaknya memuat titik, yang kedua
   memilih di antara ruas yang jaraknya seri dengan yang terdekat.

   Potongan yang kotak aslinya (tanpa pelebaran) sudah lebih jauh dari jarak
   terdekat yang ditemukan dilewati: semua penggal di dalamnya pasti lebih jauh,
   jadi hasilnya sama dengan mengukur semuanya. Itulah yang menjaga biayanya dekat
   versi 14, yang berhenti di penggal pertama yang kena. */
function cariRuas(lat, lon) {
  if (!indeks) bangunIndeks();
  const { nr, kotakRuas, c0, c1, kotak, dari, sampai, pad, dRuas, calon } = indeks;
  const sk = skalaDerajat(lat), mx = sk.x, my = sk.y;
  const TOL = TOLERANSI_RUAS;

  let n = 0, dmin = Infinity;
  for (let i = 0; i < nr; i++) {
    const q = i * 4;
    if (lon < kotakRuas[q] || lat < kotakRuas[q + 1] || lon > kotakRuas[q + 2] || lat > kotakRuas[q + 3]) continue;
    // Ruas yang kotak aslinya sudah lebih jauh dari yang terdekat tidak perlu diukur.
    if (dmin < TOL && jauhKotak(kotakRuas, q, pad, lon, lat, mx, my, dmin + 2 * SERI_M)) continue;
    const p = RUAS[i].p;
    let di = Infinity;
    for (let c = c0[i]; c < c1[i]; c++) {
      const o = c * 4;
      if (lon < kotak[o] || lat < kotak[o + 1] || lon > kotak[o + 2] || lat > kotak[o + 3]) continue;
      /* Jarak ke kotak asli potongan ini = batas bawah jarak ke penggal mana pun di
         dalamnya. Dilonggarkan SERI_M supaya galat pembulatan kotak tidak pernah
         membuang penggal yang masih seri atau masih dalam toleransi. Sebelum ada
         jarak pembanding, kotak berpelebaran di atas sudah menjadi saringannya. */
      const ref = di < dmin ? di : dmin;
      if (ref < TOL && jauhKotak(kotak, o, pad, lon, lat, mx, my, ref + 2 * SERI_M)) continue;
      for (let j = dari[c]; j < sampai[c]; j++) {
        const d = jarakSkala(lon, lat, p[j][0], p[j][1], p[j + 1][0], p[j + 1][1], mx, my);
        if (d < di) di = d;
      }
    }
    if (!(di <= TOL)) continue;
    dRuas[n] = di; calon[n++] = i;
    if (di < dmin) dmin = di;
  }
  if (!n) return { nama: null, batas: BATAS_LUAR };

  let r = null;
  for (let k = 0; k < n; k++) {
    if (dRuas[k] > dmin + SERI_M) continue;
    const x = RUAS[calon[k]];
    if (!r || x.b < r.b || (x.b === r.b && x.n < r.n)) r = x;
  }
  return { nama: r.n, batas: r.b };
}

/* Kotak k (berpelebaran `pad`) di larik `kotak`: apakah kotak aslinya lebih jauh
   dari `lim` meter dari titik. Perbandingan kuadrat, tanpa akar dan tanpa objek. */
function jauhKotak(kotak, k, pad, lon, lat, mx, my, lim) {
  let bx = kotak[k] + pad - lon;
  if (bx < 0) { bx = lon - kotak[k + 2] + pad; if (bx < 0) bx = 0; }
  let by = kotak[k + 1] + pad - lat;
  if (by < 0) { by = lat - kotak[k + 3] + pad; if (by < 0) by = 0; }
  bx *= mx; by *= my;
  return bx * bx + by * by > lim * lim;
}

/* Ruas TERDEKAT dari sebuah titik, tanpa batas jarak. Dipakai hanya untuk
   MENAMAI pelanggaran yang terjadi di luar semua ruas — area loading, dumping,
   stockpile — supaya peringkat di halaman Home tidak menumpuk di satu kantong
   "Di luar ruas" yang tidak memberi tahu apa-apa.

   Ini penamaan, BUKAN penilaian: pelanggarannya tetap dinilai dengan
   BATAS_LUAR, dan kolom `ruas` tetap kosong. Sengaja memindai seluruh 493 titik
   karena indeks hanya mengenal kotak di sekitar jalan, sedangkan titik yang
   dicari justru berada di luarnya. Boleh mahal karena hanya dijalankan sekali
   saat sebuah pelanggaran dibuka, bukan tiap pembacaan. */
function jarakKeKotak(lon, lat, bb) {
  const m = skalaDerajat(lat);
  const dx = Math.max(bb[0] - lon, 0, lon - bb[2]) * m.x;
  const dy = Math.max(bb[1] - lat, 0, lat - bb[3]) * m.y;
  return Math.hypot(dx, dy);
}

function ruasTerdekat(lat, lon) {
  /* Jarak ke kotak batas sebuah polyline tidak pernah lebih besar dari jarak ke
     garisnya, jadi polyline diurutkan menurut kotaknya lalu dipindai dari yang
     terdekat. Begitu kotak berikutnya sudah lebih jauh dari jarak terbaik yang
     sudah ditemukan, sisanya tidak mungkin menang dan pemindaian berhenti. */
  const urut = [];
  for (let i = 0; i < RUAS.length; i++) urut.push([jarakKeKotak(lon, lat, RUAS[i].bb), i]);
  urut.sort((a, b) => a[0] - b[0]);

  let nama = null, jarak = Infinity;
  for (let k = 0; k < urut.length; k++) {
    if (urut[k][0] >= jarak) break;
    const r = RUAS[urut[k][1]], p = r.p;
    for (let j = 0; j < p.length - 1; j++) {
      const d = jarakKeSegmen(lon, lat, p[j][0], p[j][1], p[j + 1][0], p[j + 1][1]);
      if (d < jarak) { jarak = d; nama = r.n; }
    }
  }
  return { nama: nama, jarak: isFinite(jarak) ? Math.round(jarak) : null };
}

/* Versi 11: posisi di dalam wilayah Pulau Pakal — kotak yang sama dengan
   pemeriksaan koordinat jalan (periksaJalan). */
function dalamWilayah(lat, lon) {
  return lon >= WILAYAH.lonMin && lon <= WILAYAH.lonMaks &&
         lat >= WILAYAH.latMin && lat <= WILAYAH.latMaks;
}

/* Versi 11: jarak terdekat (meter) yang PASTI sudah ditempuh unit yang kini
   melaju v1 m/s, dari kecepatan awal berapa pun dalam dt detik terakhir. Paling
   pendek bila ia diam lalu berangkat secepat PERCEPATAN tepat pada waktunya:
   v1²/2a. Bila v1 tidak terkejar dari diam dalam dt, ia sudah melaju sejak awal
   jeda. Batas bawah ini tidak pernah salah untuk gerak sungguhan — truk yang baru
   berangkat dari parkir pun memenuhinya — jadi yang ditolaknya hanya kecepatan
   besar dengan posisi beku. */
function jarakTerdekat(v1, dt) {
  const a = PERCEPATAN;
  return v1 <= a * dt ? (v1 * v1) / (2 * a) : v1 * dt - (a * dt * dt) / 2;
}

/* Versi 11: jarak terjauh (meter) yang bisa ditempuh dalam dt detik bila
   berangkat dengan kecepatan v0 dan tiba dengan v1 (m/s): naik secepat
   PERCEPATAN sampai puncak, lalu turun secepat PENGEREMAN, puncaknya paling
   tinggi PUNCAK_MS. Bila perubahan v0 → v1 sendiri sudah melebihi kemampuan itu,
   kecepatan lapornya yang janggal; batasnya dilonggarkan menjadi kecepatan
   tertinggi × dt, supaya aturan ini hanya menilai jarak. */
function jarakTerjauh(v0, v1, dt) {
  const a = PERCEPATAN, b = PENGEREMAN;
  const vc = Math.max(PUNCAK_MS, v0, v1);
  const vp = (dt + v0 / a + v1 / b) / (1 / a + 1 / b);
  if (vp < Math.max(v0, v1)) return vc * dt;
  if (vp <= vc) return (vp * vp - v0 * v0) / (2 * a) + (vp * vp - v1 * v1) / (2 * b);
  return (vc * vc - v0 * v0) / (2 * a) + (vc * vc - v1 * v1) / (2 * b) +
         vc * (dt - (vc - v0) / a - (vc - v1) / b);
}

/* Versi 11: pembacaan yang tidak mungkin datang dari unit yang bergerak
   sungguhan, dinilai terhadap sampel sah sebelumnya (`dt` detik, `jarak` meter).
   Mengembalikan alasan, atau null.

   Dijalankan untuk setiap pesan baru yang lolos aturan lama, jadi biayanya
   dijaga (anggaran CPU §21.6). Pesan lambat (< KEC_CEK) yang pindah kurang dari
   TEMPUH_TOL — unit parkir, memuat, merayap: kebanyakan armada setiap saat —
   langsung lolos, karena aturan diam dan arah hanya untuk pesan cepat dan aturan
   tempuh tidak mungkin menolak perpindahan di bawah toleransinya sendiri. Arah
   dihitung dengan skala derajat tetap Pulau Pakal, tanpa Math.cos dan objek baru. */
const SKALA_X = 111320 * Math.cos((0.785 * Math.PI) / 180);   // m per derajat bujur di site
const SKALA_Y = 110540;                                        // m per derajat lintang
function cekGerak(s, prev, dt, jarak) {
  if (dt > GERAK_DT) return null;
  if (s.speed < KEC_CEK && jarak < TEMPUH_TOL) return null;
  const v1 = s.speed / 3.6;
  if (s.speed >= KEC_CEK && dt <= JEDA_PENDEK) {
    // Kecepatan besar, posisi praktis diam. Jeda dibatasi pendek supaya garis
    // lurus antara dua posisi masih mendekati panjang lintasan.
    if (jarak + DIAM_TOL < jarakTerdekat(v1, dt)) return "diam";
    // Arah GPS berlawanan dengan arah perpindahan. Arah 0 dilewati: sebagian
    // perangkat mengirim 0 bila arahnya tidak diketahui.
    if (jarak >= ARAH_MIN_M && s.arah) {
      const arahPindah = Math.atan2((s.lon - prev.lon) * SKALA_X, (s.lat - prev.lat) * SKALA_Y) * 180 / Math.PI;
      const selisih = Math.abs((((s.arah - arahPindah) % 360) + 540) % 360 - 180);
      if (selisih > ARAH_MAKS) return "arah";
    }
  }
  // Terlalu jauh untuk ditempuh dari kecepatan sebelumnya. Hanya bila kecepatan
  // hitung sampel sebelumnya diketahui (jedanya juga ≤ GERAK_DT).
  if (prev.vi != null &&
      jarak > jarakTerjauh(Math.max(prev.speed, prev.vi) / 3.6, v1, dt) + TEMPUH_TOL) return "tempuh";
  return null;
}

/* Pembacaan yang tidak masuk akal dibuang sebelum sempat menuduh siapa pun.
   Alasannya sama dengan tab "Ditolak" di halaman.

   Sejak versi 11 mengembalikan ALASAN penolakan (teks pendek untuk log), atau
   null bila sah. Untuk sampel sah, `s.vi` diisi kecepatan hitungnya (km/jam,
   jarak ÷ waktu dari sampel sah sebelumnya) bila jedanya ≤ GERAK_DT — dipakai
   aturan tempuh pada sampel berikutnya.

   `mentah` = [t, lat, lon] pesan tepat sebelumnya bila pesan itu DITOLAK (versi
   11). Pembanding sah `prev` bisa sudah berumur menit-menit, sedangkan aturan
   diam hanya menilai jeda ≤ JEDA_PENDEK; pesan ngawur yang posisinya membeku
   datang berderet tiap 10 detik, jadi dibanding sesamanya ia tetap ketahuan. */
function sampelSah(s, prev, nowDetik, mentah = null) {
  s.vi = null;
  if (!koordSah(s.lat, s.lon)) return "koordinat";
  if (!dalamWilayah(s.lat, s.lon)) return "wilayah";
  if (!Number.isFinite(s.speed) || s.speed < 0 || s.speed > KEC_MAKS) return "kecepatan";
  if (s.sat != null && s.sat < MIN_SATELIT) return "satelit";
  if (nowDetik - s.t > UMUR_MAKS) return "basi";
  if (mentah && s.speed >= KEC_CEK) {
    const dtm = s.t - mentah[0];
    if (dtm > 0 && dtm <= JEDA_PENDEK &&
        haversine(mentah[1], mentah[2], s.lat, s.lon) + DIAM_TOL < jarakTerdekat(s.speed / 3.6, dtm)) return "diam";
  }
  if (prev) {
    const dt = s.t - prev.t;
    if (dt <= 0) return "urutan";
    if (koordSah(prev.lat, prev.lon)) {
      const jarak = haversine(prev.lat, prev.lon, s.lat, s.lon);
      if (dt <= LOMPAT_DT && jarak > LOMPAT_M) return "lompat";
      if ((jarak / dt) * 3.6 > KEC_MAKS) return "lompat";
      const g = cekGerak(s, prev, dt, jarak);
      if (g) return g;
      if (dt <= GERAK_DT) s.vi = Math.round((jarak / dt) * 36) / 10;
    }
  }
  return null;
}

/* Versi 14: membuka kejadian IDEMPOTEN. INSERT hanya bila belum ada baris
   dengan unit dan `mulai` yang sama — syaratnya di dalam pernyataan itu sendiri,
   dan D1 menjalankan pernyataan satu per satu, jadi dua pemanggilan yang
   berbarengan pun tidak bisa sama-sama menulis. Nomor barisnya dibaca di batch
   yang sama. Tidak bergantung pada indeks unik: tetap benar walau indeks itu
   belum ada atau gagal dibuat.

   Mengembalikan baris yang dipakai { id, kecepatan_max, lat, lon } dan `baru`
   = baris itu dibuat oleh panggilan ini.

   Versi 15 (§17 butir 79): kejadian yang TERBELAH. Bila pemanggilan terhenti
   sesudah membuka kejadian, atau dua pemanggilan bekerja di atas state yang sama,
   baris pembukanya tertinggal "berjalan" tanpa pemilik, dan state yang meneruskan
   membuka kejadian kedua dengan waktu mulai lain — satu ngebut tercatat dua.
   Karena itu, sebelum membuat baris baru, dicari baris unit yang SAMA dengan
   batas yang sama yang masih berjalan, dimulai paling lama sejam sebelumnya dan
   berakhir paling lama 25 detik sebelum kejadian ini dimulai (atau sesudahnya).
   Bila ada, baris itu yang diteruskan (`terus`), tidak dibuat baris baru.

   Kenapa 25 detik: dengan cek tiap 10 detik, kejadian sungguhan yang ditutup lalu
   dibuka lagi butuh paling sedikit dua sampel di bawah batas di antaranya — jeda
   dari sampel terakhir kejadian lama ke sampel pertama kejadian baru paling
   sedikit tiga selang, ±30 detik (±24 detik bila jatuh di selang pendek awal blok
   A). Di bawah itu dua baris praktis pasti satu kejadian. Diukur di simulator
   (pemanggilan dimatikan sesudah membuka kejadian, 16 skenario, dinilai dari
   pesan GPS sebenarnya): dengan jendela 60 detik, 16 dari 181 penyatuan ternyata
   menyatukan dua kejadian — unitnya sempat berhenti di sela yang tidak terlihat
   state ini; dengan 25 detik, 1 dari 158. Pasangan dengan sela lebih panjang
   dibiarkan dua baris seperti versi 14, termasuk unit yang jarang mengirim posisi.

   Pada jalan normal syarat itu tidak boleh terpenuhi: state yang membuka
   kejadian baru tidak memegang kejadian lain unit itu, dan kejadian yang ia tutup
   karena unitnya melambat sudah tersimpan berjalan=0 sebelum pembukaan berikutnya
   (tutup butuh dua sampel di bawah batas, buka dua sampel di atasnya — selalu
   melewati akhir blok). Satu-satunya penutupan yang bisa masih tertunda di blok
   yang sama adalah pindah ruas: satu sampel jatuh di ruas berbatas lain (atau di
   luar ruas), kejadian ditutup, dan sampel berikutnya di ruas semula langsung
   membuka kejadian baru berbatas sama — sementara barisnya di D1 masih
   berjalan=1 karena penutupannya baru ditulis di akhir blok. Versi 14 mencatatnya
   dua baris; agar tetap begitu (dan tidak bergantung pada letak sampel di blok),
   penutupan tertunda milik unit itu sendiri (`kecuali`, dari tutupSendiri())
   dikecualikan. Temuan tinjauan terpisah 24 Oktober 2026: tanpa pengecualian ini
   simpang RD_Harmoni (30) ↔ ujung RD_Atom (35) memberi satu baris atau dua
   tergantung waktu pesan. Baris yang masih berjalan tanpa dipegang state ini
   hanya ada bila ada yang putus atau berbarengan. Baris dengan unit dan `mulai`
   yang sama (versi 14) tetap didahulukan. Semua di satu batch, jadi pemeriksaan
   dan INSERT melihat keadaan tabel yang sama. */
const TERUSKAN_DT_MS = 25000;      // baris lama berakhir paling lama 25 dtk sebelum kejadian baru
const TERUSKAN_MAKS_MS = 3600000;  // dan dimulai paling lama sejam sebelumnya

/* Waktu mulai (ms) kejadian unit ini yang DITUTUP di blok ini tetapi penutupannya
   belum ditulis (masih di `tunda`). */
function tutupSendiri(tunda, unitId) {
  const out = [];
  if (tunda) for (const t of tunda.values()) {
    if (t.tutup && t.ev && String(t.unitId) === String(unitId)) out.push(t.ev.tStart * 1000);
  }
  return out;
}

/* Kecuali state ini sendiri sudah MELIHAT unit itu melambat di antaranya: dua
   sampel sah terakhir sebelum kejadian baru sama-sama ≤ batas − HISTERESIS —
   cukup untuk menutup kejadian lama menurut aturan tutup. Baris yang berakhir
   sebelum sampel pertama dari keduanya adalah kejadian lain, jadi tidak
   diteruskan. Mengembalikan batas bawah `selesai` (ms) yang masih boleh
   diteruskan karena hal itu. (Kecepatan mentah, bukan median tiga: buffer state
   hanya empat sampel. Diuji di simulator terhadap rujukan tanpa gangguan.) */
function batasTeruskan(ev, buf) {
  const sebelum = (buf || []).filter((x) => x.t < ev.tStart);
  if (sebelum.length < KONFIRMASI) return 0;
  const akhir = sebelum.slice(-KONFIRMASI);
  return akhir.every((x) => x.speed <= ev.batas - HISTERESIS) ? akhir[0].t * 1000 : 0;
}

async function bukaPelanggaran(env, u, ev, buf = null, kecuali = null) {
  const mulai = ev.tStart * 1000;
  const syaratTerus =
    `unit_id = ? AND batas = ? AND berjalan = 1 AND mulai < ? AND mulai >= ? AND selesai >= ?
     AND mulai NOT IN (SELECT value FROM json_each(?))`;
  const ikatTerus = [u.id, ev.batas, mulai, mulai - TERUSKAN_MAKS_MS,
                     Math.max(mulai - TERUSKAN_DT_MS, batasTeruskan(ev, buf)),
                     JSON.stringify(kecuali || [])];
  const [lama, isi, ada] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, mulai, selesai, kecepatan_max, kecepatan_rata, sampel, lat, lon
         FROM pelanggaran WHERE ${syaratTerus} ORDER BY mulai DESC, id DESC LIMIT 1`
    ).bind(...ikatTerus),
    env.DB.prepare(
      `INSERT INTO pelanggaran
         (unit_id, unit, tanggal, mulai, selesai, kecepatan_max, kecepatan_rata,
          sampel, batas, ruas, ruas_dekat, jarak_ruas, lat, lon, berjalan)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,1
        WHERE NOT EXISTS (SELECT 1 FROM pelanggaran WHERE unit_id = ? AND mulai = ?)
          AND NOT EXISTS (SELECT 1 FROM pelanggaran WHERE ${syaratTerus})`
    ).bind(u.id, u.nama, tanggalWIT(mulai), mulai, ev.tEnd * 1000,
           ev.maxSpeed, ev.sum / ev.n, ev.n, ev.batas, ev.ruas, ev.ruasDekat, ev.jarak,
           ev.lat, ev.lon, u.id, mulai, ...ikatTerus),
    env.DB.prepare(
      `SELECT id, kecepatan_max, lat, lon FROM pelanggaran
        WHERE unit_id = ? AND mulai = ? ORDER BY id LIMIT 1`
    ).bind(u.id, mulai),
  ]);
  const b = ada && ada.results && ada.results[0];
  if (b) {
    b.baru = Number(isi?.meta?.changes || 0) > 0;
    return b;
  }
  const t = lama && lama.results && lama.results[0];
  if (!t) throw new Error("baris kejadian tidak terbaca sesudah dibuka");
  t.baru = false;
  t.terus = true;
  return t;
}

/* Versi 15: kejadian ini meneruskan baris `b` yang tertinggal berjalan (lihat
   bukaPelanggaran). Waktu mulainya mundur ke baris itu, kecepatan tertinggi
   (dengan posisinya) diambil yang terbesar. Bila baris itu berakhir SEBELUM
   sampel pertama kejadian ini, sampelnya pasti lain, jadi jumlah dan rata-ratanya
   digabung; bila tumpang tindih, sampel yang sama bisa terhitung dua kali, jadi
   yang dipakai hanya milik state ini — aturan yang sama dengan gabungBarisLama(). */
function teruskanBaris(ev, b) {
  const mulaiB = Math.round(Number(b.mulai) / 1000), selesaiB = Number(b.selesai) / 1000;
  const n = Number(b.sampel) || 0, rata = Number(b.kecepatan_rata);
  if (selesaiB < ev.tStart && n > 0 && Number.isFinite(rata)) { ev.sum += rata * n; ev.n += n; }
  gabungBarisLama(ev, b);
  if (selesaiB > ev.tEnd) ev.tEnd = selesaiB;
  if (mulaiB < ev.tStart) ev.tStart = mulaiB;
}

/* Hasil bukaPelanggaran() dipasang ke state. Dipakai pembukaan dan
   lengkapiBaris(); `tunda` boleh null (pembaruannya ditulis pemanggil). */
function pakaiBaris(tunda, u, st, b) {
  st.id = b.id;
  if (b.terus) {
    const tLama = st.ev.tStart;
    teruskanBaris(st.ev, b);
    if (tunda) {
      if (st.ev.tStart !== tLama) tunda.delete(u.id + ":" + tLama);
      tundaTulis(tunda, u.id, st.ev, false);
    }
    console.log(`kejadian unit=${u.id} (${u.nama}) mulai=${tLama} meneruskan #${b.id} ` +
                `(mulai=${st.ev.tStart}) yang tertinggal berjalan: tidak dibuat baris kedua`);
  } else if (!b.baru) {
    if (tunda) sudahTercatat(tunda, u, st, b); else gabungBarisLama(st.ev, b);
  }
}

/* Versi 14: baris dengan unit dan `mulai` yang sama sudah ada — kejadian ini
   pernah dibuka pemanggilan lain yang state-nya tidak tersimpan, atau yang
   berjalan berbarengan. Baris itu yang dipakai. Kecepatan tertinggi (dengan
   posisinya) diambil yang terbesar, karena baris lama bisa memuat sampel sah
   yang tidak terlihat di sini. Jumlah sampel, rata-rata, dan waktu selesai tetap
   milik state ini: sampel yang sama tidak boleh terhitung dua kali. */
function gabungBarisLama(ev, b) {
  const km = Number(b.kecepatan_max);
  if (km > ev.maxSpeed) { ev.maxSpeed = km; ev.lat = b.lat; ev.lon = b.lon; }
}

/* Dipanggil saat pembukaan menemukan baris yang sudah ada. Nilai gabungannya
   ikut pembaruan tertunda di akhir pemanggilan. Jarang — hanya sesudah
   pemanggilan yang terputus atau berbarengan — jadi dicatat sebaris sendiri. */
function sudahTercatat(tunda, u, st, b) {
  gabungBarisLama(st.ev, b);
  tundaTulis(tunda, u.id, st.ev, false);
  console.log(`kejadian unit=${u.id} (${u.nama}) mulai=${st.ev.tStart} sudah tercatat #${b.id}: ` +
              `baris itu dipakai, tidak dibuat ganda`);
}

/* Versi 14: kejadian di state tanpa nomor baris — INSERT pembukanya ditolak atau
   jawabannya hilang (barisnya bisa tersimpan, bisa tidak). Karena pembukaan kini
   idempoten, cukup dibuka ulang. Galat tidak dinaikkan: dicoba lagi pada sampel
   berikutnya, dan unit lain di putaran ini tetap diperiksa. */
async function lengkapiBaris(env, u, st, tunda = null) {
  try {
    const b = await bukaPelanggaran(env, u, st.ev, st.buf, tutupSendiri(tunda, u.id));
    /* Pemanggil menulis pembaruan sesudahnya. Bila baris diteruskan, kunci tunda
       lama (waktu mulai sebelum mundur) dibuang lewat `tunda`. */
    pakaiBaris(null, u, st, b);
    if (b.terus && tunda) {
      for (const [k, t] of tunda) if (t.ev === st.ev && k !== u.id + ":" + st.ev.tStart) tunda.delete(k);
    }
  } catch (e) {
    console.log(`kejadian unit=${u.id} (${u.nama}) belum punya baris, dicoba lagi nanti: ${String(e.message || e)}`);
  }
}

/* Versi 14: baris dikenali dari (unit_id, mulai) — kunci yang sama dengan
   pembukaan — bukan dari nomor baris. Batas dan ruas tempat kejadian dinilai
   ikut ditulis: biasanya nilainya sama dengan saat dibuka, tetapi bila baris itu
   dibuat pemanggilan lain yang terputus, sampel pembukanya bisa jatuh di ruas
   lain — dan yang berlaku adalah penilaian state yang meneruskannya. */
function perintahPerbarui(env, unitId, ev, tutup) {
  return env.DB.prepare(
    `UPDATE pelanggaran SET selesai=?, kecepatan_max=?, kecepatan_rata=?,
       sampel=?, lat=?, lon=?, berjalan=?, batas=?, ruas=?, ruas_dekat=?, jarak_ruas=?
     WHERE unit_id=? AND mulai=?`
  ).bind(ev.tEnd * 1000, ev.maxSpeed, ev.sum / ev.n, ev.n, ev.lat, ev.lon, tutup ? 0 : 1,
         // `?? null`: D1 menolak undefined, dan satu nilai yang ditolak menggagalkan seluruh batch.
         ev.batas ?? null, ev.ruas ?? null, ev.ruasDekat ?? null, ev.jarak ?? null, unitId, ev.tStart * 1000);
}

/* Pembaruan baris pelanggaran DITUNDA sampai akhir pemanggilan (§21.9).

   Selama sebuah unit melanggar, versi sebelumnya menulis ulang barisnya pada
   tiap putaran — enam kali per menit per unit — padahal nilai yang ditulis
   sudah diperbarui di memori dan hanya keadaan TERAKHIR yang berarti. Enam
   putaran berbagi satu anggaran CPU 10 ms, jadi penulisan berulang itulah yang
   paling besar memakannya.

   Kuncinya kejadian (unit + waktu mulai), bukan nomor unit: satu unit bisa
   menutup satu kejadian lalu membuka kejadian baru dalam menit yang sama, dan
   keduanya harus tetap tertulis masing-masing. (Sampai versi 13 kuncinya nomor
   baris; sejak versi 14 baris dikenali dari unit dan waktu mulainya.) Nilai yang
   disimpan adalah RUJUKAN ke objek `ev`, jadi kejadian yang masih berjalan
   otomatis terbawa nilai terbarunya saat disiram; kejadian yang sudah ditutup
   tidak berubah lagi.

   INSERT pembuka TIDAK ditunda: kejadian harus sudah tercatat walau pemanggilan
   ini terhenti sebelum batch akhirnya. Sejak versi 14 pembukaan itu idempoten,
   jadi pemanggilan berikutnya yang membukanya lagi memakai baris yang sama. */
function tundaTulis(tunda, unitId, ev, tutup) {
  if (unitId == null || !ev) return;
  tunda.set(unitId + ":" + ev.tStart, { unitId, ev, tutup });
}

/* State dibaca sekali di awal pemanggilan dan ditulis sekali di akhir. Membaca
   lalu menulis ulang ±25 KB JSON pada tiap putaran menghabiskan anggaran CPU
   10 ms sebelum enam putaran selesai.

   Galat baca D1 SENGAJA dibiarkan naik. Versi 5 membungkus pembacaan ini di
   dalam try, sehingga saat kuota baca habis state dianggap kosong: cron lalu
   berjalan tanpa ingatan dan bisa menimpa state tersimpan, dan kejadian yang
   sedang terbuka tidak pernah ditutup. Yang boleh jatuh ke kosong hanya isi
   yang rusak, bukan pembacaan yang gagal. */
function uraiState(teks) {
  let simpan = {};
  try { simpan = JSON.parse(teks || "{}"); } catch (e) { simpan = {}; }
  if (!simpan || typeof simpan !== "object") simpan = {};
  const obj = (x) => (x && typeof x === "object") ? x : {};
  /* `blok` dan `oleh` mencatat menit terakhir tiap blok dijalankan dan oleh
     pemicu mana — dibaca /api/status untuk memastikan ketiga pemicu hidup. */
  return { u: obj(simpan.u), blok: obj(simpan.blok), oleh: obj(simpan.oleh), jv: Number(simpan.jv) || 0 };
}
async function muatSimpanan(env) {
  return uraiState(await ambilKV(env, "state"));
}

/* Versi 15 (§17 butir 78): blok membaca state SESUDAH blok sebelumnya menyimpan.

   Tiap blok membaca state di awal jendelanya dan menulisnya di akhir. Bila blok
   sebelumnya — A sebelum B, B sebelum C, C menit lalu sebelum A — terlambat
   menyimpan (jawaban Wialon lambat, sesi basi dan login ulang), blok ini membaca
   state lama, lalu salah satu simpanan menimpa yang lain: sampel, kejadian yang
   sedang terbuka, dan hitungan konfirmasi satu blok hilang. Versi 14 hanya
   mencegah akibatnya yang paling terlihat (baris ganda).

   Sekarang: bila blok sebelumnya sudah DIKLAIM untuk menitnya (baris kv
   'blok:X') tetapi state belum mencatatnya selesai (`blok.X`), blok ini menunggu
   — memeriksa tiap TUNGGU_JEDA_MS dengan kueri kecil yang tidak membawa isi state
   — paling lama sampai TUNGGU_SIMPAN_MS sesudah awal jendelanya. Lewat dari itu
   blok berjalan dengan state yang ada, sama dengan versi 14: putaran tidak
   pernah dikorbankan untuk menunggu, paling buruk putaran pertama blok mundur
   enam detik. Blok yang tidak diklaim siapa pun, dan blok yang sudah menandai
   klaimnya gagal menyimpan (`g`, lihat jalankanBlok), tidak ditunggu. Pada jalan
   normal tidak ada tunggu sama sekali, dan klaim ikut dibaca dalam batch yang
   sama dengan state, jadi tidak ada perjalanan D1 tambahan.

   Mengembalikan state, dengan `tunggu` = lama menunggu (ms) dan `tungguSebab`. */
const TUNGGU_SIMPAN_MS = 6000;
const TUNGGU_JEDA_MS = 750;
const SEBELUM = { A: ["C", -60000], B: ["A", 0], C: ["B", 0] };
async function muatSimpananBlok(env, nama, T) {
  const [p, geser] = SEBELUM[nama];
  const Tp = T + geser;
  /* Versi 16: kunci jalan di kv ikut dibaca dalam batch yang sama (sesuaikanJalan),
     supaya versi yang dipasang /api/jalan/segarkan dipakai mulai blok ini. */
  const [rs, rk, rj] = await env.DB.batch([
    env.DB.prepare(`SELECT v FROM kv WHERE k = 'state'`),
    env.DB.prepare(`SELECT json_extract(v, '$.m') AS m, json_extract(v, '$.g') AS g FROM kv WHERE k = ? AND json_valid(v)`)
      .bind("blok:" + p),
    env.DB.prepare(KUERI_KUNCI_JALAN),
  ]);
  const jk = kunciDariBaris(rj?.results);
  let s = uraiState(rs?.results?.[0]?.v ?? null);
  s.jk = jk;
  s.tunggu = 0;
  const klaim = rk?.results?.[0];
  if (Number(s.blok[p]) === Tp || Number(klaim?.m) !== Tp) return s;
  if (Number(klaim?.g) === 1) { s.tungguSebab = "gagal-simpan"; return s; }

  const awal = Date.now(), tenggat = T + BLOK_PETA[nama].mulai + TUNGGU_SIMPAN_MS;
  // Pemicu yang datang sesudah tenggat tidak menunggu lagi; cukup dicatat di log.
  if (awal >= tenggat) { s.tungguSebab = "belum-tersimpan"; return s; }
  let sebab = "tenggat";
  while (Date.now() < tenggat) {
    await sleep(Math.min(TUNGGU_JEDA_MS, tenggat - Date.now()));
    try {
      const r = await env.DB.prepare(
        `SELECT (SELECT json_extract(v, ?) FROM kv WHERE k = 'state' AND json_valid(v)) AS b,
                (SELECT json_extract(v, '$.g') FROM kv WHERE k = ? AND json_valid(v)) AS g`
      ).bind("$.blok." + p, "blok:" + p).first();
      if (Number(r?.b) === Tp) { sebab = "tersimpan"; break; }
      if (Number(r?.g) === 1) { sebab = "gagal-simpan"; break; }
    } catch (e) { sebab = "galat"; break; }
  }
  s = await muatSimpanan(env);
  s.jk = jk;
  s.tunggu = Date.now() - awal;
  s.tungguSebab = Number(s.blok[p]) === Tp ? "tersimpan" : sebab;
  return s;
}

/* Satu putaran pemeriksaan seluruh armada. `state` dibawa masuk dan diubah di
   tempat; pemanggilnya yang bertanggung jawab menyimpannya.

   `kering` (versi 15, /api/uji): penilaian sama persis, tetapi tidak ada yang
   ditulis — tidak membuka baris pelanggaran dan tidak menandai sensor mesin —
   supaya uji dari luar tidak pernah berebut state atau tabel dengan cron. */
async function satuPutaran(env, state, tunda, jejak = null, T0 = 0, kering = false) {
  const units = await ambilUnit(env, false);
  const nowDetik = Math.floor(Date.now() / 1000);
  const lengkapi = kering ? async () => {} : (u, st) => lengkapiBaris(env, u, st, tunda);

  let sah = 0, ditolak = 0, basi = 0, melanggar = 0;
  const alasan = {};   // jumlah penolakan per alasan (versi 11)

  for (const u of units) {
    const k = String(u.id);
    if (!state[k]) state[k] = { t: 0, sah: null, buf: [], ov: 0, un: 0, ev: null, id: null };
    const st = state[k];
    // Hitungan "bergerak dengan mesin mati" hanya berlaku sejam (versi 13).
    if (st.mk && nowDetik - st.mk[0] >= MESIN_JENDELA) st.mk = undefined;

    if (u.waktu == null) continue;
    const t = Math.floor(u.waktu / 1000);
    if (t === st.t) continue;            // pesan yang sama, bukan data baru
    st.t = t;

    if (nowDetik - t > UMUR_MAKS) { basi++; continue; }
    if (koordSah(u.lat, u.lon)) catatJejak(jejak, T0, u, t);

    const s = { t, lat: u.lat, lon: u.lon, speed: u.kecepatan ?? 0, sat: u.satelit, arah: u.arah };
    let tolak = sampelSah(s, st.sah, nowDetik, st.m);
    /* Versi 13: lolos semua aturan gerak, tetapi sensor mesin melapor MATI —
       pembacaan ≥ 15 km/jam dari mesin yang mati tidak sah. Hanya dinilai sesudah
       aturan gerak, jadi alasan "mesin" menandai bacaan yang HANYA tertangkap
       aturan ini. Sensor yang terus melapor mati padahal unitnya bergerak wajar
       (≥ MESIN_CURIGA bacaan dalam sejam) dianggap macet dan diabaikan 3 hari,
       supaya pelanggaran sungguhan unit itu tidak ikut hilang. */
    if (!tolak && u.mesin === false && s.speed >= KEC_CEK) {
      tolak = "mesin";
      if (!st.mk) st.mk = [nowDetik, 0];
      if (++st.mk[1] >= MESIN_CURIGA && !kering) {
        MESIN.x[k] = mesinUbah.x[k] = nowDetik + MESIN_ABAIKAN;
        st.mk = undefined;
        console.log(`mesin unit=${k} (${u.nama}) sensornya diabaikan 3 hari: ` +
                    `${MESIN_CURIGA} bacaan bergerak wajar dengan mesin mati dalam sejam`);
      }
    }
    if (tolak) {
      ditolak++; alasan[tolak] = (alasan[tolak] || 0) + 1;
      // Pesan yang ditolak menjadi pembanding `mentah` bagi pesan berikutnya.
      // Hanya disimpan selama deret tolak berjalan, supaya state tetap kecil.
      if (koordSah(s.lat, s.lon)) st.m = [s.t, s.lat, s.lon];
      continue;
    }
    sah++;
    st.sah = { t: s.t, lat: s.lat, lon: s.lon, speed: s.speed };
    // Kecepatan hitung ikut disimpan hanya bila diketahui, supaya state tetap kecil.
    if (s.vi != null) st.sah.vi = s.vi;
    if (st.m) st.m = undefined;   // tidak ikut tersimpan (JSON melewati undefined)

    st.buf.push({ t: s.t, lat: s.lat, lon: s.lon, speed: s.speed });
    if (st.buf.length > 4) st.buf.shift();

    const tiga = st.buf.slice(-3).map((x) => x.speed);
    const nilai = tiga.length >= 3 ? median(tiga) : s.speed;

    /* Pencocokan ruas hanya dijalankan bila kecepatan sudah melewati batas
       TERENDAH yang ada di tabel. Di bawah angka itu tidak ada ruas mana pun
       yang bisa dilanggar, jadi unit yang sedang parkir, memuat, atau merayap
       tidak perlu dicari ruasnya sama sekali. Ini yang menjaga anggaran CPU. */
    const rz = nilai > BATAS_MIN ? cariRuas(s.lat, s.lon) : null;

    /* Kalau unit berpindah ke ruas dengan batas berbeda selagi pelanggaran
       berjalan, kejadiannya ditutup dan hitungan dimulai ulang. Satu baris
       pelanggaran harus terikat pada satu ruas dan satu angka batas, kalau tidak
       catatannya tidak bisa dipertanggungjawabkan. */
    if (st.ev && rz && st.ev.batas !== rz.batas) {
      if (st.id == null) await lengkapi(u, st);
      tundaTulis(tunda, u.id, st.ev, true);
      st.ev = null; st.id = null; st.un = 0; st.ov = 0;
    }

    if (rz && nilai > rz.batas) {
      st.ov++; st.un = 0;
      if (!st.ev && st.ov >= KONFIRMASI) {
        // Dibuka mundur ke sampel pertama yang melewati batas, supaya waktu
        // mulai dan kecepatan puncaknya tidak terpotong.
        const awal = st.buf.slice(-st.ov)[0] || s;
        /* Di luar ruas, pelanggaran tetap diberi nama ruas terdekat supaya bisa
           diperingkat. Kolom `ruas` sendiri dibiarkan kosong — itu yang menandai
           bahwa penilaiannya memakai batas luar, bukan batas sebuah ruas. */
        const dk = rz.nama ? { nama: rz.nama, jarak: 0 } : ruasTerdekat(awal.lat, awal.lon);
        st.ev = { tStart: awal.t, tEnd: s.t, maxSpeed: 0, sum: 0, n: 0,
                  lat: awal.lat, lon: awal.lon, batas: rz.batas, ruas: rz.nama,
                  ruasDekat: dk.nama, jarak: dk.jarak, nama: u.nama };
        for (const x of st.buf.slice(-st.ov)) {
          st.ev.maxSpeed = Math.max(st.ev.maxSpeed, x.speed);
          st.ev.sum += x.speed; st.ev.n++;
        }
        /* Versi 14: idempoten — baris yang sudah ada dipakai, bukan dibuat ganda.
           Galat D1 atau jawaban yang hilang tidak lagi menghentikan putaran untuk
           unit-unit berikutnya: kejadian tetap di state tanpa nomor baris dan
           dilengkapi lengkapiBaris() pada sampel berikutnya. Versi 15: baris yang
           tertinggal berjalan dari kejadian yang sama diteruskan (pakaiBaris). */
        if (!kering) {
          try {
            pakaiBaris(tunda, u, st, await bukaPelanggaran(env, u, st.ev, st.buf, tutupSendiri(tunda, u.id)));
          } catch (e) {
            console.log(`kejadian unit=${u.id} (${u.nama}) belum punya baris, dicoba lagi nanti: ${String(e.message || e)}`);
          }
        }
        melanggar++;
      } else if (st.ev) {
        st.ev.tEnd = s.t;
        if (s.speed >= st.ev.maxSpeed) { st.ev.lat = s.lat; st.ev.lon = s.lon; }
        st.ev.maxSpeed = Math.max(st.ev.maxSpeed, s.speed);
        st.ev.sum += s.speed; st.ev.n++;
        if (st.id == null) await lengkapi(u, st);
        tundaTulis(tunda, u.id, st.ev, false);
        melanggar++;
      }
    } else {
      st.ov = 0;
      if (st.ev && nilai <= st.ev.batas - HISTERESIS) {
        st.un++;
        if (st.un >= KONFIRMASI) {
          if (st.id == null) await lengkapi(u, st);
          tundaTulis(tunda, u.id, st.ev, true);
          st.ev = null; st.id = null; st.un = 0;
        }
      }
    }
  }

  // Kejadian yang menggantung karena unitnya berhenti mengirim data ditutup,
  // supaya tidak selamanya berstatus sedang berlangsung.
  for (const k of Object.keys(state)) {
    const st = state[k];
    if (st.ev && nowDetik - st.ev.tEnd > 900) {
      /* Versi 14: kejadian yang belum punya baris dibuka dulu (idempoten), supaya
         tidak hilang saat ditutup. Nama unit dari daftar putaran ini, atau — bila unit
         itu sudah tidak ada di daftar Wialon — nama yang dicatat saat kejadian dibuka. */
      if (st.id == null) {
        await lengkapi(units.find((x) => String(x.id) === k) || { id: Number(k), nama: st.ev.nama ?? null }, st);
      }
      tundaTulis(tunda, Number(k), st.ev, true);
      st.ev = null; st.id = null; st.ov = 0; st.un = 0;
    }
  }

  return { unit: units.length, sah, ditolak, basi, melanggar, alasan };
}

/* Dipakai /api/uji. Sampai versi 14 ini satu putaran lengkap berikut baca dan
   TULIS state, di luar klaim blok — jadi bisa berbarengan dengan cron dan
   menimpa state-nya (§17 butir 80; simulasi v14: 5 pasangan ganda). Sejak versi
   15 putarannya KERING: state dibaca dan dinilai seperti cron, hasilnya
   dikembalikan, tetapi tidak ada yang disimpan dan tidak ada baris yang dibuka.
   Tidak dipakai halaman mana pun; tetap ada untuk memeriksa Worker dari luar. */
async function periksa(env) {
  const s = await muatSimpanan(env);
  await sesuaikanJalan(env, s);
  await muatMesin(env);
  const h = await satuPutaran(env, s.u, new Map(), null, 0, true);
  h.kering = true;
  h.catatan = "uji kering: dinilai dari state cron, tidak ada yang disimpan; " +
              "`melanggar` = pembacaan yang melewati batas di putaran ini";
  return h;
}

// ------------------------------------------------- pembagian menit (§21.11)

const tidurSampai = async (t) => {
  const d = t - Date.now();
  if (d > 0) await sleep(d);
};

/* Klaim atomik: berhasil hanya bila blok itu belum diklaim untuk menit `m`.
   Dua pemanggilan yang berebut blok yang sama — pemilik yang terlambat dan A
   yang mengambil alih, atau dua pemicu yang kebetulan dipetakan ke blok yang
   sama — tidak mungkin sama-sama menang, karena SQLite menjalankan upsert ini
   sebagai satu langkah. */
function perintahKlaim(env, nama, m, oleh, cron) {
  return env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v
       WHERE json_extract(kv.v, '$.m') IS NOT json_extract(excluded.v, '$.m')`
  ).bind("blok:" + nama, JSON.stringify({ m, o: oleh, c: cron ?? null }));
}
const menang = (r) => Number(r?.meta?.changes || 0) > 0;

/* Versi 15: A mencoba mengklaim blok `nama` sesaat sebelum jendelanya. Galat D1
   dianggap kalah: pemicu lain yang datang sesudahnya masih bisa mengklaimnya. */
const AMBIL_ALIH_MS = 2000;
async function ambilAlih(env, nama, T, cron) {
  await tidurSampai(T + BLOK_PETA[nama].mulai - AMBIL_ALIH_MS);
  try { return menang(await perintahKlaim(env, nama, T, "A", cron).run()); }
  catch (e) { console.log(`blok=${nama} klaim ambil alih gagal: ${String(e.message || e)}`); return false; }
}

/* Pembaruan pelanggaran yang tertunda, sebagai daftar perintah — supaya bisa
   dikirim dalam SATU batch bersama penyimpanan state dan klaim blok. */
function ambilPerintahTunda(env, tunda) {
  const perintah = [];
  for (const t of tunda.values()) perintah.push(perintahPerbarui(env, t.unitId, t.ev, t.tutup));
  tunda.clear();
  return perintah;
}

function perintahSimpanState(env, s, jumlahUnit) {
  return env.DB.prepare(
    `INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`
  ).bind("state", JSON.stringify({
    u: s.u, cek: Date.now(), jumlah: jumlahUnit, blok: s.blok, oleh: s.oleh, jv: JALAN.versi || s.jv || 0,
  }));
}

/* Versi 15: klaim blok `nama` menit T ditandai selesai TANPA simpanan (`g`) —
   batch akhirnya ditolak D1, atau blok itu dilewati karena state tidak terbaca —
   supaya blok berikutnya tidak menunggu sampai tenggat untuk simpanan yang tidak
   akan datang. Klaim menit berikutnya menimpa seluruh isi baris, jadi tanda ini
   hilang sendiri. Bila penulisan ini pun gagal, penunggu berhenti di tenggat. */
async function tandaiTanpaSimpan(env, nama, T) {
  try {
    await env.DB.prepare(
      `UPDATE kv SET v = json_set(v, '$.g', 1) WHERE k = ? AND json_valid(v) AND json_extract(v, '$.m') = ?`
    ).bind("blok:" + nama, T).run();
  } catch (e) { /* tenggat tetap berlaku */ }
}

const ULANG_SIMPAN_MS = 500;      // jeda sebelum batch akhir blok yang ditolak dicoba lagi

/* Dua putaran satu blok, dengan state `s` yang dibawa masuk.

   Semua penulisan akhir blok — pembaruan pelanggaran, jalan versi baru (blok A),
   jejak, dan penyimpanan state — dikirim dalam SATU batch D1. Satu batch adalah
   satu transaksi: state dan baris pelanggaran tidak pernah tersimpan setengah.
   Sejak versi 15 state SELALU disimpan di akhir blok (versi 14 melewatinya bila
   A memikul B dan C sekaligus), karena blok berikutnya bisa dijalankan pemanggilan
   lain yang menunggu simpanan ini (muatSimpananBlok). Klaim ambil alih tidak lagi
   ikut batch ini (lihat scheduled). Mengembalikan true bila batch tersimpan. */
async function jalankanBlok(env, nama, T, oleh, s, { jalan = [] } = {}) {
  const b = BLOK_PETA[nama];
  const tunda = new Map();
  const jejak = new Map();
  const deretSah = [], deretTolak = [], gagal = [];
  const alasan = {};
  let langgar = 0, unit = 0;

  for (let i = 0; i < PUTARAN_PER_BLOK; i++) {
    await tidurSampai(T + b.mulai + i * TICK_MS);
    try {
      const h = await satuPutaran(env, s.u, tunda, jejak, T);
      unit = h.unit;
      deretSah.push(h.sah); deretTolak.push(h.ditolak);
      langgar += h.melanggar;
      for (const k in h.alasan) alasan[k] = (alasan[k] || 0) + h.alasan[k];
    } catch (e) {
      deretSah.push("x"); deretTolak.push("x");
      gagal.push(`${i + 1}: ${String(e.message || e)}`);
    }
  }

  s.blok[nama] = T;
  s.oleh[nama] = oleh;
  if (unit) s.jumlah = unit;

  const perintah = ambilPerintahTunda(env, tunda);
  const ditulis = perintah.length;
  perintah.push(...jalan);
  const pj = perintahJejak(env, T, nama, jejak);
  if (pj) perintah.push(pj);
  perintah.push(perintahSimpanState(env, s, s.jumlah || 0));

  /* Versi 15: batch yang ditolak dicoba SEKALI lagi sesudah jeda singkat. Sejak
     blok dibagi ke beberapa pemanggilan, blok berikutnya memuat state dari D1 —
     simpanan yang gagal berarti sampel blok ini hilang baginya (versi 14 membawa
     state di memori karena satu pemanggilan memikul semua blok). Semua pernyataan
     di sini idempoten (pembaruan berkunci unit + mulai, upsert state, jejak, dan
     jalan), jadi mengulang potongan yang mungkin sebenarnya sudah tersimpan tidak
     mengubah hasil — selama ulangannya mendarat sebelum blok berikutnya menyimpan.
     Bila ulangan itu tertahan lama (D1 lambat ±20 detik) dan mendarat sesudahnya,
     simpanan blok berikutnya tertimpa; tabel tetap utuh (tidak ada baris yatim
     atau bertumpang), hanya sampel blok mana yang hilang yang tertukar (diuji di
     simulator tinjauan terpisah). */
  let tersimpan = true;
  const ulang = [];
  for (let i = 0; i < perintah.length && tersimpan; i += 50) {
    const potong = perintah.slice(i, i + 50);
    try {
      await env.DB.batch(potong);
    } catch (e) {
      await sleep(ULANG_SIMPAN_MS);
      try {
        await env.DB.batch(potong);
        ulang.push(String(e.message || e));     // pulih: dicatat terpisah dari "gagal"
      } catch (e2) {
        gagal.push(`tulis: ${String(e2.message || e2)}`);
        tersimpan = false;
      }
    }
  }
  if (!tersimpan) await tandaiTanpaSimpan(env, nama, T);
  // Sensor yang baru dicurigai macet (versi 13) — terpisah dari batch di atas.
  const gm = await simpanMesin(env);
  if (gm) gagal.push(`mesin: ${gm}`);

  /* Versi 15: lama menunggu simpanan blok sebelumnya (muatSimpananBlok), hanya
     bila memang menunggu atau blok sebelumnya belum tersimpan. Dicatat sekali:
     state yang sama dibawa A ke blok yang diambil alihnya. */
  const tunggu = s.tungguSebab ? ` tunggu=${Math.round((s.tunggu || 0) / 100) / 10}s:${s.tungguSebab}` : "";
  s.tunggu = 0; s.tungguSebab = undefined;
  const teksAlasan = Object.keys(alasan).map((k) => k + ":" + alasan[k]).join(",");
  console.log(
    `blok=${nama}${oleh !== nama ? ` oleh=${oleh}` : ""} unit=${unit} ` +
    `sah=${deretSah.join(",")} tolak=${deretTolak.join(",")} ` +
    (teksAlasan ? `alasan=${teksAlasan} ` : "") +
    `langgar=${langgar} tulis=${ditulis} jejak=${jejak.size} jalan=v${JALAN.versi}${tunggu}` +
    (ulang.length ? ` | tulis diulang dan berhasil (${ulang.join(" ; ")})` : "") +
    (gagal.length ? ` | gagal ${gagal.join(" ; ")}` : "")
  );
  return tersimpan;
}

async function bersihkan(env) {
  const batas = tanggalWIT(Date.now() - SIMPAN_HARI * 86400000);
  await env.DB.prepare(`DELETE FROM pelanggaran WHERE tanggal < ?`).bind(batas).run();

  // Jejak GPS lebih tua dari JEJAK_HARI. Kunci berawalan "jejak:" + epoch ms
  // 13 digit, jadi urutan teks sama dengan urutan waktu dan indeks kunci utama
  // kv dipakai — tidak memindai baris lain.
  await env.DB.prepare(`DELETE FROM kv WHERE k >= 'jejak:' AND k < ?`)
    .bind("jejak:" + (Date.now() - JEJAK_HARI * 86400000)).run();

  /* Kejadian yatim: masih berstatus berjalan padahal tidak diperbarui lebih dari
     satu jam, karena state yang memegangnya hilang. Tanpa ini ia tampil
     "sedang berlangsung" selamanya. Hanya tiga hari terakhir yang diperiksa
     supaya kueri berjalan di indeks tanggal, bukan memindai seluruh tabel. */
  await env.DB.prepare(
    `UPDATE pelanggaran SET berjalan = 0
      WHERE tanggal >= ? AND berjalan = 1 AND selesai < ?`
  ).bind(tanggalWIT(Date.now() - 3 * 86400000), Date.now() - YATIM_MS).run();
}

/* Ringkasan shift untuk kartu di halaman Home: lima unit dan lima ruas yang
   paling sering melanggar, jumlah kejadian, dan kecepatan tertinggi.

   Versi 5 menjalankan tiga kueri — per unit, per ruas, dan total — yang
   masing-masing memindai seluruh tabel. Sekarang satu kueri mengelompokkan per
   pasangan (unit, ruas) di jendela shift lewat indeks `mulai`, lalu dua peringkat
   dan totalnya dirakit di sini. Jumlah pasangan kecil (paling banyak jumlah unit
   kali jumlah ruas), jadi perakitan ini murah. */
async function hitungRingkas(env, j) {
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(unit, ''), ?) AS u,
            COALESCE(NULLIF(ruas, ''), NULLIF(ruas_dekat, ''), ?) AS r,
            COUNT(*) AS jumlah, MAX(kecepatan_max) AS maks
       FROM pelanggaran
      WHERE mulai >= ? AND mulai < ?
      GROUP BY u, r`
  ).bind("Tanpa nama", "Tanpa nama", j.mulai, j.selesai).all();

  const perUnit = new Map(), perRuas = new Map();
  let total = 0;
  const tambah = (peta, nama, n, m) => {
    const a = peta.get(nama) || { nama, jumlah: 0, maks: 0 };
    a.jumlah += n;
    a.maks = Math.max(a.maks, m || 0);
    peta.set(nama, a);
  };
  for (const x of results || []) {
    total += x.jumlah;
    tambah(perUnit, x.u, x.jumlah, x.maks);
    tambah(perRuas, x.r, x.jumlah, x.maks);
  }
  // Urutan sama dengan versi 5 (jumlah, lalu kecepatan tertinggi). Nama dipakai
  // sebagai penentu terakhir supaya urutan yang seri tidak berganti tiap menit.
  const lima = (peta) => [...peta.values()]
    .sort((a, b) => b.jumlah - a.jumlah || b.maks - a.maks ||
                    String(a.nama).localeCompare(String(b.nama)))
    .slice(0, 5)
    .map((a) => ({ nama: a.nama, jumlah: a.jumlah, maks: Math.round((a.maks || 0) * 10) / 10 }));

  /* Batas yang ditempelkan adalah batas RESMI ruas itu menurut tabel di berkas
     ini, bukan batas yang kebetulan dipakai saat menilai. Untuk baris yang
     dinamai lewat ruas terdekat (§21.4) keduanya bisa berbeda: kejadiannya dinilai
     dengan BATAS_LUAR, sedangkan yang ditampilkan di sini adalah batas jalan yang
     namanya dipinjam. */
  const tabelBatas = {};
  for (const r of RUAS) tabelBatas[r.n] = r.b;

  return {
    shift: j.nama, tanggal: j.tanggal, mulai: j.mulai, selesai: j.selesai,
    total,
    batas_luar: BATAS_LUAR,
    unit: lima(perUnit),
    ruas: lima(perRuas).map((r) => ({
      nama: r.nama, jumlah: r.jumlah, maks: r.maks,
      batas: tabelBatas[r.nama] ?? BATAS_LUAR,
    })),
  };
}

/* Ringkasan dipakai bersama: memori isolate lebih dulu, lalu baris `kv` supaya
   isolate lain — dan tab lain — ikut memakainya. Hanya bila keduanya sudah lebih
   tua dari umur segarnya, D1 benar-benar menghitung ulang. `dihitung` ikut
   dikirim supaya jam hitungnya bisa dibaca kalau sewaktu-waktu diperlukan.

   Simpanan dikunci per jendela, bukan satu baris tunggal. Home sekarang bisa
   meminta shift berjalan ATAU rentang tanggal (§4.4), dan dua jendela yang
   berebut satu baris `kv` membuat keduanya selalu meleset — tiap permintaan
   berakhir menghitung ulang di D1, persis yang ingin dihindari simpanan ini. */
async function ringkasShift(env, j) {
  const kunci = j.mulai + "-" + j.selesai;
  const kini = Date.now();
  /* Rentang yang sudah lewat tidak berubah lagi, jadi tidak ada gunanya
     menghitung ulang tiap menit. Hanya jendela yang masih berjalan yang
     dibatasi RINGKAS_SEGAR. */
  const umur = j.selesai <= kini ? RINGKAS_TUTUP : RINGKAS_SEGAR;
  const segar = (o) => !!o && o.kunci === kunci && o.waktu <= kini && kini - o.waktu < umur;

  if (segar(ringkasMem.get(kunci))) return ringkasMem.get(kunci).isi;

  const teks = await ambilKV(env, "ringkas:" + kunci);
  let simpan = null;
  try { simpan = JSON.parse(teks || "null"); } catch (e) { simpan = null; }
  if (segar(simpan)) { ringkasMem.set(kunci, simpan); return simpan.isi; }

  const isi = await hitungRingkas(env, j);
  isi.dihitung = kini;
  const baru = { kunci, waktu: kini, isi };
  ringkasMem.set(kunci, baru);
  /* Isolate bisa hidup lama sementara jendela terus berganti; tanpa batas ini
     petanya tumbuh sepanjang umur isolate. */
  while (ringkasMem.size > RINGKAS_SIMPAN) ringkasMem.delete(ringkasMem.keys().next().value);
  await simpanKV(env, "ringkas:" + kunci, JSON.stringify(baru));
  return isi;
}

/* Jendela dari sepasang tanggal WIT, dipakai kartu Home saat periodenya
   "Kemarin" atau "Last 7 Days". Batasnya tengah malam WIT sampai tengah malam
   WIT sesudah hari terakhir, jadi cakupannya sama dengan kolom `tanggal` yang
   juga dihitung dalam WIT. */
function jendelaTanggal(dari, sampai) {
  const a = dari <= sampai ? dari : sampai;
  const b = dari <= sampai ? sampai : dari;
  const tengahMalam = (ymd) => {
    const p = String(ymd).split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) - WIT;   // 00:00 WIT dalam epoch UTC
  };
  return {
    nama: a === b ? "Harian" : "Rentang",
    tanggal: a, dari: a, sampai: b,
    mulai: tengahMalam(a),
    selesai: tengahMalam(b) + 86400000,
  };
}

/* Batas shift 06.30 dan 18.30 WIT — pergantian shift sebenarnya di site, sama
   dengan label shift di Home, Digital Twin, dan proxy Minerva (§7). 07.00/19.00
   hanya jadwal sinkronisasi Operator Performance, bukan batas shift (versi 9.1).
   Shift malam melewati tengah malam, jadi jendelanya dihitung dari jam WIT
   berjalan, bukan dari tanggal kalender. */
const MULAI_SIANG = 6.5 * 3600000;    // 06.30 WIT, dalam ms sejak tengah malam
const MULAI_MALAM = 18.5 * 3600000;   // 18.30 WIT
function jendelaShift(paksa) {
  const witMs = Date.now() + WIT;
  const wit = new Date(witMs);
  const tengahMalam = Date.UTC(wit.getUTCFullYear(), wit.getUTCMonth(), wit.getUTCDate());
  const dalamHari = witMs - tengahMalam;

  let siang = dalamHari >= MULAI_SIANG && dalamHari < MULAI_MALAM;
  if (paksa === "DS") siang = true;
  if (paksa === "NS") siang = false;

  let mulaiWit;
  if (siang) mulaiWit = tengahMalam + MULAI_SIANG;
  else if (dalamHari >= MULAI_MALAM) mulaiWit = tengahMalam + MULAI_MALAM;
  else mulaiWit = tengahMalam - 86400000 + MULAI_MALAM;      // 18.30 kemarin
  const selesaiWit = mulaiWit + 12 * 3600000;
  return {
    nama: siang ? "Siang" : "Malam",
    tanggal: tanggalWIT(mulaiWit - WIT),
    mulai: mulaiWit - WIT,                        // kembali ke epoch UTC
    selesai: selesaiWit - WIT,
  };
}

// ------------------------------------------------ hapus oleh admin (versi 12)

/* Arsip kejadian yang dihapus admin. `data` = baris asli utuh (JSON), supaya
   pemulihan tetap lengkap walau kolom tabel `pelanggaran` kelak bertambah. */
const SQL_ARSIP =
  `CREATE TABLE IF NOT EXISTS pelanggaran_dihapus (
     id INTEGER PRIMARY KEY, unit TEXT, tanggal TEXT, mulai INTEGER,
     data TEXT NOT NULL, dihapus_pada INTEGER, dihapus_oleh TEXT, alasan TEXT)`;
const KOLOM_PELANGGARAN = ["id", "unit_id", "unit", "tanggal", "mulai", "selesai",
  "kecepatan_max", "kecepatan_rata", "sampel", "batas", "ruas", "ruas_dekat",
  "jarak_ruas", "lat", "lon", "berjalan"];

/* Simpanan ringkasan Home dibuang supaya kartu Home langsung menghitung ulang.
   Kunci "ringkas:<mulai>-<selesai>"; ';' adalah huruf sesudah ':', jadi rentang
   ini tepat seluruh awalan dan berjalan di kunci utama kv. */
const perintahBuangRingkas = (env) =>
  env.DB.prepare(`DELETE FROM kv WHERE k >= 'ringkas:' AND k < 'ringkas;'`);

/* Email di dalam token login. Hanya dipakai SESUDAH Supabase menerima token itu
   (cekAdmin), jadi isinya bisa dipercaya tanpa memeriksa tanda tangannya di sini. */
function emailDariToken(t) {
  try {
    const b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const j = JSON.parse(atob(b + "===".slice((b.length + 3) % 4)));
    return String(j.email || "").toLowerCase() || "admin";
  } catch (e) {
    return "admin";
  }
}

/* Admin = daftar app_admin yang sama dengan seluruh MiningMalut. Supabase yang
   menilai tokennya; Worker hanya meneruskan pertanyaannya. */
async function cekAdmin(env, req) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/);
  if (!m) return { galat: "Masuk dulu ke MiningMalut sebagai admin.", status: 401 };
  const url = (env.SUPABASE_URL || SUPA_URL).replace(/\/+$/, "") + "/rest/v1/rpc/op_is_admin";
  const key = env.SUPABASE_ANON_KEY || SUPA_KEY;
  const opsi = {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + m[1], "Content-Type": "application/json" },
    body: "{}",
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") opsi.signal = AbortSignal.timeout(BATAS_TUNGGU_MS);
  let r;
  try { r = await fetch(url, opsi); }
  catch (e) { return { galat: "Supabase tidak terjangkau untuk memeriksa admin. Coba lagi.", status: 502 }; }
  if (r.status === 401 || r.status === 403) return { galat: "Sesi login berakhir. Muat ulang MiningMalut, masuk lagi, lalu ulangi.", status: 401 };
  if (!r.ok) return { galat: "Pemeriksaan admin gagal (HTTP " + r.status + ").", status: 502 };
  let jawab = null;
  try { jawab = await r.json(); } catch (e) {}
  if (jawab !== true) return { galat: "Hanya admin yang boleh menghapus atau memulihkan kejadian.", status: 403 };
  return { email: emailDariToken(m[1]) };
}

async function bacaJSON(req) {
  try { return (await req.json()) || {}; } catch (e) { return {}; }
}

const tanpaTabelArsip = (e) => /no such table/i.test(String((e && e.message) || e));

async function hapusKejadian(env, req) {
  if (req.method !== "POST") return json({ error: "Pakai POST." }, 405);
  const a = await cekAdmin(env, req);
  if (a.galat) return json({ error: a.galat }, a.status);
  const isi = await bacaJSON(req);
  const id = Number(isi.id);
  const alasan = String(isi.alasan || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Nomor kejadian tidak sah." }, 400);
  if (alasan.length < 5) return json({ error: "Tulis alasan penghapusan (minimal 5 huruf)." }, 400);

  const baris = await env.DB.prepare(`SELECT * FROM pelanggaran WHERE id = ?`).bind(id).first();
  if (!baris) return json({ error: "Kejadian tidak ditemukan — mungkin sudah dihapus." }, 404);
  if (Number(baris.berjalan)) return json({ error: "Kejadian ini masih berjalan. Hapus sesudah selesai." }, 409);

  const kini = Date.now();
  await env.DB.prepare(SQL_ARSIP).run();
  const hasil = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO pelanggaran_dihapus
         (id, unit, tanggal, mulai, data, dihapus_pada, dihapus_oleh, alasan)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(id, baris.unit, baris.tanggal, baris.mulai, JSON.stringify(baris), kini, a.email, alasan),
    // COALESCE: baris lama yang kolom berjalan-nya kosong (NULL) tetap ikut terhapus.
    env.DB.prepare(`DELETE FROM pelanggaran WHERE id = ? AND COALESCE(berjalan, 0) = 0`).bind(id),
    perintahBuangRingkas(env),
  ]);
  ringkasMem.clear();
  const terhapus = Number(hasil[1]?.meta?.changes || 0) > 0;
  console.log(`hapus id=${id} unit=${baris.unit} tanggal=${baris.tanggal} oleh=${a.email} alasan="${alasan}"` +
              (terhapus ? "" : " (baris sudah tidak ada)"));
  return json({ ok: true, id, unit: baris.unit, tanggal: baris.tanggal, dihapus_oleh: a.email, dihapus_pada: kini });
}

async function pulihkanKejadian(env, req) {
  if (req.method !== "POST") return json({ error: "Pakai POST." }, 405);
  const a = await cekAdmin(env, req);
  if (a.galat) return json({ error: a.galat }, a.status);
  const id = Number((await bacaJSON(req)).id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Nomor kejadian tidak sah." }, 400);

  let x = null;
  try { x = await env.DB.prepare(`SELECT data FROM pelanggaran_dihapus WHERE id = ?`).bind(id).first(); }
  catch (e) { if (!tanpaTabelArsip(e)) throw e; }
  if (!x) return json({ error: "Kejadian ini tidak ada di arsip terhapus." }, 404);
  let r = null;
  try { r = JSON.parse(x.data); } catch (e) {}
  if (!r || Number(r.id) !== id) return json({ error: "Isi arsip rusak; tidak bisa dipulihkan." }, 500);
  r.berjalan = 0;

  /* Versi 14: satu kejadian satu baris. Bila unit dan waktu mulai yang sama
     sudah tercatat — mis. salinan ganda yang dipindah sistem sementara baris
     yang disimpan masih ada — pemulihan ditolak dengan pesan yang menyebut baris
     itu. Syaratnya di dalam INSERT sendiri, jadi tetap benar walau indeks unik
     belum ada; arsip hanya dihapus bila barisnya benar-benar kembali. */
  const unitId = r.unit_id ?? null, mulai = r.mulai ?? null;
  /* Versi 15: juga ditolak bila rentang waktunya bertumpang dengan baris lain unit
     itu berbatas sama — mis. catatan terbelah yang dipindah sistem, yang rentangnya
     sudah digabung ke baris yang disimpan. Dua baris bertumpang (bahkan bersentuhan)
     untuk satu unit tidak mungkin dua kejadian, karena kejadian baru selalu mulai
     di sampel sesudah yang lama berakhir; dipulihkan, keduanya terhitung dua kali
     sampai pembersihan harian memindahkannya lagi (temuan tinjauan terpisah). */
  const batas = r.batas ?? null, selesai = r.selesai ?? null;
  const syaratTumpang = `unit_id = ? AND batas = ? AND mulai <= ? AND selesai >= ? AND id <> ?`;
  const ikatTumpang = [unitId, batas, selesai, mulai, id];
  let hasil;
  try {
    hasil = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pelanggaran (${KOLOM_PELANGGARAN.join(", ")})
         SELECT ${KOLOM_PELANGGARAN.map(() => "?").join(", ")}
          WHERE NOT EXISTS (SELECT 1 FROM pelanggaran WHERE unit_id = ? AND mulai = ?)
            AND NOT EXISTS (SELECT 1 FROM pelanggaran WHERE ${syaratTumpang})`
      ).bind(...KOLOM_PELANGGARAN.map((k) => (r[k] === undefined ? null : r[k])), unitId, mulai, ...ikatTumpang),
      env.DB.prepare(`DELETE FROM pelanggaran_dihapus WHERE id = ? AND EXISTS (SELECT 1 FROM pelanggaran WHERE id = ?)`).bind(id, id),
      perintahBuangRingkas(env),
      env.DB.prepare(`SELECT id, unit, mulai FROM pelanggaran WHERE unit_id = ? AND mulai = ? AND id <> ? ORDER BY id LIMIT 1`)
        .bind(unitId, mulai, id),
      env.DB.prepare(`SELECT id, unit, mulai, selesai FROM pelanggaran WHERE ${syaratTumpang} ORDER BY mulai, id LIMIT 1`)
        .bind(...ikatTumpang),
    ]);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e.message || e))) return json({ error: "Kejadian dengan nomor ini sudah ada di daftar." }, 409);
    throw e;
  }
  if (!(Number(hasil[0]?.meta?.changes || 0) > 0)) {
    const ada = hasil[3]?.results?.[0], tumpang = hasil[4]?.results?.[0];
    if (!ada && tumpang) {
      console.log(`pulihkan id=${id} ditolak: rentangnya dicakup kejadian #${tumpang.id} (unit dan batas sama) oleh=${a.email}`);
      return json({
        error: `Kejadian #${tumpang.id} (${tumpang.unit || r.unit || "unit ini"} · ${waktuWIT(tumpang.mulai)}–${waktuWIT(tumpang.selesai)} WIT) ` +
               `dengan batas yang sama bertumpang waktu dengan kejadian ini. Yang ini bagian dari kejadian itu, jadi tidak dipulihkan.`,
        bagian_dari: tumpang.id,
      }, 409);
    }
    if (!ada) return json({ error: "Kejadian dengan nomor ini sudah ada di daftar." }, 409);
    console.log(`pulihkan id=${id} ditolak: sama dengan kejadian #${ada.id} (unit dan waktu mulai sama) oleh=${a.email}`);
    return json({
      error: `Kejadian #${ada.id} (${ada.unit || r.unit || "unit ini"} · ${waktuWIT(ada.mulai)} WIT) sudah tercatat ` +
             `dengan unit dan waktu mulai yang sama. Yang ini salinan gandanya, jadi tidak dipulihkan.`,
      ganda_dari: ada.id,
    }, 409);
  }
  ringkasMem.clear();
  console.log(`pulihkan id=${id} unit=${r.unit} tanggal=${r.tanggal} oleh=${a.email}`);
  return json({ ok: true, id, unit: r.unit, tanggal: r.tanggal });
}

async function daftarTerhapus(env, req, url) {
  const a = await cekAdmin(env, req);
  if (a.galat) return json({ error: a.galat }, a.status);
  const sah = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");
  let dari = url.searchParams.get("dari"), sampai = url.searchParams.get("sampai");
  const tgl = url.searchParams.get("tanggal");
  if (sah(tgl)) { dari = tgl; sampai = tgl; }
  if (!sah(dari) || !sah(sampai)) return json({ error: "Pakai ?tanggal= atau ?dari=&sampai= (YYYY-MM-DD)." }, 400);
  if (dari > sampai) { const t = dari; dari = sampai; sampai = t; }
  let results = [];
  try {
    results = (await env.DB.prepare(
      `SELECT data, dihapus_pada, dihapus_oleh, alasan FROM pelanggaran_dihapus
        WHERE tanggal BETWEEN ? AND ? ORDER BY mulai DESC`
    ).bind(dari, sampai).all()).results || [];
  } catch (e) { if (!tanpaTabelArsip(e)) throw e; }
  const terhapus = [];
  for (const r of results) {
    let d = null;
    try { d = JSON.parse(r.data); } catch (e) {}
    if (d) terhapus.push(Object.assign(d, { dihapus_pada: r.dihapus_pada, dihapus_oleh: r.dihapus_oleh, alasan: r.alasan }));
  }
  return json({ dari, sampai, jumlah: terhapus.length, terhapus });
}

// ------------------------------------------- catatan ganda (versi 14)

/* Pembersihan sekali jalan: salinan ganda (unit dan `mulai` sama) dipindah ke
   arsip terhapus, lalu indeks unik dibuat — dalam SATU transaksi, jadi bila ada
   yang gagal tidak ada yang berubah setengah. Dipanggil siapkanTabel() (jalur
   HTTP, sekali per isolate) selama indeks itu belum ada; tidak pernah di putaran
   cron. Kerja Worker-nya kecil (beberapa baris JSON); memindai tabel dan
   membangun indeks dikerjakan D1.

   Baris yang DISIMPAN tiap kelompok: sampel terbanyak, lalu selesai paling akhir,
   lalu yang sudah ditutup, lalu nomor terkecil. Itulah salinan yang terus
   diperbarui state sampai kejadiannya ditutup; salinan lain membeku di nilai saat
   dibuka. Kecepatan tertinggi seluruh salinan (dengan posisinya) digabung ke baris
   yang disimpan — aturan yang sama dengan pembukaan idempoten — tetapi HANYA bila
   baris itu sudah ditutup, atau lebih dari sejam tidak diperbarui (sekalian
   ditutup seperti kejadian yatim). Baris yang masih berjalan dibiarkan: pembaruan
   cron berikutnya menimpanya juga. Nilai sebelum digabung disimpan di baris kv
   'ganda' (`sebelum`), jadi penggabungan bisa dibalik persis.

   Aman diulang dan aman berbarengan: setiap pemindahan dijaga syarat "baris yang
   disimpan masih ada di kelompok yang sama", dan indeks unik di akhir transaksi
   gagal (seluruh transaksi batal) bila masih ada salinan tersisa. Catatan di kv
   'ganda' dihitung SQL dari isi arsip di transaksi yang sama, jadi selalu sama
   dengan yang benar-benar dipindah, walau beberapa isolate berjalan berbarengan.

   Bila indeks tidak bisa dibuat, salinan tetap dipindah tanpa indeks dan indeks
   dicoba lagi dengan jeda berlipat — 5 menit, 10, 20, … paling lama 24 jam —
   karena tiap percobaan membaca seluruh tabel dua kali (pindai + bangun indeks).
   Tanpa jeda itu percobaan tiap 5 menit selamanya bisa menghabiskan kuota baca
   harian D1 (lihat versi 6). Perekaman tidak bergantung pada indeks ini.
   Mengembalikan true bila indeks unik sudah ada sesudahnya. */
const ALASAN_GANDA = "Catatan ganda · sama dengan kejadian #";
const jedaGanda = (gagal) => Math.min(GANDA_JEDA_MAKS_MS, GANDA_ULANG_MS * 2 ** Math.max(0, gagal - 1));

async function pastikanUnik(env) {
  const kini = Date.now();
  let lama = null;
  try { lama = JSON.parse((await ambilKV(env, "ganda")) || "null"); } catch (e) { lama = null; }
  if (!lama || typeof lama !== "object") lama = {};
  if (Number(lama.coba_lagi) > kini) return false;
  const gagalSebelum = Number(lama.percobaan) || 0;
  const diam = kini - YATIM_MS;          // baris yang tidak diperbarui sejak ini dianggap diam

  /* Tabel arsip dibuat LEBIH DULU, di luar batch — seperti hapusKejadian(). Catatan
     percobaan di bawah menghitung isinya; kalau tabel itu baru dibuat di dalam batch
     yang kemudian batal, catatan kegagalan (dan jedanya) tidak bisa ditulis sama
     sekali, dan tiap isolate baru langsung memindai ulang. Batch juga jadi tidak
     bergantung pada urutan penyiapan pernyataannya. Bila ini pun gagal, D1 sedang
     bermasalah: tidak ada yang dipindai (murah dicoba lagi isolate berikutnya). */
  try { await env.DB.prepare(SQL_ARSIP).run(); }
  catch (e) { console.log(`catatan ganda: tabel arsip belum bisa disiapkan, dilewati: ${String(e.message || e).slice(0, 200)}`); return false; }

  /* Baris kv 'ganda', dibaca /api/status. Jumlah dan rincian dihitung dari arsip
     (dihapus_oleh 'sistem'); `sebelum` = nilai baris yang disimpan sebelum
     digabung, ditambahkan ke daftar lama; `percobaan` = gagal berturut-turut,
     `coba_lagi` = paling cepat kapan dicoba lagi. */
  const perintahRekam = (o) => env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES ('ganda', json_object(
       'dipindah', (SELECT COUNT(*) FROM pelanggaran_dihapus WHERE dihapus_oleh = 'sistem'),
       'kelompok', (SELECT COUNT(DISTINCT json_extract(data, '$.unit_id') || ':' || json_extract(data, '$.mulai'))
                      FROM pelanggaran_dihapus WHERE dihapus_oleh = 'sistem'),
       'waktu', ?, 'indeks', json(?), 'indeks_dibuat', ?, 'percobaan', ?, 'coba_lagi', ?, 'galat', ?,
       'rincian', json((SELECT json_group_array(t) FROM (
           SELECT '#' || id || ' → #' || substr(alasan, ?) AS t FROM pelanggaran_dihapus
            WHERE dihapus_oleh = 'sistem' ORDER BY id LIMIT 50))),
       'sebelum', json((SELECT json_group_array(json(value)) FROM (
           SELECT value FROM json_each(COALESCE((SELECT json_extract(v, '$.sebelum') FROM kv
                                                  WHERE k = 'ganda' AND json_valid(v)), '[]'))
           UNION ALL
           SELECT value FROM json_each(COALESCE((SELECT v FROM kv
                                                  WHERE k = 'ganda:sebelum' AND json_valid(v)), '[]')))))
     )) ON CONFLICT(k) DO UPDATE SET v = excluded.v`
  ).bind(o.waktu ?? null, o.indeks ? "true" : "false", o.indeksDibuat ?? null, o.percobaan || 0,
         o.cobaLagi ?? null, o.galat ?? null, ALASAN_GANDA.length + 1);
  const gagal = (galat) => ({ indeks: false, galat, percobaan: gagalSebelum + 1,
                              cobaLagi: kini + jedaGanda(gagalSebelum + 1), waktu: lama.waktu ?? null });
  // Catatan kegagalan berdiri sendiri; teks untuk log menyebut apakah jedanya benar tercatat.
  const catatGagal = async (o, jeda) => {
    try { await perintahRekam(o).run(); return `dicoba lagi ${Math.round(jeda / 60000)} menit lagi`; }
    catch (e) { return `catatan percobaan TIDAK tersimpan (${String(e.message || e).slice(0, 120)})`; }
  };

  let perintah, simpan = [], pindah = [], penuh = false;
  try {
    /* Satu lintasan atas tabel: kelompok ganda dicari sekali, lalu barisnya
       diambil lewat indeks `mulai` (CROSS JOIN menahan urutan itu). */
    const { results } = await env.DB.prepare(
      `SELECT p.* FROM (SELECT unit_id, mulai FROM pelanggaran
                         WHERE unit_id IS NOT NULL AND mulai IS NOT NULL
                         GROUP BY unit_id, mulai HAVING COUNT(*) > 1 LIMIT ?) AS g
        CROSS JOIN pelanggaran AS p ON p.mulai = g.mulai AND p.unit_id = g.unit_id
        ORDER BY p.unit_id, p.mulai, p.id`
    ).bind(GANDA_MAKS).all();
    const kelompok = new Map();
    for (const r of results || []) {
      const k = r.unit_id + ":" + r.mulai;
      if (kelompok.has(k)) kelompok.get(k).push(r); else kelompok.set(k, [r]);
    }
    penuh = kelompok.size >= GANDA_MAKS;
    const angka = (v) => Number(v) || 0;
    for (const a of kelompok.values()) {
      if (a.length < 2) continue;
      a.sort((x, y) => angka(y.sampel) - angka(x.sampel) || angka(y.selesai) - angka(x.selesai) ||
                       angka(x.berjalan) - angka(y.berjalan) || x.id - y.id);
      simpan.push(a[0].id);
      for (const r of a.slice(1)) pindah.push({ id: r.id, simpan: a[0].id, data: JSON.stringify(r) });
    }

    perintah = [];
    if (pindah.length) {
      const daftar = JSON.stringify(pindah), daftarSimpan = JSON.stringify(simpan);
      const lebihCepat = (kol) =>
        `(SELECT d.${kol} FROM pelanggaran AS d
           WHERE d.unit_id = pelanggaran.unit_id AND d.mulai = pelanggaran.mulai
             AND d.kecepatan_max > pelanggaran.kecepatan_max
           ORDER BY d.kecepatan_max DESC, d.id LIMIT 1)`;
      /* Baris yang digabung: sudah ditutup atau sudah diam, DAN memang berubah —
         ada salinan yang lebih cepat, atau ia ikut ditutup sebagai yatim. */
      const akanDigabung =
        `id IN (SELECT value FROM json_each(?))
         AND (COALESCE(berjalan, 0) = 0 OR selesai < ?)
         AND ((COALESCE(berjalan, 0) = 1 AND selesai < ?)
              OR EXISTS (SELECT 1 FROM pelanggaran AS d
                          WHERE d.unit_id = pelanggaran.unit_id AND d.mulai = pelanggaran.mulai
                            AND d.kecepatan_max > pelanggaran.kecepatan_max))`;
      perintah.push(
        // Nilai sebelum digabung, di transaksi yang sama (baris sementara, dihapus di akhir).
        env.DB.prepare(
          `INSERT INTO kv (k, v)
           SELECT 'ganda:sebelum', json_group_array(json_object('id', id, 'unit', unit, 'mulai', mulai,
                    'kecepatan_max', kecepatan_max, 'lat', lat, 'lon', lon, 'berjalan', berjalan, 'dicatat', ?))
             FROM pelanggaran WHERE ${akanDigabung}
           ON CONFLICT(k) DO UPDATE SET v = excluded.v`
        ).bind(kini, daftarSimpan, diam, diam),
        env.DB.prepare(
          `UPDATE pelanggaran SET
             lat = COALESCE(${lebihCepat("lat")}, lat),
             lon = COALESCE(${lebihCepat("lon")}, lon),
             kecepatan_max = COALESCE((SELECT MAX(d.kecepatan_max) FROM pelanggaran AS d
                                        WHERE d.unit_id = pelanggaran.unit_id AND d.mulai = pelanggaran.mulai),
                                      kecepatan_max),
             berjalan = CASE WHEN COALESCE(berjalan, 0) = 1 AND selesai < ? THEN 0 ELSE berjalan END
           WHERE ${akanDigabung}`
        ).bind(diam, daftarSimpan, diam, diam),
        env.DB.prepare(
          `INSERT OR REPLACE INTO pelanggaran_dihapus
             (id, unit, tanggal, mulai, data, dihapus_pada, dihapus_oleh, alasan)
           SELECT p.id, p.unit, p.tanggal, p.mulai, json_extract(j.value, '$.data'), ?, 'sistem',
                  ? || json_extract(j.value, '$.simpan')
             FROM json_each(?) AS j
             JOIN pelanggaran AS p ON p.id = json_extract(j.value, '$.id')
            WHERE EXISTS (SELECT 1 FROM pelanggaran AS k
                           WHERE k.id = json_extract(j.value, '$.simpan') AND k.id <> p.id
                             AND k.unit_id = p.unit_id AND k.mulai = p.mulai)`
        ).bind(kini, ALASAN_GANDA, daftar),
        env.DB.prepare(
          `DELETE FROM pelanggaran
            WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
              AND id IN (SELECT id FROM pelanggaran_dihapus)`
        ).bind(daftar),
        perintahBuangRingkas(env),
      );
    }
  } catch (e) {
    const galat = String(e.message || e).slice(0, 300);
    console.log(`catatan ganda: pemeriksaan gagal (percobaan ${gagalSebelum + 1}): ${galat}; ` +
                await catatGagal(gagal(galat), jedaGanda(gagalSebelum + 1)));
    return false;
  }
  const hapusSementara = env.DB.prepare(`DELETE FROM kv WHERE k = 'ganda:sebelum'`);
  const waktuPindah = pindah.length ? kini : (lama.waktu ?? null);

  let galat = null;
  try {
    await env.DB.batch([...perintah,
      env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ${IDX_UNIK} ON pelanggaran(unit_id, mulai)`),
      perintahRekam({ indeks: true, waktu: waktuPindah ?? kini,
                      indeksDibuat: (lama.indeks && lama.indeks_dibuat) || kini }),
      hapusSementara]);
    if (pindah.length) ringkasMem.clear();
    console.log(`catatan ganda: ${pindah.length} salinan dipindah ke arsip terhapus (${simpan.length} kejadian), ` +
                `indeks ${IDX_UNIK} siap` +
                (pindah.length ? " · " + pindah.slice(0, 50).map((x) => `#${x.id} → #${x.simpan}`).join(", ") : ""));
    return true;
  } catch (e) {
    galat = String(e.message || e).slice(0, 300);
  }
  /* Indeks belum bisa dibuat: salinan tetap dipindah, indeksnya dicoba lagi nanti.
     Bila penyebabnya hanya kelompok yang melebihi GANDA_MAKS, itu kemajuan, bukan
     kegagalan: percobaan berikutnya 5 menit lagi tanpa jeda berlipat. */
  let dipindahkan = false;
  if (pindah.length) {
    const o = penuh ? { indeks: false, galat, percobaan: 0, cobaLagi: kini + GANDA_ULANG_MS, waktu: kini }
                    : { ...gagal(galat), waktu: kini };
    try {
      await env.DB.batch([...perintah, perintahRekam(o), hapusSementara]);
      ringkasMem.clear();
      dipindahkan = true;
    } catch (e) {
      galat += " ; " + String(e.message || e).slice(0, 200);
    }
  }
  const lanjut = dipindahkan && penuh ? GANDA_ULANG_MS : jedaGanda(gagalSebelum + 1);
  const jadwal = dipindahkan ? `dicoba lagi ${Math.round(lanjut / 60000)} menit lagi`
                             : await catatGagal(gagal(galat), lanjut);
  console.log(`catatan ganda: indeks ${IDX_UNIK} belum bisa dibuat (${galat})` +
              (dipindahkan ? `; ${pindah.length} salinan tetap dipindah` : "") + "; " + jadwal);
  return false;
}

// ------------------------------------------- catatan terbelah (versi 15)

/* §17 butir 79: satu kejadian yang terlanjur tersimpan dua baris atau lebih
   dengan waktu mulai BERBEDA — tidak bisa dikenali dari kunci (unit_id, mulai)
   seperti catatan ganda versi 14. Sejak versi 15 pembukaan kejadian meneruskan
   baris yang tertinggal (bukaPelanggaran), jadi yang dirapikan di sini adalah
   sisa lama dan yang lolos dari aturan itu.

   Yang dikenali hanya yang PASTI satu kejadian: dua baris unit yang sama dengan
   batas yang sama yang rentang waktunya bertumpang (yang satu mulai sebelum yang
   lain selesai). Unit yang sama tidak mungkin punya dua kejadian sekaligus —
   kejadian baru hanya dibuka sesudah yang lama ditutup — jadi tumpang tindih
   hanya bisa datang dari dua state yang berjalan sendiri-sendiri. Baris yang
   berurutan tanpa tumpang tindih TIDAK disentuh: dari tabel saja tidak bisa
   dibedakan dari dua kejadian sungguhan yang berdekatan.

   Satu kelompok hanya dirapikan bila semua barisnya sudah ditutup atau lebih dari
   sejam tidak diperbarui (baris yang masih dipegang cron dibiarkan). Baris yang
   DISIMPAN: sampel terbanyak, lalu selesai paling akhir, lalu yang sudah ditutup,
   lalu nomor terkecil — sama dengan catatan ganda. Waktu mulainya mundur ke yang
   paling awal (tanggalnya ikut), selesainya maju ke yang paling akhir, kecepatan
   tertinggi diambil dari seluruh kelompok berikut posisinya, dan baris itu
   ditutup. Jumlah sampel dan rata-ratanya tetap milik baris itu: sampel kedua
   state bisa sama, jadi tidak dijumlahkan. Baris lain dipindah ke arsip terhapus
   (dihapus_oleh "sistem", alasan "Catatan terbelah · bagian dari kejadian #n"),
   jadi bisa dilihat dan dipulihkan admin; nilai baris yang disimpan sebelum
   diubah dicatat di baris kv 'belah' (`sebelum`).

   Jalur HTTP (siapkanTabel), sekali sehari, bukan di putaran cron. Satu lintasan
   atas tabel, pasangannya dicari lewat indeks unik (unit_id, mulai). Semua
   perubahan satu batch D1 (satu transaksi) dengan syarat di dalam pernyataannya,
   jadi aman diulang dan aman berbarengan: pemanggilan kedua tidak menemukan apa
   pun untuk dipindah, dan catatan di kv 'belah' dihitung dari isi arsip. */
const ALASAN_BELAH = "Catatan terbelah · bagian dari kejadian #";
const BELAH_ULANG_MS = 86400000;   // diperiksa sekali sehari
const BELAH_LANJUT_MS = 300000;    // pasangan melebihi BELAH_MAKS: sisanya 5 menit lagi
const BELAH_GAGAL_MS = 3600000;    // sesudah galat: sejam lagi
const BELAH_MAKS = 300;            // pasangan per pemeriksaan
const BELAH_SEBELUM_MAKS = 200;    // `sebelum` di kv 'belah': paling banyak 200 nilai terbaru
const BELAH_SEBELUM_MS = 90 * 86400000;   // dan paling tua 90 hari

async function rapikanBelah(env) {
  const kini = Date.now();
  /* Hanya `berikut` dan `waktu` yang dibutuhkan di sini; isi lain baris itu (`sebelum`,
     `rincian`) tidak diurai di Worker, karena permintaan HTTP pertama tiap isolate
     sampai di sini. */
  let lama = {};
  try {
    const r = await env.DB.prepare(
      `SELECT json_extract(v, '$.berikut') AS berikut, json_extract(v, '$.waktu') AS waktu
         FROM kv WHERE k = 'belah' AND json_valid(v)`
    ).first();
    if (r) lama = { berikut: r.berikut, waktu: r.waktu };
  } catch (e) { lama = {}; }
  if (Number(lama.berikut) > kini) return;
  const diam = kini - YATIM_MS;
  const L = ALASAN_BELAH.length;

  /* Baris kv 'belah', dibaca /api/status. `dipindah`/`kejadian`/`rincian` dihitung
     dari arsip; `sebelum` = nilai baris yang disimpan sebelum diubah, ditambahkan
     ke daftar lama; `waktu` = terakhir ada yang dipindah, `berikut` = pemeriksaan
     berikutnya paling cepat. */
  const perintahRekam = (o) => env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES ('belah', json_object(
       'dipindah', (SELECT COUNT(*) FROM pelanggaran_dihapus
                     WHERE dihapus_oleh = 'sistem' AND substr(alasan, 1, ?) = ?),
       'kejadian', (SELECT COUNT(DISTINCT alasan) FROM pelanggaran_dihapus
                     WHERE dihapus_oleh = 'sistem' AND substr(alasan, 1, ?) = ?),
       'waktu', ?, 'diperiksa', ?, 'berikut', ?, 'dilewati', ?, 'galat', ?,
       'rincian', json((SELECT json_group_array(t) FROM (
           SELECT '#' || id || ' → #' || substr(alasan, ?) AS t FROM pelanggaran_dihapus
            WHERE dihapus_oleh = 'sistem' AND substr(alasan, 1, ?) = ? ORDER BY id LIMIT 50))),
       'sebelum', json((SELECT json_group_array(json(value)) FROM (
           SELECT value FROM (
             SELECT value, json_extract(value, '$.dicatat') AS w, 0 AS g, key AS i
               FROM json_each(COALESCE((SELECT json_extract(v, '$.sebelum') FROM kv
                                         WHERE k = 'belah' AND json_valid(v)), '[]'))
             UNION ALL
             SELECT value, json_extract(value, '$.dicatat'), 1, key
               FROM json_each(COALESCE((SELECT v FROM kv
                                         WHERE k = 'belah:sebelum' AND json_valid(v)), '[]')))
            WHERE w >= ?
            ORDER BY w DESC, g DESC, i LIMIT ?)))
     )) ON CONFLICT(k) DO UPDATE SET v = excluded.v`
  ).bind(L, ALASAN_BELAH, L, ALASAN_BELAH, o.waktu ?? null, kini, o.berikut, o.dilewati || 0, o.galat ?? null,
         L + 1, L, ALASAN_BELAH, kini - BELAH_SEBELUM_MS, BELAH_SEBELUM_MAKS);
  /* Catatan galat TIDAK bergantung pada tabel arsip (perintahRekam membacanya): bila
     tabel itu yang bermasalah, jeda sejam tetap tersimpan — tanpanya tiap isolate
     baru memindai ulang seluruh tabel (pola kuota baca September, §21.8). */
  const catatGagal = async (galat) => {
    try {
      await env.DB.prepare(
        `INSERT INTO kv (k, v) VALUES ('belah', json_object('berikut', ?, 'diperiksa', ?, 'galat', ?, 'waktu', ?))
           ON CONFLICT(k) DO UPDATE SET v = CASE WHEN json_valid(kv.v)
             THEN json_set(kv.v, '$.berikut', ?, '$.diperiksa', ?, '$.galat', ?) ELSE excluded.v END`
      ).bind(kini + BELAH_GAGAL_MS, kini, galat, lama.waktu ?? null, kini + BELAH_GAGAL_MS, kini, galat).run();
    } catch (e) {}
    console.log(`catatan terbelah: pemeriksaan gagal, dicoba lagi sejam lagi: ${galat}`);
  };

  let pasang, baris, penuh = false;
  try {
    await env.DB.prepare(SQL_ARSIP).run();     // perintahRekam membaca tabel arsip
    /* CROSS JOIN menahan urutan: `a` dipindai sekali, pasangannya `b` dicari lewat
       indeks unik (unit_id, mulai) — unit sama, mulai di dalam rentang `a`. Urut
       unit, supaya bila batas BELAH_MAKS tercapai yang terpotong hanya kelompok
       unit terakhir — dan unit itu ditunda ke pemeriksaan berikutnya (5 menit),
       jadi syarat "kelompok yang masih berjalan dilewati" selalu menilai kelompok
       utuh. */
    pasang = (await env.DB.prepare(
      `SELECT a.id AS a, b.id AS b, a.unit_id AS u
         FROM pelanggaran AS a CROSS JOIN pelanggaran AS b
           ON b.unit_id = a.unit_id AND b.mulai > a.mulai AND b.mulai <= a.selesai AND b.batas = a.batas
        WHERE a.unit_id IS NOT NULL AND a.mulai IS NOT NULL AND a.selesai IS NOT NULL
        ORDER BY a.unit_id, a.mulai
        LIMIT ?`
    ).bind(BELAH_MAKS).all()).results || [];
    penuh = pasang.length >= BELAH_MAKS;
    if (penuh) {
      const uAkhir = pasang[pasang.length - 1].u, sisa = pasang.filter((x) => x.u !== uAkhir);
      if (sisa.length) pasang = sisa;     // satu unit saja melebihi batas: dikerjakan sebagian
    }
    if (!pasang.length) {
      await perintahRekam({ waktu: lama.waktu, berikut: kini + BELAH_ULANG_MS }).run();
      return;
    }
    const ids = [...new Set(pasang.flatMap((x) => [x.a, x.b]))];
    baris = (await env.DB.prepare(
      `SELECT * FROM pelanggaran WHERE id IN (SELECT value FROM json_each(?))`
    ).bind(JSON.stringify(ids)).all()).results || [];
  } catch (e) {
    return catatGagal(String(e.message || e).slice(0, 300));
  }

  // Kelompok = komponen terhubung pasangan (a–b, b–c → a, b, c).
  const induk = new Map();
  const akar = (x) => { while (induk.has(x) && induk.get(x) !== x) x = induk.get(x); return x; };
  for (const { a, b } of pasang) { const ra = akar(a), rb = akar(b); if (ra !== rb) induk.set(ra, rb); }
  const kelompok = new Map();
  for (const r of baris) {
    const k = akar(r.id);
    if (kelompok.has(k)) kelompok.get(k).push(r); else kelompok.set(k, [r]);
  }

  const angka = (v) => Number(v) || 0;
  const target = [], buang = [];
  let dilewati = 0;
  for (const a of kelompok.values()) {
    if (a.length < 2) continue;
    if (a.some((r) => angka(r.berjalan) === 1 && !(angka(r.selesai) < diam))) { dilewati++; continue; }
    a.sort((x, y) => angka(y.sampel) - angka(x.sampel) || angka(y.selesai) - angka(x.selesai) ||
                     angka(x.berjalan) - angka(y.berjalan) || x.id - y.id);
    const simpan = a[0];
    let awal = simpan, cepat = simpan, akhir = angka(simpan.selesai);
    for (const r of a) {
      if (angka(r.mulai) < angka(awal.mulai)) awal = r;
      if (angka(r.kecepatan_max) > angka(cepat.kecepatan_max)) cepat = r;
      if (angka(r.selesai) > akhir) akhir = angka(r.selesai);
    }
    target.push({ id: simpan.id, mulai: awal.mulai, tanggal: awal.tanggal, selesai: akhir,
                  km: cepat.kecepatan_max, lat: cepat.lat, lon: cepat.lon });
    for (const r of a.slice(1)) buang.push({ id: r.id, simpan: simpan.id, data: JSON.stringify(r) });
  }
  const berikut = kini + (penuh ? BELAH_LANJUT_MS : BELAH_ULANG_MS);
  if (!buang.length) {
    try { await perintahRekam({ waktu: lama.waktu, berikut, dilewati }).run(); }
    catch (e) { return catatGagal(String(e.message || e).slice(0, 300)); }
    return;
  }

  const daftarTarget = JSON.stringify(target), daftarBuang = JSON.stringify(buang);
  try {
    await env.DB.batch([
      // Nilai baris yang disimpan sebelum diubah (baris sementara, dihapus di akhir).
      env.DB.prepare(
        `INSERT INTO kv (k, v)
         SELECT 'belah:sebelum', json_group_array(json_object('id', p.id, 'unit', p.unit, 'tanggal', p.tanggal,
                  'mulai', p.mulai, 'selesai', p.selesai, 'kecepatan_max', p.kecepatan_max,
                  'lat', p.lat, 'lon', p.lon, 'berjalan', p.berjalan, 'dicatat', ?))
           FROM json_each(?) AS j JOIN pelanggaran AS p ON p.id = json_extract(j.value, '$.id')
          WHERE p.mulai IS NOT json_extract(j.value, '$.mulai') OR p.selesai IS NOT json_extract(j.value, '$.selesai')
             OR p.tanggal IS NOT json_extract(j.value, '$.tanggal')
             OR p.kecepatan_max IS NOT json_extract(j.value, '$.km') OR COALESCE(p.berjalan, 0) <> 0
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`
      ).bind(kini, daftarTarget),
      env.DB.prepare(
        `INSERT OR REPLACE INTO pelanggaran_dihapus
           (id, unit, tanggal, mulai, data, dihapus_pada, dihapus_oleh, alasan)
         SELECT p.id, p.unit, p.tanggal, p.mulai, json_extract(j.value, '$.data'), ?, 'sistem',
                ? || json_extract(j.value, '$.simpan')
           FROM json_each(?) AS j JOIN pelanggaran AS p ON p.id = json_extract(j.value, '$.id')
          WHERE EXISTS (SELECT 1 FROM pelanggaran AS k
                         WHERE k.id = json_extract(j.value, '$.simpan') AND k.id <> p.id AND k.unit_id IS p.unit_id)`
      ).bind(kini, ALASAN_BELAH, daftarBuang),
      env.DB.prepare(
        `DELETE FROM pelanggaran
          WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
            AND id IN (SELECT id FROM pelanggaran_dihapus WHERE dihapus_oleh = 'sistem')`
      ).bind(daftarBuang),
      /* Sesudah salinan dihapus, baris yang disimpan boleh memakai waktu mulai salah
         satunya tanpa melanggar indeks unik. Bila salinan itu ternyata tidak
         terhapus, barisnya dilewati, bukan menggagalkan batch. */
      env.DB.prepare(
        `WITH j AS (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.mulai') AS mulai,
                           json_extract(value, '$.tanggal') AS tanggal, json_extract(value, '$.selesai') AS selesai,
                           json_extract(value, '$.km') AS km, json_extract(value, '$.lat') AS lat,
                           json_extract(value, '$.lon') AS lon
                      FROM json_each(?))
         UPDATE pelanggaran SET
           mulai = (SELECT j.mulai FROM j WHERE j.id = pelanggaran.id),
           tanggal = (SELECT j.tanggal FROM j WHERE j.id = pelanggaran.id),
           selesai = (SELECT j.selesai FROM j WHERE j.id = pelanggaran.id),
           kecepatan_max = (SELECT j.km FROM j WHERE j.id = pelanggaran.id),
           lat = (SELECT j.lat FROM j WHERE j.id = pelanggaran.id),
           lon = (SELECT j.lon FROM j WHERE j.id = pelanggaran.id),
           berjalan = 0
         WHERE id IN (SELECT id FROM j)
           AND NOT EXISTS (SELECT 1 FROM j, pelanggaran AS x
                            WHERE j.id = pelanggaran.id AND x.unit_id IS pelanggaran.unit_id
                              AND x.mulai = j.mulai AND x.id <> pelanggaran.id)`
      ).bind(daftarTarget),
      perintahRekam({ waktu: kini, berikut, dilewati }),
      env.DB.prepare(`DELETE FROM kv WHERE k = 'belah:sebelum'`),
      perintahBuangRingkas(env),
    ]);
  } catch (e) {
    return catatGagal(String(e.message || e).slice(0, 300));
  }
  ringkasMem.clear();
  console.log(`catatan terbelah: ${buang.length} baris dipindah ke arsip terhapus (${target.length} kejadian)` +
              (dilewati ? `, ${dilewati} kelompok masih berjalan dilewati` : "") + " · " +
              buang.slice(0, 50).map((x) => `#${x.id} → #${x.simpan}`).join(", "));
}

// ---------------------------------------------------------------- titik masuk

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    try {
      /* Versi 16: Digital Twin memanggil ini sesudah admin menerbitkan atau
         memulihkan jalan. Ditangani sebelum pemeriksaan skema dan penyegaran
         jalan di bawah: yang disentuh hanya baris kv jalan, dan jalan disamakan
         sendiri dengan gudang (segarkanDariGudang). */
      if (url.pathname === "/api/jalan/segarkan") return await segarkanDariGudang(env, req);

      /* /api/unit dipanggil tiap 10 detik oleh setiap Speed Watcher dan tidak
         menyentuh tabel pelanggaran; /api/batas tidak menyentuh D1 sama sekali.
         Keduanya tidak menjalankan pemeriksaan skema, supaya isolate baru tidak
         membayar beberapa kueri skema di jalur yang paling ramai. Tabel kv yang
         dipakai /api/unit dibuat oleh cron dalam menit pertama Worker hidup. */
      if (url.pathname !== "/api/unit" && url.pathname !== "/api/batas") {
        await siapkanTabel(env);
      }

      /* Semua jalur memakai jalan yang sama dengan cron (/api/ringkas pun menilai
         dengan batas). Nomor versinya dibaca paling sering sekali per 5 menit. */
      await segarkanJalan(env);

      if (url.pathname === "/api/unit") {
        await muatMesin(env);   // paling sering sekali per menit per isolate
        const units = await ambilUnit(env);
        return json({
          jumlah: units.length,
          batas_luar: BATAS_LUAR,
          /* Versi 16: halaman membandingkan ini dengan jalan yang terpasang di
             layar dan langsung menarik /api/jalan bila berbeda. */
          versi_jalan: JALAN.versi,
          jalan_aktif: JALAN.aktif || 0,
          waktu_server: Date.now(),
          unit: units,
        });
      }

      /* Versi 13: rincian sensor mesin per unit, untuk memeriksa peta sensor dan
         nilainya dari luar (dibaca manusia, berindentasi). Satu panggilan Wialon
         yang sama dengan /api/unit; tidak menulis apa pun. */
      if (url.pathname === "/api/mesin") {
        await muatMesin(env, true);
        const kini = Math.floor(Date.now() / 1000);
        const hitung = { nyala: 0, mati: 0, tidak_terbaca: 0, tanpa_sensor: 0, belum_dipetakan: 0, diabaikan: 0 };
        const unit = (await ambilItem(env)).map((it) => {
          const d = MESIN.u[it.id];
          const abai = Number(MESIN.x[it.id]) > kini ? Number(MESIN.x[it.id]) * 1000 : null;
          const b = d && d.p ? bacaMesin(d, it) : { v: null, nyala: null };
          const status = !d ? "belum dipetakan" : !d.p ? (d.ket || "tanpa sensor mesin")
                       : abai ? "diabaikan (dicurigai macet)"
                       : b.nyala === true ? "nyala" : b.nyala === false ? "mati" : "tidak terbaca";
          if (!d) hitung.belum_dipetakan++;
          else if (!d.p) hitung.tanpa_sensor++;
          else if (abai) hitung.diabaikan++;
          else if (b.nyala === true) hitung.nyala++;
          else if (b.nyala === false) hitung.mati++;
          else hitung.tidak_terbaca++;
          return {
            id: it.id, nama: it.nm, status,
            sensor: d?.n || null, parameter: d?.p || null, nilai: b.v,
            tabel: d?.tb ? d.tb.length : 0,
            kecepatan: it.pos?.s ?? null,
            waktu_posisi: it.pos?.t ? it.pos.t * 1000 : null,
            waktu_pesan: it.lmsg?.t ? it.lmsg.t * 1000 : null,
            dipetakan: d?.t ? d.t * 1000 : null,
            diabaikan_sampai: abai,
          };
        }).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
        return json({ jumlah: unit.length, ringkas: hitung, unit }, 200, true);
      }

      if (url.pathname === "/api/status") {
        let meta = {};
        try { meta = JSON.parse((await ambilKV(env, "state")) || "{}"); } catch (e) {}
        const cek = Number(meta.cek) || null;
        const hariIni = tanggalWIT(Date.now());
        const p = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM pelanggaran WHERE tanggal=?`
        ).bind(hariIni).first();
        /* Tiap blok: menit terakhir ia dijalankan (0 = menit ini, 1 = menit
           lalu) dan oleh pemicu mana. Yang dicatat adalah MENIT, bukan detik:
           blok C baru tersimpan di detik ke-50, jadi catatannya wajar berumur
           hampir dua menit tepat sebelum C berikutnya selesai. `terbagi` benar
           bila ketiga blok berjalan di menit ini atau menit lalu, masing-masing
           oleh pemicunya sendiri — tanda ketiga pemicu cron hidup (§21.11). */
        const kini = Date.now();
        const menitIni = Math.floor(kini / 60000) * 60000;
        /* Tulisan cron yang terakhir mengklaim tiap blok — untuk membaca dari
           luar pemicu mana yang benar-benar menyala (§21.11). */
        const klaim = {};
        try {
          const { results } = await env.DB.prepare(
            `SELECT k, v FROM kv WHERE k = 'blok:A' UNION ALL SELECT k, v FROM kv WHERE k = 'blok:B'
             UNION ALL SELECT k, v FROM kv WHERE k = 'blok:C'`
          ).all();
          for (const r of results || []) {
            try { klaim[String(r.k).slice(5)] = JSON.parse(r.v); } catch (e) {}
          }
        } catch (e) {}
        const blok = {};
        let terbagi = true;
        for (const b of BLOK) {
          const m = Number(meta.blok?.[b.nama]) || null;
          const oleh = meta.oleh?.[b.nama] || null;
          const lalu = m ? Math.round((menitIni - m) / 60000) : null;
          blok[b.nama] = { menit_lalu: lalu, oleh, pemicu: klaim[b.nama]?.c ?? null };
          if (lalu === null || lalu > 1 || oleh !== b.nama) terbagi = false;
        }
        /* Ringkasan peta sensor mesin (versi 13); rinciannya di /api/mesin. */
        await muatMesin(env);
        const detik = Math.floor(kini / 1000);
        const petaMesin = Object.values(MESIN.u);
        const mesin = {
          dipetakan: petaMesin.length,
          bersensor: petaMesin.filter((d) => d && d.p).length,
          diabaikan: Object.values(MESIN.x).filter((t) => Number(t) > detik).length,
        };
        /* Versi 14: pembersihan catatan ganda sekali jalan (baris kv 'ganda').
           `dipindah`/`kelompok`/`rincian` ("#salinan → #disimpan") dihitung dari
           arsip terhapus milik 'sistem'; `indeks` = indeks unik (unit_id, mulai)
           sudah dibuat; `sebelum` = nilai baris yang disimpan sebelum digabung
           (untuk membalik penggabungan); `percobaan` = gagal berturut-turut dan
           `coba_lagi` = paling cepat kapan dicoba lagi (jeda berlipat sampai 24
           jam); `indeks_ada` = hasil pemeriksaan isolate ini. */
        let ganda = null;
        try { ganda = JSON.parse((await ambilKV(env, "ganda")) || "null"); } catch (e) { ganda = null; }
        if (!ganda || typeof ganda !== "object") {
          ganda = { dipindah: 0, kelompok: 0, waktu: null, indeks: false, percobaan: 0, coba_lagi: null, catatan: "belum dijalankan" };
        }
        ganda.indeks_ada = unikAda;
        /* Versi 15: catatan terbelah (baris kv 'belah', lihat rapikanBelah).
           `dipindah`/`kejadian`/`rincian` dari arsip terhapus milik 'sistem';
           `sebelum` = nilai baris yang disimpan sebelum diubah; `diperiksa` dan
           `berikut` = pemeriksaan terakhir dan berikutnya (sekali sehari). */
        let belah = null;
        try { belah = JSON.parse((await ambilKV(env, "belah")) || "null"); } catch (e) { belah = null; }
        if (!belah || typeof belah !== "object") {
          belah = { dipindah: 0, kejadian: 0, waktu: null, diperiksa: null, berikut: null, catatan: "belum dijalankan" };
        }
        return json({
          versi_worker: 16.2,
          terhubung: !!cek && kini - cek < 120000,
          cek_terakhir: cek,
          jumlah_unit: Number(meta.jumlah) || 0,
          pelanggaran_hari_ini: p?.n ?? 0,
          batas_luar: BATAS_LUAR,
          jumlah_ruas: RUAS.length,
          versi_jalan: JALAN.versi,
          judul_jalan: JALAN.judul,
          jalan_dimuat: JALAN.dimuat,
          jalan_aktif: JALAN.aktif || 0,
          titik_jalan: RUAS.reduce((a, r) => a + r.p.length, 0),
          jejak: JEJAK_HARI + " hari terakhir",
          terbagi,
          blok,
          mesin,
          ganda,
          belah,
        }, 200, true);
      }

      if (url.pathname === "/api/pelanggaran") {
        // Satu hari lewat ?tanggal=, atau rentang lewat ?dari=&sampai= untuk ekspor.
        const dari = url.searchParams.get("dari");
        const sampai = url.searchParams.get("sampai");
        if (dari && sampai) {
          const a = dari <= sampai ? dari : sampai;
          const b = dari <= sampai ? sampai : dari;
          const { results } = await env.DB.prepare(
            `SELECT * FROM pelanggaran WHERE tanggal BETWEEN ? AND ? ORDER BY mulai ASC`
          ).bind(a, b).all();
          return json({ dari: a, sampai: b, jumlah: results.length, pelanggaran: results });
        }
        const tgl = url.searchParams.get("tanggal") || tanggalWIT(Date.now());

        /* Tarikan susulan untuk halaman yang sudah memegang arsip hari itu:
           ?sejak=<id terbesar yang terakhir diterima>&buka=<id kejadian yang
           masih berjalan>. Yang dibaca hanya baris baru dan baris yang masih
           berjalan, bukan seluruh hari. Tanpa ini, Speed Watcher yang terbuka
           seharian membaca ulang seluruh baris hari itu tiap menit.

           `+tanggal` disengaja: tanda plus melarang D1 memakai indeks tanggal
           untuk syarat ini, sehingga kueri berjalan di kunci utama (id > ?) dan
           hanya menyentuh baris yang lebih baru. Semua kueri berada dalam satu
           batch — satu transaksi — jadi `maks_id` dan isi jawabannya berasal
           dari keadaan tabel yang sama. */
        const sejak = Number(url.searchParams.get("sejak"));
        if (Number.isInteger(sejak) && sejak > 0) {
          const buka = (url.searchParams.get("buka") || "").split(",")
            .map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
          const perintah = [
            env.DB.prepare(`SELECT MAX(id) AS maks FROM pelanggaran`),
            env.DB.prepare(
              `SELECT * FROM pelanggaran WHERE id > ? AND +tanggal = ? ORDER BY id`
            ).bind(sejak, tgl),
          ];
          if (buka.length) {
            perintah.push(env.DB.prepare(
              `SELECT * FROM pelanggaran WHERE id IN (${buka.map(() => "?").join(",")})`
            ).bind(...buka));
          }
          const hasil = await env.DB.batch(perintah);
          const peta = new Map();
          for (const h of hasil.slice(1)) for (const r of h.results || []) peta.set(r.id, r);
          const baris = [...peta.values()].sort((a, b) => b.mulai - a.mulai);
          return json({
            tanggal: tgl, sebagian: true, sejak,
            maks_id: hasil[0].results?.[0]?.maks ?? 0,
            jumlah: baris.length, pelanggaran: baris,
          });
        }

        const hasil = await env.DB.batch([
          env.DB.prepare(`SELECT MAX(id) AS maks FROM pelanggaran`),
          env.DB.prepare(`SELECT * FROM pelanggaran WHERE tanggal=? ORDER BY mulai DESC`).bind(tgl),
        ]);
        const results = hasil[1].results || [];
        return json({
          tanggal: tgl, maks_id: hasil[0].results?.[0]?.maks ?? 0,
          jumlah: results.length, pelanggaran: results,
        });
      }

      /* Tabel batas dibaca halaman supaya angka di layar selalu ikut server.
         Hanya baca — mengubahnya berarti mengubah kode Worker ini. */
      if (url.pathname === "/api/batas") {
        const tabel = {};
        for (const r of RUAS) tabel[r.n] = r.b;
        const urut = Object.keys(tabel).sort().reduce((o, k) => (o[k] = tabel[k], o), {});
        return json({
          batas_luar: BATAS_LUAR,
          toleransi_ruas_m: TOLERANSI_RUAS,
          jumlah_ruas: Object.keys(urut).length,
          versi_jalan: JALAN.versi,
          jalan_aktif: JALAN.aktif || 0,
          ruas: urut,
        });
      }

      /* Jalan yang SEDANG dipakai Worker: geometri, batas per potong, batas di
         luar ruas, toleransi, dan versinya. Halaman Speed Watcher menggambar
         peta dari sini, jadi layar dan server selalu menilai ruas yang sama. */
      if (url.pathname === "/api/jalan") {
        /* Versi 16: `aktif` = saat versi ini diaktifkan di gudang. Halaman memakainya
           untuk menolak jawaban isolate yang belum menyusul. Cache dipendekkan ke
           15 detik: jalan kini bisa berganti dalam hitungan detik. */
        return new Response(JSON.stringify({
          versi: JALAN.versi, judul: JALAN.judul, dimuat: JALAN.dimuat, aktif: JALAN.aktif || 0,
          batas_luar: BATAS_LUAR, toleransi_m: TOLERANSI_RUAS, ruas: RUAS,
        }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15", ...CORS } });
      }

      /* Jejak GPS untuk putar ulang shift dan saran jalan di Digital Twin.
         ?dari=&sampai= dalam epoch ms, paling panjang 3 jam sekali minta, paling
         lama 4 hari ke belakang. Isi baris dikirim apa adanya (tidak diurai di
         sini) supaya anggaran CPU tetap kecil. */
      if (url.pathname === "/api/jejak") {
        const kini = Date.now();
        let dari = Math.floor(Number(url.searchParams.get("dari")) / 60000) * 60000;
        let sampai = Number(url.searchParams.get("sampai"));
        if (!Number.isFinite(dari) || !Number.isFinite(sampai) || sampai <= dari) {
          return json({ error: "dari dan sampai (epoch ms) wajib, sampai > dari" }, 400);
        }
        if (sampai - dari > 3 * 3600000) sampai = dari + 3 * 3600000;
        if (dari < kini - (JEJAK_HARI + 1) * 86400000) return json({ error: "jejak hanya disimpan " + JEJAK_HARI + " hari" }, 400);
        const { results } = await env.DB.prepare(
          `SELECT k, v FROM kv WHERE k >= ? AND k < ? ORDER BY k`
        ).bind("jejak:" + dari, "jejak:" + sampai).all();
        const baris = (results || []).map((r) => { const q = String(r.k).split(":"); return [Number(q[1]), q[2], r.v]; });
        const selesai = sampai < kini - 120000;
        return new Response(JSON.stringify({ dari, sampai, dasar: JEJAK_DASAR, skala: JEJAK_SKALA, jumlah: baris.length, baris }), {
          headers: { "Content-Type": "application/json", "Cache-Control": selesai ? "public, max-age=3600" : "no-store", ...CORS },
        });
      }

      /* Ringkasan shift berjalan untuk kartu di halaman Home shell. Dihitung satu
         kueri dan dipakai bersama lintas tab — lihat ringkasShift(). Untuk ruas,
         yang dipakai adalah ruas tempat kejadian dinilai; bila kejadiannya di luar
         semua ruas, dipakai nama ruas terdekat, supaya peringkat tidak menumpuk di
         satu kantong "Di luar ruas". */
      if (url.pathname === "/api/ringkas") {
        /* ?dari=&sampai= (YYYY-MM-DD, WIT) untuk kartu Home yang memakai filter
           periode. Tanpa keduanya, jawabannya tetap shift yang sedang berjalan
           seperti semula. Pengelompokannya sama; yang berbeda hanya jendelanya. */
        const dari = url.searchParams.get("dari");
        const sampai = url.searchParams.get("sampai");
        const sah = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");
        const j = (sah(dari) && sah(sampai))
          ? jendelaTanggal(dari, sampai)
          : jendelaShift(url.searchParams.get("shift"));
        return json(await ringkasShift(env, j));
      }

      /* Sekali pakai, boleh diulang: mengisi nama ruas terdekat untuk baris
         pelanggaran lama yang direkam sebelum kolomnya ada.

         HANYA kolom penamaan yang diisi. `batas` dan `ruas` dibiarkan apa adanya
         karena baris lama dinilai dengan aturan lama — menulis ulang keduanya
         berarti memalsukan catatan. Baris lama akan tampil sebagai
         "RD_X (sekitar)", yang memang jujur: kita tahu di dekat mana, tidak tahu
         ia dinilai dengan batas ruas itu.

         Dibatasi 15 baris sekali panggil. Terukur: 50 baris memakan ~15,7 ms
         CPU, di atas anggaran 10 ms paket gratis — dan Worker yang melewatinya
         dihentikan di tengah jalan (§21.6). Panggil berulang sampai `sisa`
         bernilai 0.

         PERINGATAN KUOTA: kedua kuerinya memindai seluruh tabel (tidak ada indeks
         untuk ruas_dekat kosong), jadi tiap panggilan membaca dua kali jumlah
         baris tabel. Jangan dipanggil otomatis atau berkala — hanya untuk
         mengisi baris lama, lalu tinggalkan. */
      if (url.pathname === "/api/isi-nama") {
        const { results } = await env.DB.prepare(
          `SELECT id, lat, lon FROM pelanggaran
            WHERE (ruas_dekat IS NULL OR ruas_dekat = '')
              AND lat IS NOT NULL AND lon IS NOT NULL
            LIMIT 15`
        ).all();

        const perintah = [];
        for (const r of results || []) {
          const dk = ruasTerdekat(r.lat, r.lon);
          if (!dk.nama) continue;
          perintah.push(
            env.DB.prepare(`UPDATE pelanggaran SET ruas_dekat = ?, jarak_ruas = ? WHERE id = ?`)
              .bind(dk.nama, dk.jarak, r.id)
          );
        }
        if (perintah.length) await env.DB.batch(perintah);

        const sisa = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM pelanggaran
            WHERE (ruas_dekat IS NULL OR ruas_dekat = '')
              AND lat IS NOT NULL AND lon IS NOT NULL`
        ).first();
        return json({ diisi: perintah.length, sisa: sisa?.n ?? 0 });
      }

      /* Versi 12: khusus admin (token login Supabase di header Authorization). */
      if (url.pathname === "/api/hapus") return await hapusKejadian(env, req);
      if (url.pathname === "/api/pulihkan") return await pulihkanKejadian(env, req);
      if (url.pathname === "/api/terhapus") return await daftarTerhapus(env, req, url);

if (url.pathname === "/api/uji") return json(await periksa(env));

      if (url.pathname === "/api/reconnect") {
        await login(env);
        const units = await ambilUnit(env);
        return json({ ok: true, jumlah_unit: units.length });
      }

      return json({ error: "alamat tidak dikenal" }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  /* Tiap menit beberapa pemicu menyala. Masing-masing mengklaim blok kosong
     pertama (A → B → C) dan menjalankannya dengan jatah CPU 10 ms sendiri
     (§21.11). Tulisan ekspresi cron-nya tidak berpengaruh. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const cron = String(event.cron ?? "");
      // Diratakan ke awal menit, supaya semua pemicu sepakat menit mana yang dikerjakan.
      const T = Math.floor((Number(event.scheduledTime) || Date.now()) / 60000) * 60000;

      /* Klaim SEKARANG, begitu pemicu datang. Tiap klaim satu langkah atomik di D1,
         jadi dua pemanggilan tidak pernah memegang blok yang sama. */
      let saya = null;
      try {
        for (const b of BLOK) {
          if (menang(await perintahKlaim(env, b.nama, T, b.nama, cron).run())) { saya = b.nama; break; }
        }
      } catch (e) {
        console.log(`pemicu "${cron}" klaim gagal, menit ini dilewati: ${String(e.message || e)}`);
        return;
      }
      if (!saya) {
        console.log(`pemicu "${cron}": ketiga blok menit ini sudah dipegang, dilewati`);
        return;
      }
      console.log(`blok=${saya} diklaim pemicu "${cron}" isolate=${isolateBaru ? "baru" : "lama"}`);
      isolateBaru = false;

      /* Blok sendiri. State dibaca sesudah blok sebelumnya menyimpan (versi 15).
         Kalau state tidak terbaca, menit ini dilewati utuh (§21.8). */
      await tidurSampai(T + BLOK_PETA[saya].mulai);
      let s;
      try {
        s = await muatSimpananBlok(env, saya, T);
      } catch (e) {
        console.log(`blok=${saya} dilewati, state tidak terbaca: ${String(e.message || e)}`);
        await tandaiTanpaSimpan(env, saya, T);
        return;
      }
      await sesuaikanJalan(env, s);
      await muatMesin(env);
      if (saya !== "A") {
        await jalankanBlok(env, saya, T, saya, s);
        return;
      }

      /* A, menit kelipatan lima: tanya gudang data site apakah ada jalan versi
         baru. Versi baru langsung dipakai putaran blok ini, dan disimpan ke kv
         dalam batch yang sama dengan state supaya blok B/C ikut memakainya. */
      const jalan = (new Date(T).getUTCMinutes() % JALAN_TIAP_MENIT === 0) ? await periksaGudangJalan(env) : [];
      await jalankanBlok(env, "A", T, "A", s, { jalan });

      /* Versi 13: sesudah blok A selesai (sesi Wialon pasti segar), petakan
         sensor mesin beberapa unit. Dipakai mulai putaran berikutnya. */
      try {
        if (await petakanMesin(env, Object.keys(s.u))) {
          const gm = await simpanMesin(env);
          if (gm) console.log(`peta mesin gagal disimpan: ${gm}`);
        }
      } catch (e) {
        console.log(`peta mesin gagal: ${String(e.message || e)}`);
      }

      /* Versi 15 (§17 butir 36): A mengambil alih B dan C SATU PER SATU, sesaat
         sebelum jendela masing-masing (detik 18 dan 38), bukan sekaligus di akhir
         bloknya (detik ±11) seperti versi 8–14. Cloudflare menyalakan pemicu
         dengan selisih 5–23 detik (§21.14): pemicu kedua dan ketiga baru datang di
         detik ±21 dan ±23, saat B dan C sudah diklaim A — jadi satu pemanggilan
         selalu memikul keenam putaran. Sekarang pemicu yang datang sebelum detik
         38 masih mendapat C, dan yang datang sebelum detik 18 mendapat B. Jadwal
         cek tidak berubah: B tetap mulai di detik 20 dan C di detik 40, siapa pun
         pemiliknya. Klaimnya satu langkah atomik seperti biasa. */
      let pegangB = false;
      if (await ambilAlih(env, "B", T, cron)) {
        console.log("blok=B tidak diklaim pemiliknya sampai detik 18 — diambil alih A");
        // Tidak ada pemanggilan lain yang menyentuh state di antaranya: yang dipegang masih segar.
        await jalankanBlok(env, "B", T, "A", s);
        pegangB = true;
      }
      if (await ambilAlih(env, "C", T, cron)) {
        console.log("blok=C tidak diklaim pemiliknya sampai detik 38 — diambil alih A");
        if (!pegangB) {
          // B dijalankan pemanggilan lain: state dibaca ulang sesudah B menyimpan.
          await tidurSampai(T + BLOK_PETA.C.mulai);
          try { s = await muatSimpananBlok(env, "C", T); await sesuaikanJalan(env, s); }
          catch (e) { console.log(`blok=C dilewati, state tidak terbaca: ${String(e.message || e)}`); s = null; }
        }
        if (s) await jalankanBlok(env, "C", T, "A", s);
        else await tandaiTanpaSimpan(env, "C", T);
      }

      const d = new Date(T);
      if (d.getUTCHours() === 15 && d.getUTCMinutes() < 2) await bersihkan(env);
    })());
  },
};
