// =====================================================================
// OPERATOR PERFORMANCE · Edge Function "sync-minerva"
//
// Ditempel lewat Supabase → Edge Functions → Deploy a new function →
// Via Editor. Tidak butuh CLI.
//
// Secret yang dibutuhkan (Edge Functions → Secrets):
//   MINERVA_TOKEN  token Minerva, bagian setelah "token=" di address bar
//   SYNC_SECRET    kata sandi panggilan terjadwal, dibuat oleh SQL 03
// SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sudah tersedia otomatis.
//
// Tiga cara memanggil (body JSON):
//   {"mode":"rutin"}                      hari ini, kemarin, lusa kemarin (WIT)
//   {"mode":"tanggal","dari":"2026-08-01","sampai":"2026-08-07"}   maks 14 hari
//   {"mode":"mundur"}                     satu potong pengisian data lama
//
// Siapa yang boleh memanggil:
//   - penjadwal, dengan header x-sync-secret = SYNC_SECRET
//   - admin yang login (untuk tombol "Sinkron sekarang" di halaman admin)
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const ADMINS = ["rahmat.iqbal@antam.com", "dani.suryawan@antam.com", "v_raihan.nashwan@antam.com"]; // sama dengan index.html

const HOST = "https://pakal-micro-production.minervasuite.app";
const BASE = `${HOST}/pakal/pmt/api/v1/operator-scorecard`;
const SUMBER = [
  { jenis: "exca", url: `${BASE}/downloadExcaScorecard?equipment_type=exca` },
  { jenis: "truck", url: `${BASE}/downloadTruckScorecard?equipment_type=truck` },
];

