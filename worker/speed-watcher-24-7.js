// =============================================================================
// Speed Watcher 24/7 — Cloudflare Worker
// Versi 7 (21 September 2026)
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
// Versi 7 memperbaiki BATAS CPU lagi — 21 September 2026, 1.000+ pelampauan
// dalam 24 jam, 8,3% pemanggilan gagal, dan seluruhnya bertipe "Exceeded CPU
// Time Limits". Errornya rata ±14 per 15 menit sementara jumlah pemanggilan
// naik-turun antara 100 dan 260: laju tetap seperti itu hanya mungkin datang
// dari cron, bukan dari permintaan halaman.
//
// Yang DIUKUR lebih dulu, supaya perbaikannya tidak menebak. Jalur panas v6
// direplikasi di Node dengan armada 45 unit, 6 putaran, state ±25 KB, 12 kali
// ulang:
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
//     putaran — 6 kali per menit per unit. Empat unit melanggar berarti ±24
//     penulisan per menit, padahal nilainya sudah diperbarui di memori dan
//     hasil akhirnya sama saja. Sekarang penulisan dikumpulkan lalu dikirim
//     SEKALI di akhir pemanggilan, dalam satu `batch` D1.
//     Deteksi tidak disentuh sedikit pun: aturan, ambang, dan urutannya sama.
//     Yang berubah hanya KAPAN barisnya menyentuh D1.
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
// Kalau setelah ini error CPU belum nol, sisanya ada di enam panggilan Wialon
// itu sendiri, dan pilihan berikutnya adalah menurunkan TICK_COUNT menjadi 3
// (resolusi 10 → 20 detik) atau pindah ke Workers Paid.
//
// > Pelajaran umum, sama dengan §21.6: pekerjaan yang benar tapi diulang pada
// > tiap putaran menghabiskan anggaran yang tidak kelihatan di kode.
//
// Binding yang dibutuhkan: D1 bernama `DB`, secret `WIALON_TOKEN`.
// Cron: * * * * *
// =============================================================================

const HOST = "https://hst-api.wialon.com";

// ====== BATAS KECEPATAN — ketentuan tetap, ubah hanya lewat kajian ======
//
// Batas untuk posisi yang tidak jatuh di ruas mana pun: area loading, dumping,
// stockpile, workshop. Juga dipakai halaman sebagai batas umum.
const BATAS_LUAR = 35;        // km/jam
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
const TOLERANSI_RUAS = 20;

/* Geometri jalan: 30 polyline, 493 titik, dari Koordinat_Jalan_Mei2026 (EPSG:32652)
   lewat AMORA. `bb` adalah kotak batas [lonMin, latMin, lonMax, latMax] yang
   dipakai sebagai saringan awal supaya perhitungan jarak yang berat dilewati.

   SALINAN KEDUA. Geometri yang sama juga ada di speed-watcher.html untuk
   menggambar peta. Kalau jaringan jalan diperbarui di AMORA, KEDUANYA harus
   di-regen bersama — kalau tidak, server dan layar akan menilai ruas berbeda. */
