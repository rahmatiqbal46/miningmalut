// =============================================================================
// Speed Watcher 24/7 — Cloudflare Worker
// Versi 3 (3 September 2026)
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
//    unit digabung. Dengan 6 putaran per menit bedanya 8.640 lawan 25.920 baris
//    tertulis per hari dari kuota gratis D1 sebesar 100.000.
//
// Binding yang dibutuhkan: D1 bernama `DB`, secret `WIALON_TOKEN`.
// Cron: * * * * *
// =============================================================================

const HOST = "https://hst-api.wialon.com";

// ====== YANG BOLEH DIUBAH ======
const BATAS_KECEPATAN = 35;   // km/jam — harus sama dengan #cfgLimit di halaman
// ================================

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
  // Kolom tambahan untuk basis data yang sudah terlanjur dibuat versi 1.
  for (const k of ["kecepatan_rata REAL", "sampel INTEGER", "berjalan INTEGER DEFAULT 0"]) {
    try { await env.DB.prepare(`ALTER TABLE pelanggaran ADD COLUMN ${k}`).run(); } catch (e) {}
  }
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
  return r.eid;
}

async function ambilUnit(env) {
  let sid = await ambilKV(env, "sid");
  if (!sid) sid = await login(env);

  const spec = {
    spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
    force: 1, flags: FLAGS, from: 0, to: 0,
  };

  let r = await wialon("core/search_items", spec, sid);
  if (r.error) {
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
    batas: BATAS_KECEPATAN,
  }));
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
        sampel, batas, lat, lon, berjalan)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
  ).bind(u.id, u.nama, tanggalWIT(ev.tStart * 1000), ev.tStart * 1000, ev.tEnd * 1000,
         ev.maxSpeed, ev.sum / ev.n, ev.n, BATAS_KECEPATAN, ev.lat, ev.lon).run();
  return r.meta.last_row_id;
}

async function perbaruiPelanggaran(env, id, ev, tutup) {
  await env.DB.prepare(
    `UPDATE pelanggaran SET selesai=?, kecepatan_max=?, kecepatan_rata=?,
       sampel=?, lat=?, lon=?, berjalan=? WHERE id=?`
  ).bind(ev.tEnd * 1000, ev.maxSpeed, ev.sum / ev.n, ev.n, ev.lat, ev.lon,
         tutup ? 0 : 1, id).run();
}

/* Satu putaran pemeriksaan seluruh armada. */
async function periksa(env) {
  const units = await ambilUnit(env);
  const nowDetik = Math.floor(Date.now() / 1000);

  let simpan = {};
  try { simpan = JSON.parse((await ambilKV(env, "state")) || "{}"); } catch (e) { simpan = {}; }
  const state = (simpan && typeof simpan.u === "object" && simpan.u) ? simpan.u : {};

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

    if (nilai > BATAS_KECEPATAN) {
      st.ov++; st.un = 0;
      if (!st.ev && st.ov >= KONFIRMASI) {
        // Dibuka mundur ke sampel pertama yang melewati batas, supaya waktu
        // mulai dan kecepatan puncaknya tidak terpotong.
        const awal = st.buf.slice(-st.ov)[0] || s;
        st.ev = { tStart: awal.t, tEnd: s.t, maxSpeed: 0, sum: 0, n: 0, lat: awal.lat, lon: awal.lon };
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
        await perbaruiPelanggaran(env, st.id, st.ev, false);
        melanggar++;
      }
    } else {
      st.ov = 0;
      if (st.ev && nilai <= BATAS_KECEPATAN - HISTERESIS) {
        st.un++;
        if (st.un >= KONFIRMASI) {
          await perbaruiPelanggaran(env, st.id, st.ev, true);
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
      await perbaruiPelanggaran(env, st.id, st.ev, true);
      st.ev = null; st.id = null; st.ov = 0; st.un = 0;
    }
  }

  await simpanKV(env, "state",
    JSON.stringify({ u: state, cek: Date.now(), jumlah: units.length }));
  return { unit: units.length, sah, ditolak, basi, melanggar };
}

async function bersihkan(env) {
  const batas = tanggalWIT(Date.now() - SIMPAN_HARI * 86400000);
  await env.DB.prepare(`DELETE FROM pelanggaran WHERE tanggal < ?`).bind(batas).run();
}

// ---------------------------------------------------------------- titik masuk

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    try {
      await siapkanTabel(env);

      if (url.pathname === "/api/unit") {
        const units = await ambilUnit(env);
        return json({
          jumlah: units.length,
          batas_kecepatan: BATAS_KECEPATAN,
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
          batas_kecepatan: BATAS_KECEPATAN,
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
        const { results } = await env.DB.prepare(
          `SELECT * FROM pelanggaran WHERE tanggal=? ORDER BY mulai DESC`
        ).bind(tgl).all();
        return json({ tanggal: tgl, jumlah: results.length, pelanggaran: results });
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
      for (let i = 0; i < TICK_COUNT; i++) {
        try {
          const h = await periksa(env);
          console.log(`cek ${i + 1}/${TICK_COUNT} unit=${h.unit} sah=${h.sah} tolak=${h.ditolak} langgar=${h.melanggar}`);
        } catch (e) {
          console.log(`cek ${i + 1} gagal: ${String(e.message || e)}`);
        }
        if (i < TICK_COUNT - 1) await sleep(TICK_MS);
      }
      const d = new Date();
      if (d.getUTCHours() === 15 && d.getUTCMinutes() < 2) await bersihkan(env);
    })());
  },
};