// Pengisian data lama
const MUNDUR_HARI_PER_PANGGILAN = 7;
const MUNDUR_BERHENTI_SETELAH_KOSONG = 30; // hari kosong berturut-turut
const MUNDUR_BATAS_BAWAH = "2023-01-01";
const BATAS_WAKTU_MS = 110_000; // Edge Function gratis dihentikan di 150 dtk

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KANDIDAT = {
  badge: ["badgeid", "badge", "nik", "employeeid", "nobadge"],
  name: ["operatorname", "namaoperator", "name", "nama"],
  score: ["overallscore", "score", "totalscore", "nilai"],
};
const SUB = { Actual: "a", Target: "t", Percentage: "p", Score: "s" };

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const bulat = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------
// Tanggal WIT, dihitung dari string Y-M-D. JANGAN memakai toISOString()
// pada tanggal lokal (dokumentasi §20.2).
// ---------------------------------------------------------------------
function witSekarang() {
  const d = new Date(Date.now() + 9 * 3600_000); // jam dinding WIT, dibaca lewat getUTC*
  return {
    tanggal: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    menit: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
function geserHari(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
// Final bila sekarang sudah ≥ 06:50 WIT pada hari sesudahnya.
function sudahFinal(tanggal) {
  const kini = witSekarang();
  const besok = geserHari(tanggal, 1);
  return kini.tanggal > besok || (kini.tanggal === besok && kini.menit >= 6 * 60 + 50);
}

// ---------------------------------------------------------------------
// Unduh. Otentikasi lewat header Referer yang memuat token, BUKAN
// header Authorization. Hasil penelusuran panjang, jangan diubah.
// Kembali: { buf } bila ada berkas, { kosong: alasan } bila tidak ada data.
// ---------------------------------------------------------------------
async function unduh(url, tanggal, token) {
  const res = await fetch(`${url}&updated_at_gte=${tanggal}&updated_at_lte=${tanggal}`, {
    headers: {
      "Referer": `${HOST}/pakal/admin/fms/report?token=${token}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
    },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`Minerva menolak (${res.status}). Periksa secret MINERVA_TOKEN.`);
    e.fatal = true;
    throw e;
  }
  if (!res.ok) throw new Error(`Minerva membalas ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x7b) { // "{" : balasan JSON, bukan berkas Excel
    const teks = new TextDecoder().decode(buf.slice(0, 300));
    return { kosong: `balasan JSON: ${teks}` };
  }
  if (buf.length < 500) return { kosong: `berkas ${buf.length} byte` };
  return { buf };
}

// ---------------------------------------------------------------------
// Uraikan Excel berheader dua baris.
//   Baris 1: nama grup komponen (hanya di kolom pertama tiap grup)
//   Baris 2: Actual, Target, Percentage, Score
// Komponen dideteksi dari header, tidak dipatok.
// ---------------------------------------------------------------------
export function uraikan(buf, label) {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (rows.length < 2) return { baris: [], tanpaTarget: 0, lain: 0, kolom: [] };

  const h0 = rows[0] ?? [], h1 = rows[1] ?? [];
  const cols = [];
  let grup = "";
  for (let i = 0; i < Math.max(h0.length, h1.length); i++) {
    const a = String(h0[i] ?? "").trim();
    const b = String(h1[i] ?? "").trim();
    if (a) grup = a;
    cols.push(b ? `${grup}||${b}` : grup);
  }

  const cariKolom = (peran) => {
    const peta = {};
    cols.forEach((c, i) => { if (!c.includes("||")) peta[norm(c)] = i; });
    for (const k of KANDIDAT[peran]) if (peta[norm(k)] !== undefined) return peta[norm(k)];
    for (const k of KANDIDAT[peran]) {
      for (const [kn, i] of Object.entries(peta)) if (kn.includes(norm(k))) return i;
    }
    return -1;
  };
  const iB = cariKolom("badge"), iN = cariKolom("name"), iS = cariKolom("score");
  if (iB < 0 || iN < 0 || iS < 0) {
    throw new Error(`[${label}] Kolom wajib tidak ketemu. Tersedia: ${cols.join(", ")}`);
  }

  const komponen = [...new Set(cols.filter((c) => c.endsWith("||Percentage")).map((c) => c.split("||")[0]))];
  const idx = {};
  for (const g of komponen) {
    idx[g] = {};
    for (const [nama, kunci] of Object.entries(SUB)) idx[g][kunci] = cols.indexOf(`${g}||${nama}`);
  }

  const angka = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(String(v).replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // Kumpulkan per badge. Badge yang sama bisa muncul lebih dari sekali.
  const perBadge = new Map();
  let lain = 0;
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const badge = String(row[iB] ?? "").replace(/\.0$/, "").replace(/\D/g, "");
    const name = String(row[iN] ?? "").trim();
    const score = angka(row[iS]);
    if (!badge || !name || name.toLowerCase() === "null" || score === null) continue;

    const metrics = {};
    let bertarget = 0, adaTarget = 0;
    for (const g of komponen) {
      const m = {};
      for (const [k, i] of Object.entries(idx[g])) {
        if (i >= 0) { const v = angka(row[i]); if (v !== null) m[k] = v; }
      }
      if (Object.keys(m).length) metrics[g] = m;
      if (idx[g].t >= 0) { adaTarget++; if ((m.t ?? 0) > 0) bertarget++; }
    }
    // Target 0 → Percentage 0, tapi Score tetap dapat nilai bawaan.
    // Ditandai supaya tidak ikut peringkat; datanya tetap disimpan.
    const has_target = adaTarget > 0 ? bertarget === adaTarget : true;
    const company = badge.length === 4 ? "ANTAM" : badge.length === 5 ? "PCM" : "LAIN";
    if (company === "LAIN") lain++;

    if (!perBadge.has(badge)) perBadge.set(badge, []);
    perBadge.get(badge).push({ badge, name, company, score, metrics, has_target });
  }

  // Gabungkan badge ganda: rata-rata. Bila sebagian baris bertarget,
  // hanya baris bertarget yang dirata-rata.
  const baris = [];
  let tanpaTarget = 0;
  for (const kelompok of perBadge.values()) {
    const bertarget = kelompok.filter((k) => k.has_target);
    const pakai = bertarget.length ? bertarget : kelompok;
    const metrics = {};
    for (const g of new Set(pakai.flatMap((k) => Object.keys(k.metrics)))) {
      metrics[g] = {};
      for (const kunci of Object.values(SUB)) {
        const nilai = pakai.map((k) => k.metrics[g]?.[kunci]).filter((v) => v !== undefined);
        if (nilai.length) metrics[g][kunci] = bulat(nilai.reduce((x, y) => x + y, 0) / nilai.length, 2);
      }
    }
    const b = {
      badge: pakai[0].badge,
      name: pakai[0].name,
      company: pakai[0].company,
      score: bulat(pakai.reduce((x, k) => x + k.score, 0) / pakai.length, 2),
      metrics,
      has_target: bertarget.length > 0,
      source_rows: kelompok.length,
    };
    if (!b.has_target) tanpaTarget++;
    baris.push(b);
  }
  return { baris, tanpaTarget, lain, kolom: cols };
}

// ---------------------------------------------------------------------
// Satu tanggal, dua jenis alat.
// ---------------------------------------------------------------------
async function sinkronTanggal(sb, tanggal, token) {
  const h = { tanggal, simpan: 0, tanpaTarget: 0, lain: 0, kosong: [], galat: [] };
  const final = sudahFinal(tanggal);
  for (const { jenis, url } of SUMBER) {
    try {
      const u = await unduh(url, tanggal, token);
      if (u.kosong) { h.kosong.push(`${jenis}: ${u.kosong}`); continue; }
      const { baris, tanpaTarget, lain } = uraikan(u.buf, `${jenis} ${tanggal}`);
      h.lain += lain;
      // Badge selain 4/5 digit tidak disimpan: lebih baik hilang daripada salah kelompok.
      const simpan = baris.filter((b) => b.company !== "LAIN");
      if (simpan.length === 0) { h.kosong.push(`${jenis}: 0 baris`); continue; }
      // Tarikan kosong tidak pernah sampai ke sini, jadi tidak bisa menghapus data lama.
      const { data, error } = await sb.rpc("op_simpan_hari", {
        p_tanggal: tanggal, p_jenis: jenis, p_final: final, p_baris: simpan,
      });
      if (error) throw new Error(`simpan: ${error.message}`);
      h.simpan += data ?? simpan.length;
      h.tanpaTarget += tanpaTarget;
    } catch (e) {
      if (e.fatal) throw e;
      h.galat.push(`${jenis} ${tanggal}: ${e.message ?? e}`);
    }
  }
  return h;
}

// ---------------------------------------------------------------------
async function catat(sb, isi) {
  const { error } = await sb.from("op_sync_log").insert(isi);
  if (error) console.error("op_sync_log:", error.message);
}

function jawab(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const mulai = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  // --- siapa yang memanggil ---
  let source = null;
  const rahasia = Deno.env.get("SYNC_SECRET");
  if (rahasia && req.headers.get("x-sync-secret") === rahasia) {
    source = "jadwal";
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data } = await sb.auth.getUser(jwt);
      const email = (data?.user?.email ?? "").toLowerCase();
      if (ADMINS.includes(email)) source = `admin:${email}`;
    }
  }
  if (!source) return jawab({ status: "gagal", message: "tidak berwenang" }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "rutin";
  const token = Deno.env.get("MINERVA_TOKEN");
  if (!token) return jawab({ status: "gagal", message: "Secret MINERVA_TOKEN belum diatur" }, 500);

  try {
    // ================= RUTIN & TANGGAL =================
    if (mode === "rutin" || mode === "tanggal") {
      let daftar;
      if (mode === "rutin") {
        // Tiga hari: hari ini (sementara), kemarin, dan lusa kemarin.
        // Kemarin diambil ulang di 07:00 dan 19:00 supaya keterlambatan
        // pengolahan di Minerva ikut terkoreksi.
        const kini = witSekarang().tanggal;
        daftar = [kini, geserHari(kini, -1), geserHari(kini, -2)];
      } else {
        const dari = String(body.dari ?? body.tanggal ?? "");
        const sampai = String(body.sampai ?? dari);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai) || sampai < dari) {
          return jawab({ status: "gagal", message: "isi dari dan sampai dengan format YYYY-MM-DD" }, 400);
        }
        daftar = [];
        for (let t = dari; t <= sampai && daftar.length < 14; t = geserHari(t, 1)) daftar.push(t);
      }

      const hasil = [];
      for (const t of daftar) {
        if (Date.now() - mulai > BATAS_WAKTU_MS) break;
        hasil.push(await sinkronTanggal(sb, t, token));
        if (daftar.length > 3) await new Promise((r) => setTimeout(r, 800));
      }
      const simpan = hasil.reduce((x, h) => x + h.simpan, 0);
      const galat = hasil.flatMap((h) => h.galat);
      const status = galat.length ? (simpan ? "sebagian" : "gagal") : (simpan ? "ok" : "kosong");
      const ringkas = {
        source, mode, status,
        dates: hasil.map((h) => h.tanggal).join(","),
        rows_saved: simpan,
        rows_no_target: hasil.reduce((x, h) => x + h.tanpaTarget, 0),
        rows_other_badge: hasil.reduce((x, h) => x + h.lain, 0),
        duration_ms: Date.now() - mulai,
        message: [...galat, ...hasil.flatMap((h) => h.kosong.map((k) => `${h.tanggal} ${k}`))].join(" | ") || null,
      };
      await catat(sb, ringkas);
      return jawab({ ...ringkas, rincian: hasil }, status === "gagal" ? 502 : 200);
    }

    // ================= MUNDUR (data lama) =================
    if (mode === "mundur") {
      const { data: st } = await sb.from("op_state").select("value").eq("key", "mundur").maybeSingle();
      const kini = witSekarang().tanggal;
      const s = st?.value ?? {
        kursor: geserHari(kini, -3), kosong_beruntun: 0, ada_data: false,
        selesai: false, hari_diproses: 0, tertua_berisi: null,
      };
      if (s.selesai) return jawab({ status: "ok", message: "pengisian data lama sudah selesai", state: s });
      if (s.macet) return jawab({ status: "gagal", message: s.macet, state: s }, 409);

      const simpanState = async () => {
        s.diperbarui = new Date().toISOString();
        await sb.from("op_state").upsert({ key: "mundur", value: s, updated_at: new Date().toISOString() });
      };

      const hasil = [];
      let berhentiKarena = null;
      for (let i = 0; i < MUNDUR_HARI_PER_PANGGILAN; i++) {
        if (Date.now() - mulai > BATAS_WAKTU_MS) { berhentiKarena = "batas waktu"; break; }
        if (s.kursor < MUNDUR_BATAS_BAWAH) { s.selesai = true; berhentiKarena = "batas bawah"; break; }

        const h = await sinkronTanggal(sb, s.kursor, token);
        hasil.push(h);
        if (h.galat.length) {
          // Kursor tidak maju, tanggal ini diulang pada panggilan berikutnya.
          // Tanggal yang gagal tiga kali dilewati dan dicatat, supaya satu
          // tanggal rusak tidak menahan seluruh pengisian.
          s.gagal_beruntun = (s.gagal_beruntun ?? 0) + 1;
          if (s.gagal_beruntun < 3) { berhentiKarena = "galat, diulang panggilan berikutnya"; break; }
          s.dilewati = [...(s.dilewati ?? []), s.kursor].slice(-50);
          s.gagal_beruntun = 0;
          s.kursor = geserHari(s.kursor, -1);
          await simpanState();
          berhentiKarena = "tanggal dilewati setelah gagal 3 kali";
          break;
        }
        s.gagal_beruntun = 0;

        if (h.simpan > 0) {
          s.kosong_beruntun = 0; s.ada_data = true; s.tertua_berisi = s.kursor;
        } else {
          s.kosong_beruntun++;
        }
        s.hari_diproses++;
        s.kursor = geserHari(s.kursor, -1);
        await simpanState(); // tiap hari, supaya potongan yang terputus tidak mengulang dari awal

        if (s.kosong_beruntun >= MUNDUR_BERHENTI_SETELAH_KOSONG) {
          if (s.ada_data) { s.selesai = true; berhentiKarena = `${MUNDUR_BERHENTI_SETELAH_KOSONG} hari kosong berturut-turut`; }
          else { s.macet = "30 hari terbaru kosong semua. Kemungkinan token salah atau alamat Minerva berubah."; berhentiKarena = "macet"; }
          break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      await simpanState();

      const simpan = hasil.reduce((x, h) => x + h.simpan, 0);
      const galat = hasil.flatMap((h) => h.galat);
      const ringkas = {
        source, mode,
        status: galat.length ? (simpan ? "sebagian" : "gagal") : (simpan ? "ok" : "kosong"),
        dates: hasil.map((h) => h.tanggal).join(","),
        rows_saved: simpan,
        rows_no_target: hasil.reduce((x, h) => x + h.tanpaTarget, 0),
        rows_other_badge: hasil.reduce((x, h) => x + h.lain, 0),
        duration_ms: Date.now() - mulai,
        message: [berhentiKarena, s.macet, ...galat].filter(Boolean).join(" | ") || null,
      };
      await catat(sb, ringkas);
      return jawab({ ...ringkas, state: s });
    }

    return jawab({ status: "gagal", message: `mode tidak dikenal: ${mode}` }, 400);
  } catch (e) {
    const pesan = e?.message ?? String(e);
    await catat(sb, { source, mode, status: "gagal", duration_ms: Date.now() - mulai, message: pesan });
    return jawab({ status: "gagal", message: pesan }, 500);
  }
});