const RUAS = [{"n":"RD_EFO","b":15,"bb":[128.325754,0.792975,128.325759,0.793106],"p":[[128.325754,0.793106],[128.325759,0.792975]]},{"n":"RD_EFO","b":15,"bb":[128.324438,0.788403,128.325768,0.792761],"p":[[128.325768,0.792761],[128.3256,0.792506],[128.325383,0.792316],[128.325044,0.791906],[128.324873,0.791655],[128.324709,0.791332],[128.324563,0.791095],[128.324484,0.790937],[128.324442,0.790764],[128.324438,0.790499],[128.324499,0.79037],[128.324492,0.790208],[128.324531,0.790068],[128.324684,0.789802],[128.324759,0.789659],[128.324791,0.789242],[128.324866,0.789023],[128.324963,0.788865],[128.325034,0.788653],[128.325202,0.788449],[128.325275,0.788403]]},{"n":"RD_Alur1","b":25,"bb":[128.325275,0.785006,128.326735,0.788403],"p":[[128.325275,0.788403],[128.325569,0.788223],[128.32624,0.787957],[128.326464,0.787831],[128.326628,0.78763],[128.326735,0.787365],[128.326725,0.78725],[128.326636,0.787052],[128.326547,0.786905],[128.326475,0.786722],[128.326415,0.786481],[128.326318,0.786226],[128.326194,0.786022],[128.32614,0.785867],[128.326072,0.785523],[128.326062,0.7853],[128.326037,0.785164],[128.325987,0.785042],[128.325961,0.785006]]},{"n":"RD_Alur2","b":30,"bb":[128.324443,0.782613,128.325961,0.785006],"p":[[128.325961,0.785006],[128.325919,0.784948],[128.325734,0.78484],[128.325609,0.784801],[128.325498,0.784697],[128.325345,0.784474],[128.325131,0.784302],[128.32497,0.784244],[128.324874,0.784151],[128.324781,0.784011],[128.324617,0.783684],[128.324475,0.783436],[128.324443,0.783264],[128.324503,0.782973],[128.324568,0.782744],[128.324574,0.782613]]},{"n":"RD_Alur3","b":30,"bb":[128.324154,0.779638,128.325385,0.782613],"p":[[128.324574,0.782613],[128.324578,0.782384],[128.324529,0.782234],[128.324457,0.781896],[128.324472,0.781713],[128.324443,0.781394],[128.324293,0.780769],[128.32424,0.780589],[128.32419,0.780388],[128.324158,0.780205],[128.324154,0.780004],[128.324254,0.779803],[128.324472,0.779724],[128.324804,0.779638],[128.325007,0.779652],[128.325224,0.779681],[128.325385,0.779789]]},{"n":"RD_Bicoli","b":30,"bb":[128.325385,0.779789,128.327963,0.783128],"p":[[128.325385,0.779789],[128.325442,0.779914],[128.325453,0.780177],[128.325438,0.78037],[128.325417,0.780543],[128.325445,0.780769],[128.325549,0.780938],[128.325666,0.781027],[128.325852,0.78115],[128.326016,0.781243],[128.326298,0.781351],[128.326579,0.78148],[128.326765,0.781627],[128.326997,0.781846],[128.327268,0.782274],[128.327428,0.7825],[128.327574,0.782758],[128.327774,0.782974],[128.327963,0.783128]]},{"n":"RD_Buli","b":30,"bb":[128.327963,0.783128,128.329325,0.784978],"p":[[128.327963,0.783128],[128.32827,0.783222],[128.328612,0.78339],[128.328812,0.783477],[128.329026,0.783649],[128.329101,0.783832],[128.329108,0.784015],[128.329101,0.784188],[128.329129,0.784389],[128.329176,0.784572],[128.329272,0.784791],[128.329325,0.784978]]},{"n":"RD_Subaim","b":30,"bb":[128.329325,0.784978,128.332471,0.78551],"p":[[128.332471,0.78551],[128.332386,0.785465],[128.331955,0.785324],[128.331613,0.785168],[128.331344,0.785089],[128.331154,0.785065],[128.330928,0.785079],[128.330707,0.785125],[128.330236,0.785173],[128.329832,0.785134],[128.329675,0.785108],[128.329542,0.785065],[128.329325,0.784978]]},{"n":"RD_Atom","b":35,"bb":[128.33859,0.788689,128.3386,0.788692],"p":[[128.3386,0.788692],[128.33859,0.788689]]},{"n":"RD_Atom","b":35,"bb":[128.332471,0.78551,128.342989,0.791159],"p":[[128.332471,0.78551],[128.332819,0.7857],[128.333024,0.78584],[128.333326,0.785982],[128.333751,0.786072],[128.333939,0.786101],[128.334152,0.786193],[128.334622,0.786501],[128.334742,0.786591],[128.334818,0.786679],[128.335378,0.787266],[128.335565,0.787449],[128.335879,0.787685],[128.335982,0.787723],[128.336128,0.787813],[128.336288,0.787983],[128.336432,0.788192],[128.336567,0.788315],[128.336779,0.788411],[128.33711,0.788518],[128.337281,0.788629],[128.33745,0.788765],[128.337636,0.78884],[128.337878,0.788809],[128.338129,0.788748],[128.338255,0.788736],[128.338443,0.788733],[128.338658,0.788669],[128.338877,0.788664],[128.338999,0.788643],[128.339527,0.788499],[128.339624,0.788459],[128.340435,0.788243],[128.340621,0.788135],[128.341019,0.787657],[128.34116,0.787509],[128.341354,0.787366],[128.341436,0.787272],[128.341523,0.787186],[128.341658,0.787103],[128.34181,0.787042],[128.342008,0.787058],[128.34237,0.7871],[128.342522,0.787167],[128.342624,0.787253],[128.342706,0.787479],[128.342748,0.787804],[128.342799,0.788036],[128.342891,0.788193],[128.342925,0.788327],[128.342989,0.788532],[128.342984,0.788708],[128.342923,0.78889],[128.342866,0.788986],[128.342744,0.789162],[128.342645,0.789279],[128.342586,0.789336],[128.34254,0.789446],[128.342481,0.789539],[128.341941,0.79055],[128.341852,0.790692],[128.341781,0.790882],[128.341696,0.791029],[128.341579,0.791159]]},{"n":"RD_Atom","b":35,"bb":[128.331545,0.787216,128.33155,0.787217],"p":[[128.331545,0.787217],[128.33155,0.787216]]},{"n":"RD_Atom","b":35,"bb":[128.332386,0.785465,128.332387,0.785465],"p":[[128.332386,0.785465],[128.332387,0.785465]]},{"n":"RD_Atom","b":35,"bb":[128.328348,0.781783,128.328349,0.781785],"p":[[128.328349,0.781783],[128.328348,0.781785]]},{"n":"RD_Atom","b":35,"bb":[128.330525,0.781088,128.330536,0.781104],"p":[[128.330525,0.781104],[128.330536,0.781088]]},{"n":"RD_Atom","b":35,"bb":[128.331525,0.786869,128.331527,0.78687],"p":[[128.331525,0.786869],[128.331527,0.78687]]},{"n":"RD_ParaPara","b":30,"bb":[128.331186,0.790836,128.336892,0.792943],"p":[[128.331186,0.790836],[128.331288,0.790978],[128.331399,0.791173],[128.331513,0.791298],[128.331718,0.791436],[128.332312,0.791707],[128.332586,0.791865],[128.332847,0.791992],[128.333116,0.792004],[128.333311,0.792061],[128.334243,0.79243],[128.334507,0.792495],[128.334707,0.792562],[128.335192,0.792696],[128.335598,0.792794],[128.336045,0.792861],[128.336416,0.792943],[128.336709,0.792943],[128.336851,0.792852],[128.336892,0.792648],[128.336851,0.792261],[128.336864,0.792117]]},{"n":"RD_ParaPara","b":30,"bb":[128.33686,0.79039,128.337535,0.792117],"p":[[128.337535,0.79039],[128.337486,0.790495],[128.337452,0.791091],[128.33735,0.791361],[128.337241,0.791545],[128.337098,0.791749],[128.336901,0.79196],[128.33686,0.79211],[128.336864,0.792117]]},{"n":"RD_ParaPara","b":30,"bb":[128.337532,0.788689,128.338784,0.79039],"p":[[128.337535,0.79039],[128.337532,0.790202],[128.337611,0.789858],[128.337728,0.789391],[128.337871,0.789305],[128.338124,0.789244],[128.338435,0.789082],[128.33872,0.78891],[128.338784,0.788817],[128.338652,0.788709],[128.33859,0.788689]]},{"n":"RD_SubaimBawah","b":30,"bb":[128.32915,0.784978,128.331618,0.790999],"p":[[128.329325,0.784978],[128.329332,0.785135],[128.329257,0.785451],[128.32919,0.785674],[128.329161,0.7859],[128.32915,0.786141],[128.329179,0.786586],[128.329186,0.786949],[128.329339,0.787243],[128.329468,0.787419],[128.329785,0.787904],[128.330281,0.788496],[128.330616,0.788726],[128.331054,0.78911],[128.331301,0.789419],[128.331618,0.790069],[128.331596,0.79046],[128.331539,0.790669],[128.331436,0.790791],[128.331318,0.790834],[128.331076,0.790837],[128.330698,0.790791],[128.330541,0.79078],[128.32987,0.790783],[128.329863,0.790898],[128.329809,0.790999]]},{"n":"RD_Wayamli","b":30,"bb":[128.325385,0.778241,128.327434,0.781473],"p":[[128.327434,0.781473],[128.327406,0.781279],[128.327327,0.781049],[128.327227,0.780568],[128.32722,0.78031],[128.327106,0.779505],[128.327064,0.779139],[128.327049,0.778306],[128.326928,0.778241],[128.326793,0.778478],[128.326736,0.778636],[128.326629,0.778679],[128.326493,0.778636],[128.326343,0.77855],[128.326058,0.778493],[128.325922,0.778521],[128.325794,0.778701],[128.325751,0.778923],[128.325794,0.779153],[128.325865,0.779433],[128.325908,0.779649],[128.325687,0.779692],[128.325558,0.779692],[128.325466,0.779735],[128.325385,0.779789]]},{"n":"RD_Harmoni","b":30,"bb":[128.326997,0.780799,128.332256,0.78194],"p":[[128.326997,0.781846],[128.327106,0.781652],[128.32722,0.781523],[128.327434,0.781473],[128.328197,0.781746],[128.328611,0.781854],[128.329011,0.78194],[128.329417,0.781868],[128.329731,0.781674],[128.329895,0.781473],[128.330152,0.781251],[128.330423,0.781157],[128.330823,0.780949],[128.331151,0.780863],[128.33175,0.780799],[128.332121,0.780835],[128.332256,0.78105],[128.331935,0.781273]]},{"n":"RD_Kasuari","b":35,"bb":[128.330525,0.778163,128.332414,0.781104],"p":[[128.330525,0.781104],[128.330816,0.780662],[128.330908,0.780246],[128.330894,0.780044],[128.33103,0.779772],[128.331229,0.779585],[128.331479,0.779535],[128.331743,0.779449],[128.332135,0.779312],[128.332257,0.779248],[128.332349,0.779018],[128.332414,0.778738],[128.332114,0.778565],[128.331843,0.778364],[128.33175,0.778163]]},{"n":"RD_Reksol","b":35,"bb":[128.333375,0.784607,128.334694,0.786378],"p":[[128.334694,0.786378],[128.334052,0.78604],[128.333802,0.785878],[128.333636,0.785543],[128.333571,0.78525],[128.333375,0.784753],[128.333388,0.784607],[128.333383,0.784668]]},{"n":"RD_Reksol","b":35,"bb":[128.334694,0.785215,128.341535,0.787427],"p":[[128.334694,0.786378],[128.334908,0.786285],[128.335304,0.786238],[128.335742,0.786112],[128.336028,0.785922],[128.33632,0.785423],[128.336545,0.785276],[128.336827,0.785215],[128.337105,0.785326],[128.337208,0.785492],[128.337262,0.785657],[128.33724,0.785861],[128.337119,0.78608],[128.337069,0.786274],[128.337083,0.786475],[128.33719,0.786741],[128.337251,0.786921],[128.337358,0.787125],[128.337629,0.787326],[128.337993,0.787427],[128.338246,0.787391],[128.338599,0.787283],[128.338884,0.78724],[128.339252,0.787255],[128.340036,0.787427],[128.340322,0.787391],[128.340511,0.787244],[128.340853,0.787054],[128.341345,0.786975],[128.341515,0.78699],[128.34153,0.787007],[128.341535,0.787178],[128.34153,0.787007]]},{"n":"RD_Sofifi","b":35,"bb":[128.330835,0.78551,128.332471,0.789058],"p":[[128.330995,0.789058],[128.330914,0.788912],[128.330835,0.788792],[128.330864,0.788667],[128.331156,0.788294],[128.331251,0.788153],[128.331427,0.787945],[128.33151,0.787806],[128.331544,0.78772],[128.331546,0.787466],[128.331556,0.787296],[128.33153,0.787097],[128.331527,0.78687],[128.331553,0.786494],[128.33166,0.78631],[128.331832,0.786054],[128.332008,0.785862],[128.3323,0.785623],[128.332448,0.785561],[128.332471,0.78551]]},{"n":"RD_Sosolat","b":35,"bb":[128.332387,0.781384,128.335669,0.785465],"p":[[128.332387,0.785465],[128.332684,0.785406],[128.33287,0.785327],[128.333116,0.785137],[128.333266,0.784921],[128.333389,0.784607],[128.333404,0.784448],[128.33328,0.783957],[128.333387,0.783317],[128.333571,0.782946],[128.333791,0.782395],[128.333833,0.782054],[128.334017,0.781659],[128.334195,0.781486],[128.334433,0.781384],[128.33476,0.781414],[128.335004,0.781462],[128.335188,0.781654],[128.335355,0.781965],[128.335533,0.78215],[128.335658,0.782312],[128.335669,0.782629],[128.335592,0.78288]]},{"n":"RD_Pos2","b":35,"bb":[128.335004,0.78008,128.338368,0.782624],"p":[[128.335004,0.781462],[128.335164,0.781348],[128.335301,0.781151],[128.335396,0.780894],[128.335664,0.780511],[128.335878,0.78011],[128.336074,0.78008],[128.336312,0.78017],[128.336603,0.780224],[128.336859,0.780236],[128.337132,0.780326],[128.337186,0.780475],[128.337049,0.780613],[128.336978,0.780828],[128.337049,0.781014],[128.337287,0.781169],[128.337631,0.781235],[128.337857,0.781493],[128.337976,0.781756],[128.33816,0.782127],[128.338368,0.78239],[128.338327,0.782624]]},{"n":"RD_Utara","b":35,"bb":[128.331186,0.78825,128.334673,0.791553],"p":[[128.331186,0.78825],[128.331418,0.788382],[128.332188,0.788698],[128.332805,0.789029],[128.333483,0.789219],[128.333757,0.789223],[128.333996,0.789309],[128.334171,0.789517],[128.33431,0.789772],[128.334378,0.789945],[128.334399,0.790207],[128.334424,0.790372],[128.33442,0.79053],[128.334392,0.790849],[128.334417,0.791072],[128.334499,0.791255],[128.334673,0.791402],[128.334673,0.791553]]},{"n":"RD_ParaParaBawah","b":30,"bb":[128.336864,0.78996,128.339959,0.793245],"p":[[128.336864,0.792117],[128.336986,0.792314],[128.337191,0.792776],[128.337317,0.793034],[128.337426,0.793231],[128.337604,0.793245],[128.337716,0.793082],[128.33784,0.792745],[128.337966,0.79252],[128.338149,0.792448],[128.33838,0.792434],[128.338734,0.792489],[128.339012,0.792448],[128.339164,0.792398],[128.339433,0.792163],[128.339554,0.791993],[128.339259,0.791409],[128.33921,0.791237],[128.339217,0.791069],[128.339298,0.791002],[128.339469,0.790928],[128.339778,0.790828],[128.339916,0.790718],[128.339954,0.790512],[128.339959,0.79034],[128.339898,0.790173],[128.339852,0.790024],[128.339842,0.78996]]},{"n":"RD_Triwan","b":30,"bb":[128.337535,0.788284,128.340798,0.79039],"p":[[128.340287,0.788284],[128.340368,0.788401],[128.340504,0.788568],[128.340615,0.788757],[128.340775,0.788942],[128.340798,0.789054],[128.340713,0.789179],[128.340608,0.789306],[128.340539,0.78942],[128.340432,0.789564],[128.34027,0.789684],[128.340101,0.789837],[128.339754,0.790002],[128.339001,0.790165],[128.338798,0.790174],[128.338534,0.790169],[128.338232,0.790179],[128.337752,0.790231],[128.337576,0.790301],[128.337535,0.79039]]}];

