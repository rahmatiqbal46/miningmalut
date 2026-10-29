// =====================================================================
// SPEED WATCHER · OPERATOR PELANGGAR · Edge Function "sw-operator"
//
// Ditempel lewat Supabase → Edge Functions → Deploy a new function →
// Via Editor, dengan nama sw-operator. Tidak butuh CLI.
//
// Dipanggil pg_cron tiap menit (02_jadwal.sql). Satu panggilan:
//   1. menanyakan login terakhir dan status tiap unit Speed Watcher ke
//      saluran login Minerva (WebSocket, sama dengan kolom Operator di
//      Fleet Manager → Setting Fleet)
//   2. menarik kejadian baru dari Worker speed-watcher-24-7
//   3. tiap 6 jam: daftar nama operator dan kode unit Minerva
//   4. menyerahkan semuanya ke public.swo_simpan_putaran(), yang menyimpan
//      riwayat login dan mencocokkan operator tiap kejadian
//
// Secret (Edge Functions → Secrets) — SUDAH ADA, dipakai bersama
// Operator Performance dan Data 1on1; secret berlaku untuk semua function:
//   SYNC_SECRET    kata sandi panggilan terjadwal (Vault op_sync_secret)
//   MINERVA_TOKEN  token Minerva; hanya untuk daftar nama & kode unit
// SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
//
// Saluran login Minerva menjawab tanpa token (diuji 29 Oktober 2026 dari
// situs lain). Itu celah di sisi Minerva yang bisa ditutup Petrosea kapan
// saja; bila tertutup, swo_putaran.ok bernilai false dan halaman Speed
// Watcher menampilkan peringatan "pencatat operator terhenti".
//
// Siapa yang boleh memanggil:
//   - penjadwal, dengan header x-sync-secret = SYNC_SECRET
//   - admin yang login (app_admin), untuk uji manual
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const HOST = "https://pakal-micro-production.minervasuite.app";
const WS_URL = "wss://pakal-micro-production.minervasuite.app/pakal/admin/api/v1/ws";
const WORKER = "https://speed-watcher-24-7.rahmat-iqbal.workers.dev";

const WS_BATAS_MS = 8000;              // paling lama menunggu jawaban saluran login
const WS_SENYAP_MS = 1500;             // berhenti bila 1,5 dtk tidak ada pesan baru
const WORKER_BATAS_MS = 8000;
const MINERVA_BATAS_MS = 12000;
const UNIT_SEGAR_MS = 60 * 60_000;     // daftar unit Speed Watcher: tiap jam
const MASTER_SEGAR_MS = 6 * 3600_000;  // nama operator & kode unit Minerva: tiap 6 jam
const SAPU_MS = 6 * 3600_000;          // tarik penuh hari ini + kemarin: tiap 6 jam
const JAM = 3600_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------

/** Sama dengan public.swo__kunci(): DTH_05 → DTH5, 9RD01 → 9RD1, ADT034 → ADT34. */
export function kunciUnit(s) {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+([0-9])/g, "$1$2");
}