const FLAGS      = 1025;      // 1 = nama unit, 1024 = pesan terakhir + lokasi
const TICK_MS    = 10000;     // ambil data tiap 10 detik
const TICK_COUNT = 6;         // 6 kali per menit
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

// Bertahan selama isolate hidup, jadi pekerjaan sekali-jalan tidak diulang
// pada tiap permintaan.
let tabelSiap = false;
let sidCache = null;

// Ringkasan shift untuk kartu Home dipakai bersama selama ini, lintas tab dan
// lintas isolate (lewat baris `kv`), supaya jumlah penonton tidak melipatgandakan
// pembacaan D1. Halaman menariknya tiap 60 detik, jadi 55 detik tidak menambah
// keterlambatan yang terasa.
const RINGKAS_SEGAR = 55000;  // ms
let ringkasMem = null;

// Kejadian yang masih berstatus berjalan tapi tidak diperbarui selama ini
// dianggap yatim dan ditutup oleh pembersihan harian. Cron sendiri menutup
// kejadian menggantung setelah 15 menit, jadi satu jam hanya mengenai baris yang
// state-nya benar-benar hilang.
const YATIM_MS = 3600000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d, null, 2), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tanggalWIT = (ms) => new Date(ms + WIT).toISOString().slice(0, 10);

async function wialon(svc, params, sid) {
  const u = new URL(`${HOST}/wialon/ajax.html`);
  u.searchParams.set("svc", svc);
  u.searchParams.set("params", JSON.stringify(params));
  if (sid) u.searchParams.set("sid", sid);
  return (await fetch(u, { method: "POST" })).json();
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
  let sid = sidCache || (await ambilKV(env, "sid"));
  if (!sid) sid = await login(env);
  sidCache = sid;

  const spec = {
    spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
    force: 1, flags: FLAGS, from: 0, to: 0,
  };

  let r = await wialon("core/search_items", spec, sid);
  if (r.error) {
    sidCache = null;
    sid = await login(env);
    r = await wialon("core/search_items", spec, sid);
    if (r.error) throw new Error(`ambil unit gagal, kode ${r.error}`);
  }

  return (r.items || []).map((it) => ({
    id: it.id,
    nama: it.nm,
    lat: it.pos?.y ?? null,
    lon: it.pos?.x ?? null,
    kecepatan: it.pos?.s ?? null,
    arah: it.pos?.c ?? null,
    satelit: it.pos?.sc ?? null,
    waktu: it.pos?.t ? it.pos.t * 1000 : null,
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
function jarakKeSegmen(lon, lat, x1, y1, x2, y2) {
  const m = skalaDerajat(lat);
  const px = (lon - x1) * m.x, py = (lat - y1) * m.y;
  const vx = (x2 - x1) * m.x, vy = (y2 - y1) * m.y;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? (px * vx + py * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - vx * t, py - vy * t);
}

/* Ruas mana yang berlaku di satu titik.

   Memeriksa 493 titik untuk tiap unit, enam kali per menit, memakan ~35 ms CPU
   — tiga kali anggaran paket gratis. Karena itu ruas jalan diindeks ke grid sel
   ~55 m sekali per isolate: pencarian tinggal mengambil daftar penggal jalan di
   sel tempat unit berada, biasanya nol sampai beberapa saja.

   Bila beberapa ruas bertumpang tindih — hal biasa di persimpangan — yang
   dipakai adalah BATAS TERENDAH, aturan yang sama dengan limitFor() di halaman. */
/* Batas terendah yang ada di tabel. Di bawah angka ini tidak ada yang bisa
   dilanggar, jadi pencocokan ruas boleh dilewati sama sekali. */
const BATAS_MIN = RUAS.reduce((m, r) => Math.min(m, r.b), BATAS_LUAR);

const SEL = 0.0005;               // sisi sel grid, derajat
const PAD_SEL = 0.00025;          // pelebaran kotak penggal, ~28 m
let grid = null;

function bangunGrid() {
  grid = new Map();
  for (let i = 0; i < RUAS.length; i++) {
    const p = RUAS[i].p;
    for (let j = 0; j < p.length - 1; j++) {
      const x1 = p[j][0], y1 = p[j][1], x2 = p[j + 1][0], y2 = p[j + 1][1];
      const xa = Math.floor((Math.min(x1, x2) - PAD_SEL) / SEL);
      const xb = Math.floor((Math.max(x1, x2) + PAD_SEL) / SEL);
      const ya = Math.floor((Math.min(y1, y2) - PAD_SEL) / SEL);
      const yb = Math.floor((Math.max(y1, y2) + PAD_SEL) / SEL);
      for (let a = xa; a <= xb; a++) {
        for (let b = ya; b <= yb; b++) {
          const k = a + ":" + b;
          let arr = grid.get(k);
          if (!arr) { arr = []; grid.set(k, arr); }
          arr.push([i, x1, y1, x2, y2]);
        }
      }
    }
  }
}

function cariRuas(lat, lon) {
  if (!grid) bangunGrid();
  const arr = grid.get(Math.floor(lon / SEL) + ":" + Math.floor(lat / SEL));
  if (!arr) return { nama: null, batas: BATAS_LUAR };

  let nama = null, batas = BATAS_LUAR;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i], r = RUAS[e[0]];
    // Ruas yang tidak akan menurunkan batas tidak perlu diukur jaraknya.
    if (nama !== null && r.b >= batas) continue;
    if (jarakKeSegmen(lon, lat, e[1], e[2], e[3], e[4]) > TOLERANSI_RUAS) continue;
    nama = r.n; batas = r.b;
  }
  return { nama, batas };
}

/* Ruas TERDEKAT dari sebuah titik, tanpa batas jarak. Dipakai hanya untuk
   MENAMAI pelanggaran yang terjadi di luar semua ruas — area loading, dumping,
   stockpile — supaya peringkat di halaman Home tidak menumpuk di satu kantong
   "Di luar ruas" yang tidak memberi tahu apa-apa.

   Ini penamaan, BUKAN penilaian: pelanggarannya tetap dinilai dengan
   BATAS_LUAR, dan kolom `ruas` tetap kosong. Sengaja memindai seluruh 493 titik
   karena indeks grid hanya mengenal sel di sekitar jalan, sedangkan titik yang
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

/* Pembacaan yang tidak masuk akal dibuang sebelum sempat menuduh siapa pun.
   Alasannya sama dengan tab "Ditolak" di halaman. */
function sampelSah(s, prev, nowDetik) {
  if (!koordSah(s.lat, s.lon)) return false;
  if (!Number.isFinite(s.speed) || s.speed < 0 || s.speed > KEC_MAKS) return false;
  if (s.sat != null && s.sat < MIN_SATELIT) return false;
  if (nowDetik - s.t > UMUR_MAKS) return false;
  if (prev) {
    const dt = s.t - prev.t;
    if (dt <= 0) return false;
    if (koordSah(prev.lat, prev.lon)) {
      const jarak = haversine(prev.lat, prev.lon, s.lat, s.lon);
      if (dt <= LOMPAT_DT && jarak > LOMPAT_M) return false;
      if ((jarak / dt) * 3.6 > KEC_MAKS) return false;
    }
  }
  return true;
}

async function bukaPelanggaran(env, u, ev) {
  const r = await env.DB.prepare(
    `INSERT INTO pelanggaran
       (unit_id, unit, tanggal, mulai, selesai, kecepatan_max, kecepatan_rata,
        sampel, batas, ruas, ruas_dekat, jarak_ruas, lat, lon, berjalan)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
  ).bind(u.id, u.nama, tanggalWIT(ev.tStart * 1000), ev.tStart * 1000, ev.tEnd * 1000,
         ev.maxSpeed, ev.sum / ev.n, ev.n, ev.batas, ev.ruas, ev.ruasDekat, ev.jarak,
         ev.lat, ev.lon).run();
  return r.meta.last_row_id;
}

function perintahPerbarui(env, id, ev, tutup) {
  return env.DB.prepare(
    `UPDATE pelanggaran SET selesai=?, kecepatan_max=?, kecepatan_rata=?,
       sampel=?, lat=?, lon=?, berjalan=? WHERE id=?`
  ).bind(ev.tEnd * 1000, ev.maxSpeed, ev.sum / ev.n, ev.n, ev.lat, ev.lon,
         tutup ? 0 : 1, id);
}

/* Pembaruan baris pelanggaran DITUNDA sampai akhir pemanggilan (§21.9).

   Selama sebuah unit melanggar, versi 6 menulis ulang barisnya pada tiap
   putaran — enam kali per menit per unit — padahal nilai yang ditulis sudah
   diperbarui di memori dan hanya keadaan TERAKHIR yang berarti. Enam putaran
   berbagi satu anggaran CPU 10 ms, jadi penulisan berulang itulah yang paling
   besar memakannya.

   Kuncinya nomor baris, bukan nomor unit: satu unit bisa menutup satu kejadian
   lalu membuka kejadian baru dalam menit yang sama, dan keduanya harus tetap
   tertulis masing-masing. Nilai yang disimpan adalah RUJUKAN ke objek `ev`,
   jadi kejadian yang masih berjalan otomatis terbawa nilai terbarunya saat
   disiram; kejadian yang sudah ditutup tidak berubah lagi.

   INSERT pembuka TIDAK ditunda — nomor barisnya dibutuhkan saat itu juga. */
function tundaTulis(tunda, id, ev, tutup) {
  if (id == null || !ev) return;
  tunda.set(id, { ev, tutup });
}

async function siramTunda(env, tunda) {
  if (!tunda.size) return 0;
  const perintah = [];
  for (const [id, t] of tunda) perintah.push(perintahPerbarui(env, id, t.ev, t.tutup));
  tunda.clear();
  // Dipecah karena satu batch D1 punya batas jumlah perintah.
  for (let i = 0; i < perintah.length; i += 50) {
    await env.DB.batch(perintah.slice(i, i + 50));
  }
  return perintah.length;
}

/* State dibaca sekali di awal pemanggilan dan ditulis sekali di akhir. Membaca
   lalu menulis ulang ±25 KB JSON pada tiap putaran menghabiskan anggaran CPU
   10 ms sebelum enam putaran selesai. */
async function muatState(env) {
  /* Galat baca D1 SENGAJA dibiarkan naik. Versi 5 membungkus pembacaan ini di
     dalam try, sehingga saat kuota baca habis state dianggap kosong: cron lalu
     berjalan tanpa ingatan dan bisa menimpa state tersimpan, dan kejadian yang
     sedang terbuka tidak pernah ditutup. Yang boleh jatuh ke kosong hanya isi
     yang rusak, bukan pembacaan yang gagal. */
  const teks = await ambilKV(env, "state");
  let simpan = {};
  try { simpan = JSON.parse(teks || "{}"); } catch (e) { simpan = {}; }
  return (simpan && typeof simpan.u === "object" && simpan.u) ? simpan.u : {};
}

async function simpanState(env, state, jumlahUnit) {
  await simpanKV(env, "state",
    JSON.stringify({ u: state, cek: Date.now(), jumlah: jumlahUnit }));
}

/* Satu putaran pemeriksaan seluruh armada. `state` dibawa masuk dan diubah di
   tempat; pemanggilnya yang bertanggung jawab menyimpannya. */
async function satuPutaran(env, state, tunda) {
  const units = await ambilUnit(env, false);
  const nowDetik = Math.floor(Date.now() / 1000);

  let sah = 0, ditolak = 0, basi = 0, melanggar = 0;

  for (const u of units) {
    const k = String(u.id);
    if (!state[k]) state[k] = { t: 0, sah: null, buf: [], ov: 0, un: 0, ev: null, id: null };
    const st = state[k];

    if (u.waktu == null) continue;
    const t = Math.floor(u.waktu / 1000);
    if (t === st.t) continue;            // pesan yang sama, bukan data baru
    st.t = t;

    if (nowDetik - t > UMUR_MAKS) { basi++; continue; }

    const s = { t, lat: u.lat, lon: u.lon, speed: u.kecepatan ?? 0, sat: u.satelit };
    if (!sampelSah(s, st.sah, nowDetik)) { ditolak++; continue; }
    sah++;
    st.sah = { t: s.t, lat: s.lat, lon: s.lon, speed: s.speed };

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
      tundaTulis(tunda, st.id, st.ev, true);
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
                  ruasDekat: dk.nama, jarak: dk.jarak };
        for (const x of st.buf.slice(-st.ov)) {
          st.ev.maxSpeed = Math.max(st.ev.maxSpeed, x.speed);
          st.ev.sum += x.speed; st.ev.n++;
        }
        st.id = await bukaPelanggaran(env, u, st.ev);
        melanggar++;
      } else if (st.ev) {
        st.ev.tEnd = s.t;
        if (s.speed >= st.ev.maxSpeed) { st.ev.lat = s.lat; st.ev.lon = s.lon; }
        st.ev.maxSpeed = Math.max(st.ev.maxSpeed, s.speed);
        st.ev.sum += s.speed; st.ev.n++;
        tundaTulis(tunda, st.id, st.ev, false);
        melanggar++;
      }
    } else {
      st.ov = 0;
      if (st.ev && nilai <= st.ev.batas - HISTERESIS) {
        st.un++;
        if (st.un >= KONFIRMASI) {
          tundaTulis(tunda, st.id, st.ev, true);
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
      tundaTulis(tunda, st.id, st.ev, true);
      st.ev = null; st.id = null; st.ov = 0; st.un = 0;
    }
  }

  return { unit: units.length, sah, ditolak, basi, melanggar };
}

/* Dipakai /api/uji: satu putaran lengkap berikut baca dan tulis state. */
async function periksa(env) {
  const state = await muatState(env);
  const tunda = new Map();
  const h = await satuPutaran(env, state, tunda);
  await siramTunda(env, tunda);
  await simpanState(env, state, h.unit);
  return h;
}

async function bersihkan(env) {
  const batas = tanggalWIT(Date.now() - SIMPAN_HARI * 86400000);
  await env.DB.prepare(`DELETE FROM pelanggaran WHERE tanggal < ?`).bind(batas).run();

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
   tua dari RINGKAS_SEGAR, D1 benar-benar menghitung ulang. `dihitung` ikut
   dikirim supaya kartu menampilkan jam hitung yang sebenarnya. */
async function ringkasShift(env, j) {
  const kunci = j.mulai + "-" + j.selesai;
  const kini = Date.now();
  const segar = (o) => !!o && o.kunci === kunci && o.waktu <= kini && kini - o.waktu < RINGKAS_SEGAR;

  if (segar(ringkasMem)) return ringkasMem.isi;

  const teks = await ambilKV(env, "ringkas");
  let simpan = null;
  try { simpan = JSON.parse(teks || "null"); } catch (e) { simpan = null; }
  if (segar(simpan)) { ringkasMem = simpan; return simpan.isi; }

  const isi = await hitungRingkas(env, j);
  isi.dihitung = kini;
  ringkasMem = { kunci, waktu: kini, isi };
  await simpanKV(env, "ringkas", JSON.stringify(ringkasMem));
  return isi;
}

/* Batas shift mengikuti aturan yang sama dengan proxy Minerva (§7):
   siang 07:00–19:00 WIT, malam 19:00–07:00. Shift malam melewati tengah malam,
   jadi jendelanya dihitung dari jam WIT berjalan, bukan dari tanggal kalender. */
function jendelaShift(paksa) {
  const witMs = Date.now() + WIT;
  const wit = new Date(witMs);
  const jam = wit.getUTCHours();
  const tengahMalam = Date.UTC(wit.getUTCFullYear(), wit.getUTCMonth(), wit.getUTCDate());

  let siang = jam >= 7 && jam < 19;
  if (paksa === "DS") siang = true;
  if (paksa === "NS") siang = false;

  let mulaiWit, selesaiWit;
  if (siang) {
    mulaiWit = tengahMalam + 7 * 3600000;
    selesaiWit = tengahMalam + 19 * 3600000;
  } else if (jam >= 19) {
    mulaiWit = tengahMalam + 19 * 3600000;
    selesaiWit = tengahMalam + 31 * 3600000;      // 07:00 keesokan hari
  } else {
    mulaiWit = tengahMalam - 5 * 3600000;         // 19:00 kemarin
    selesaiWit = tengahMalam + 7 * 3600000;
  }
  return {
    nama: siang ? "Siang" : "Malam",
    tanggal: tanggalWIT(mulaiWit - WIT),
    mulai: mulaiWit - WIT,                        // kembali ke epoch UTC
    selesai: selesaiWit - WIT,
  };
}

// ---------------------------------------------------------------- titik masuk

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    try {
      /* /api/unit dipanggil tiap 10 detik oleh setiap Speed Watcher dan tidak
         menyentuh tabel pelanggaran; /api/batas tidak menyentuh D1 sama sekali.
         Keduanya tidak menjalankan pemeriksaan skema, supaya isolate baru tidak
         membayar beberapa kueri skema di jalur yang paling ramai. Tabel kv yang
         dipakai /api/unit dibuat oleh cron dalam menit pertama Worker hidup. */
      if (url.pathname !== "/api/unit" && url.pathname !== "/api/batas") {
        await siapkanTabel(env);
      }

      if (url.pathname === "/api/unit") {
        const units = await ambilUnit(env);
        return json({
          jumlah: units.length,
          batas_luar: BATAS_LUAR,
          waktu_server: Date.now(),
          unit: units,
        });
      }

      if (url.pathname === "/api/status") {
        let meta = {};
        try { meta = JSON.parse((await ambilKV(env, "state")) || "{}"); } catch (e) {}
        const cek = Number(meta.cek) || null;
        const hariIni = tanggalWIT(Date.now());
        const p = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM pelanggaran WHERE tanggal=?`
        ).bind(hariIni).first();
        return json({
          terhubung: !!cek && Date.now() - cek < 120000,
          cek_terakhir: cek,
          jumlah_unit: Number(meta.jumlah) || 0,
          pelanggaran_hari_ini: p?.n ?? 0,
          batas_luar: BATAS_LUAR,
          jumlah_ruas: RUAS.length,
        });
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
          ruas: urut,
        });
      }

      /* Ringkasan shift berjalan untuk kartu di halaman Home shell. Dihitung satu
         kueri dan dipakai bersama lintas tab — lihat ringkasShift(). Untuk ruas,
         yang dipakai adalah ruas tempat kejadian dinilai; bila kejadiannya di luar
         semua ruas, dipakai nama ruas terdekat, supaya peringkat tidak menumpuk di
         satu kantong "Di luar ruas". */
      if (url.pathname === "/api/ringkas") {
        const j = jendelaShift(url.searchParams.get("shift"));
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

  // Cron menyala tiap menit, lalu memeriksa 6 kali dengan jeda 10 detik.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await siapkanTabel(env);

      /* Enam putaran berbagi satu anggaran CPU, jadi state hanya dibaca sekali
         di awal dan ditulis sekali di akhir. Baris pelanggaran tetap ditulis
         seketika saat kejadiannya terjadi. */
      /* Kalau state tidak terbaca — misalnya kuota baca D1 habis — menit ini
         dilewati utuh. Berjalan dengan state kosong berarti melupakan kejadian
         yang sedang terbuka, lalu menimpa state yang masih benar. */
      let state;
      try {
        state = await muatState(env);
      } catch (e) {
        console.log(`state tidak terbaca, menit ini dilewati: ${String(e.message || e)}`);
        return;
      }
      let unitTerakhir = 0;

      /* Enam baris log digabung jadi satu. Angka `sah` per putaran tetap
         tercatat — dari deret itu kelihatan apakah putaran 2–6 benar-benar
         membawa data baru atau hanya menanyakan ulang yang sama — tapi
         peristiwa observability turun dari ±8.640 jadi ±1.440 per hari. */
      const tunda = new Map();
      const deretSah = [], deretTolak = [], gagal = [];
      let totalLanggar = 0;

      for (let i = 0; i < TICK_COUNT; i++) {
        try {
          const h = await satuPutaran(env, state, tunda);
          unitTerakhir = h.unit;
          deretSah.push(h.sah); deretTolak.push(h.ditolak);
          totalLanggar += h.melanggar;
        } catch (e) {
          deretSah.push("x"); deretTolak.push("x");
          gagal.push(`${i + 1}: ${String(e.message || e)}`);
        }
        if (i < TICK_COUNT - 1) await sleep(TICK_MS);
      }

      /* Disiram sebelum state disimpan, tapi kegagalannya tidak boleh
         membatalkan penyimpanan state: state-lah yang memegang kejadian yang
         sedang terbuka. Baris yang gagal diperbarui akan tersusul menit
         berikutnya, dan kalau unitnya berhenti mengirim data, pembersihan
         harian menutup kejadian yatim. */
      let ditulis = 0;
      try {
        ditulis = await siramTunda(env, tunda);
      } catch (e) {
        gagal.push(`tulis: ${String(e.message || e)}`);
      }

      await simpanState(env, state, unitTerakhir);

      console.log(
        `unit=${unitTerakhir} sah=${deretSah.join(",")} tolak=${deretTolak.join(",")} ` +
        `langgar=${totalLanggar} tulis=${ditulis}` +
        (gagal.length ? ` | gagal ${gagal.join(" ; ")}` : "")
      );

      const d = new Date();
      if (d.getUTCHours() === 15 && d.getUTCMinutes() < 2) await bersihkan(env);
    })());
  },
};