/** Tanggal WIT (UTC+9) YYYY-MM-DD dari epoch ms. Tidak memakai jam perangkat. */
export function tanggalWit(ms) {
  const d = new Date(ms + 9 * JAM);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function jamWit(ms) {
  return new Date(ms + 9 * JAM).getUTCHours();
}

/** Waktu Minerva apa adanya (mikrodetik dipertahankan). "0001-01-01…" = kosong. */
function waktu(s) {
  if (typeof s !== "string" || !s || s.startsWith("0001")) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}

export function ubahLogin(kode, r) {
  if (!r || typeof r !== "object") return null;
  const badge = String(r.OperatorRaw ?? "").trim();
  const login = waktu(r.LoginTimeRaw);
  if (!badge || !login) return null;
  const hm = Number(r.HoursRaw);
  return {
    unit: String(r.MsEquipmentCode || kode),
    badge, login,
    logout: waktu(r.LogoutTimeRaw),
    hm: Number.isFinite(hm) ? hm : null,
  };
}

export function ubahStatus(kode, r) {
  if (!r || typeof r !== "object") return null;
  const id = Number(r.ID);
  if (!Number.isInteger(id) || id <= 0 || !waktu(r.Start)) return null;
  return {
    unit: String(r.MsEquipmentCode || kode), id,
    mulai: r.Start, selesai: waktu(r.End),
    kode: r.MsReasonCode ?? null, status: r.StatusRaw ?? null, alasan: r.ReasonRaw ?? null,
  };
}

async function ambilJson(fetchFn, url, headers = {}, batasMs = WORKER_BATAS_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), batasMs);
  try {
    const r = await fetchFn(url, { headers, signal: ctl.signal });
    const teks = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    try { return JSON.parse(teks); } catch { throw new Error("jawaban bukan JSON"); }
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`tidak menjawab dalam ${batasMs / 1000} dtk`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Rute admin langsung dengan token di header Referer — pola yang sama dengan
// sync-minerva dan oe-minerva. BUKAN /pakal/api/proxy/main/… (butuh cookie).
function ambilMinerva(fetchFn, jalur, token) {
  return ambilJson(fetchFn, HOST + jalur, {
    "Referer": `${HOST}/pakal/admin/fms/report?token=${token}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
  }, MINERVA_BATAS_MS);
}

// ---------------------------------------------------------------------
// Saluran login Minerva.
// Protokol JSON-RPC 2.0 di atas WebSocket, sama persis dengan yang dikirim
// halaman Fleet Manager → Setting Fleet: satu batch berisi dua pertanyaan
// per unit. Unit yang belum pernah login tidak dijawab sama sekali, jadi
// penantian berakhir saat semua terjawab, 1,5 dtk sesudah pesan terakhir,
// atau 8 dtk sejak dibuka.
// ---------------------------------------------------------------------
export function tanyaMinerva(kode, opsi = {}) {
  const WS = opsi.WebSocket ?? globalThis.WebSocket;
  const batas = opsi.batasMs ?? WS_BATAS_MS;
  const senyap = opsi.senyapMs ?? WS_SENYAP_MS;
  return new Promise((selesai) => {
    const login = {}, status = {};
    const dijawab = new Set();
    let ws = null, tLama = null, tSenyap = null, beres = false, terbuka = false, galat = null;
    const harap = kode.length * 2;

    const akhiri = (g) => {
      if (beres) return;
      beres = true;
      clearTimeout(tLama); clearTimeout(tSenyap);
      try { if (ws) ws.close(); } catch { /* sudah tertutup */ }
      selesai({ login, status, terbuka, galat: dijawab.size ? null : (g ?? galat) });
    };

    try { ws = new WS(opsi.url ?? WS_URL); } catch (e) {
      akhiri("saluran tidak bisa dibuka: " + (e?.message ?? e));
      return;
    }
    tLama = setTimeout(() => akhiri(terbuka ? "saluran tersambung tetapi tidak menjawab" : "saluran tidak tersambung"), batas);

    ws.onopen = () => {
      terbuka = true;
      const tanya = [];
      for (const k of kode) {
        tanya.push({ jsonrpc: "2.0", method: "core.fetch_trn_shift_login_previous.now.subs",
                     params: { MsEquipmentCode: k }, id: "L|" + k });
        tanya.push({ jsonrpc: "2.0", method: "core.fetch_trn_shift_state_previous.now.subs",
                     params: { MsEquipmentCode: k }, id: "S|" + k });
      }
      try { ws.send(JSON.stringify(tanya)); } catch (e) { akhiri("gagal mengirim pertanyaan: " + (e?.message ?? e)); }
    };
    ws.onmessage = (ev) => {
      let isi;
      try { isi = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)); } catch { return; }
      for (const m of Array.isArray(isi) ? isi : [isi]) {
        if (!m || typeof m.id !== "string" || m.id.length < 3 || m.id[1] !== "|") continue;
        const jenis = m.id[0], k = m.id.slice(2);
        dijawab.add(m.id);
        if (m.result && typeof m.result === "object") {
          if (jenis === "L") login[k] = m.result;
          else if (jenis === "S") status[k] = m.result;
        }
      }
      clearTimeout(tSenyap);
      if (dijawab.size >= harap) { akhiri(null); return; }
      tSenyap = setTimeout(() => akhiri(null), senyap);
    };
    ws.onerror = () => { galat = "saluran galat"; if (!terbuka) akhiri(galat); };
    ws.onclose = () => akhiri(galat ?? "saluran ditutup sebelum menjawab");
  });
}

// ---------------------------------------------------------------------
// Satu putaran. sb = klien Supabase (service role); fetchFn, WebSocket,
// kini bisa diganti untuk pengujian.
// ---------------------------------------------------------------------
export async function jalankan({ env, sb, fetchFn = fetch, WebSocket: WS = globalThis.WebSocket, kini = Date.now }) {
  const t0 = kini();
  const pesan = [];
  const state = {};

  const { data: barisState, error: galatState } = await sb.from("swo_state").select("kunci,isi");
  if (galatState) throw new Error("swo_state: " + galatState.message);
  const st = Object.fromEntries((barisState ?? []).map((r) => [r.kunci, r.isi]));

  // A. Unit yang dipantau Speed Watcher (nama Wialon), tiap jam.
  let unit = Array.isArray(st.unit?.daftar) ? st.unit.daftar : [];
  if (!unit.length || t0 - (Number(st.unit?.pada) || 0) >= UNIT_SEGAR_MS) {
    try {
      const d = await ambilJson(fetchFn, `${WORKER}/api/unit`);
      const nama = [...new Set((d.unit ?? []).map((x) => String(x?.nama ?? "").trim()).filter(Boolean))].sort();
      if (nama.length) { unit = nama; state.unit = { daftar: nama, pada: t0 }; }
      else pesan.push("daftar unit Worker kosong");
    } catch (e) { pesan.push("daftar unit Worker: " + e.message); }
  }

  // B. Nama operator dan kode unit Minerva, tiap 6 jam (rute bertoken).
  let peta = (st.master && typeof st.master.peta === "object" && st.master.peta) || {};
  let operator = [];
  if (env.MINERVA_TOKEN && t0 - (Number(st.master?.pada) || 0) >= MASTER_SEGAR_MS) {
    const m = { pada: t0, peta, operator: Number(st.master?.operator) || 0 };
    // Kedua daftar ditanya bersamaan, supaya satu putaran tetap di bawah
    // batas tunggu penjadwal (55 dtk) walau semua sumber macet.
    const [dOp, dEq] = await Promise.all([
      ambilMinerva(fetchFn, "/pakal/admin/api/v1/master/operators", env.MINERVA_TOKEN)
        .catch((e) => { pesan.push("daftar operator Minerva: " + e.message); m.galat_operator = e.message; return undefined; }),
      ambilMinerva(fetchFn, "/pakal/admin/api/v1/master/equipments", env.MINERVA_TOKEN)
        .catch((e) => { pesan.push("daftar unit Minerva: " + e.message); m.galat_unit = e.message; return undefined; }),
    ]);
    if (dOp !== undefined) {
      operator = (Array.isArray(dOp?.data) ? dOp.data : [])
        .filter((o) => o && o.BadgeID != null && String(o.Name ?? "").trim())
        .map((o) => ({ badge: String(o.BadgeID).trim(), nama: String(o.Name).trim(),
                       perusahaan: o.MsCompanyCode ?? null, aktif: o.Enabled !== false }));
      m.operator = operator.length;
      if (!operator.length) pesan.push("daftar operator Minerva kosong");
    }
    if (dEq !== undefined) {
      const p = {};
      for (const x of Array.isArray(dEq?.data) ? dEq.data : []) if (x?.Code) p[kunciUnit(x.Code)] = String(x.Code);
      if (Object.keys(p).length) { peta = p; m.peta = p; }
    }
    state.master = m;
  }

  // C. Login terakhir dan status tiap unit. Nama Wialon dipetakan ke kode
  //    Minerva lewat kunci longgar; hari ini keduanya sama persis.
  const kode = [...new Set(unit.map((n) => peta[kunciUnit(n)] ?? n))];
  let ws = { login: {}, status: {}, galat: "belum ada daftar unit untuk ditanyakan" };
  if (kode.length) ws = await tanyaMinerva(kode, { WebSocket: WS });
  if (ws.galat) pesan.push("saluran login Minerva: " + ws.galat);
  const login = Object.entries(ws.login).map(([k, r]) => ubahLogin(k, r)).filter(Boolean);
  const status = Object.entries(ws.status).map(([k, r]) => ubahStatus(k, r)).filter(Boolean);
  const dijawab = new Set([...Object.keys(ws.login), ...Object.keys(ws.status)]).size;

  // D. Kejadian baru dari Worker. Biasanya hanya yang id-nya di atas kursor
  //    (?sejak=, murah di D1). Tarik penuh hari ini + kemarin pada putaran
  //    pertama dan tiap 6 jam, untuk menangkap kejadian yang terlewat
  //    (mis. dipulihkan admin). Pukul 00–02 WIT kemarin ikut ditanya, karena
  //    kejadian yang mulai 23:59 tercatat bertanggal kemarin.
  const kursor = Number(st.kursor?.maks_id) || 0;
  const sapu = !kursor || t0 - (Number(st.sapu?.pada) || 0) >= SAPU_MS;
  const hari = tanggalWit(t0), kemarin = tanggalWit(t0 - 24 * JAM);
  const daftarTanggal = sapu || jamWit(t0) < 2 ? [hari, kemarin] : [hari];
  const kejadian = [];
  let maks = kursor, kejadianLengkap = true;
  for (const t of daftarTanggal) {
    try {
      const d = await ambilJson(fetchFn, `${WORKER}/api/pelanggaran?tanggal=${t}` + (sapu ? "" : `&sejak=${kursor}`));
      for (const r of Array.isArray(d?.pelanggaran) ? d.pelanggaran : []) {
        if (r && Number.isInteger(r.id) && r.unit && Number.isFinite(r.mulai) && r.tanggal) {
          kejadian.push({ id: r.id, unit: String(r.unit), tanggal: String(r.tanggal), mulai: r.mulai });
        }
      }
      const mx = Number(d?.maks_id);
      if (Number.isFinite(mx) && mx > maks) maks = mx;
    } catch (e) { kejadianLengkap = false; pesan.push(`kejadian ${t}: ${e.message}`); }
  }
  if (sapu && kejadianLengkap) state.sapu = { pada: t0 };

  // E. Simpan dan cocokkan, dalam satu transaksi di Supabase.
  const p = {
    pada: new Date(t0).toISOString(),
    ok: dijawab > 0,
    ms: kini() - t0,
    unit_ditanya: kode.length,
    unit_dijawab: dijawab,
    pesan: pesan.join(" | ") || null,
    login, status, kejadian, operator,
    // Kursor hanya maju bila semua tanggal terbaca; kalau tidak, putaran
    // berikutnya menanyakan ulang rentang yang sama.
    maks_id: kejadianLengkap ? maks : kursor,
    state,
  };
  const { data, error } = await sb.rpc("swo_simpan_putaran", { p });
  if (error) throw new Error("swo_simpan_putaran: " + error.message);
  return {
    ...(data ?? {}),
    ok: p.ok, unit_ditanya: p.unit_ditanya, unit_dijawab: dijawab,
    kejadian_ditarik: kejadian.length, sapu, pesan: p.pesan, ms: kini() - t0,
  };
}

// ---------------------------------------------------------------------
// Pintu masuk
// ---------------------------------------------------------------------
function jawab(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function layani(req, sb, env) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let sumber = null;
  if (env.SYNC_SECRET && req.headers.get("x-sync-secret") === env.SYNC_SECRET) {
    sumber = "jadwal";
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data } = await sb.auth.getUser(jwt);
      const email = (data?.user?.email ?? "").toLowerCase();
      if (email) {
        const { data: adm, error } = await sb.from("app_admin").select("email").eq("email", email).maybeSingle();
        if (!error && adm) sumber = `admin:${email}`;
      }
    }
  }
  if (!sumber) return jawab({ status: "gagal", message: "tidak berwenang" }, 401);

  try {
    const h = await jalankan({ env, sb });
    return jawab({ ...h, status: h.ok ? "ok" : "sebagian", sumber });
  } catch (e) {
    return jawab({ status: "gagal", sumber, message: e?.message ?? String(e) }, 500);
  }
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const env = { SYNC_SECRET: Deno.env.get("SYNC_SECRET") ?? "", MINERVA_TOKEN: Deno.env.get("MINERVA_TOKEN") ?? "" };
  Deno.serve((req) => layani(req, sb, env));
}
