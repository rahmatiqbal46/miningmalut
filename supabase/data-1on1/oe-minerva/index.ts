// =====================================================================
// DATA 1ON1 · Edge Function "oe-minerva"
//
// Ditempel lewat Supabase → Edge Functions → Deploy a new function →
// Via Editor, nama "oe-minerva". Tidak butuh CLI.
//
// Secret yang dipakai (sudah ada untuk Operator Performance):
//   MINERVA_TOKEN  token Minerva, bagian setelah "token=" di address bar
// SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
//
// Meneruskan berkas laporan Minerva apa adanya (tidak diurai di sini,
// supaya ringan). Halaman Data 1on1 yang membaca isinya.
//
//   GET ?jenis=exca&tanggal=2026-09-01     laporan FMS excavator 1 hari
//   GET ?jenis=truck&tanggal=2026-09-01    laporan FMS truck 1 hari
//   GET ?jenis=barge&dari=2026-09-01&sampai=2026-09-23   tongkang FINISH
//
// Yang boleh memanggil: pengguna yang login (token login shell).
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const HOST = "https://pakal-micro-production.minervasuite.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-oe-status, x-oe-jenis",
};

function jawab(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const TGL = /^\d{4}-\d{2}-\d{2}$/;

function alamat(jenis, p) {
  if (jenis === "exca" || jenis === "truck") {
    if (!TGL.test(p.tanggal ?? "")) return null;
    const opsi = jenis === "exca" ? "excavator" : "truck";
    return `${HOST}/pakal/admin/api/v1/report/download/${opsi}?reportType=fms&reportOption=${opsi}` +
      `&shift_start=${p.tanggal}&shift_end=${p.tanggal}&shift_type=`;
  }
  if (jenis === "barge") {
    if (!TGL.test(p.dari ?? "") || !TGL.test(p.sampai ?? "") || p.sampai < p.dari) return null;
    // Rute admin langsung (bukan /pakal/api/proxy/main/… yang menuntut cookie berumur pendek, §22.2)
    return `${HOST}/pakal/admin/api/v2/barge-management/barges/download?status_barge=FINISH&start_date=${p.dari}&end_date=${p.sampai}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // --- siapa yang memanggil: harus pengguna login, bukan kunci anon ---
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jawab({ status: "gagal", message: "belum login" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user?.email) return jawab({ status: "gagal", message: "sesi login tidak sah atau sudah berakhir" }, 401);

  const url = new URL(req.url);
  let p = Object.fromEntries(url.searchParams.entries());
  if (req.method === "POST") p = { ...p, ...(await req.json().catch(() => ({}))) };
  const jenis = String(p.jenis ?? "");
  const tujuan = alamat(jenis, p);
  if (!tujuan) return jawab({ status: "gagal", message: "parameter salah: jenis=exca|truck + tanggal, atau jenis=barge + dari & sampai (YYYY-MM-DD)" }, 400);

  const token = Deno.env.get("MINERVA_TOKEN");
  if (!token) return jawab({ status: "gagal", message: "Secret MINERVA_TOKEN belum diatur" }, 500);

  let res;
  try {
    res = await fetch(tujuan, {
      headers: {
        // Otentikasi lewat Referer yang memuat token, BUKAN Authorization (§22.2). Jangan diubah.
        "Referer": `${HOST}/pakal/admin/fms/report?token=${token}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return jawab({ status: "gagal", message: `Minerva tidak menjawab: ${e?.message ?? e}` }, 504);
  }
  if (res.status === 401 || res.status === 403) {
    return jawab({ status: "ditolak", message: `Minerva menolak (${res.status}). Periksa Secret MINERVA_TOKEN.` }, 502);
  }
  if (!res.ok) return jawab({ status: "gagal", message: `Minerva membalas ${res.status}` }, 502);

  const buf = new Uint8Array(await res.arrayBuffer());
  // berkas xlsx diawali "PK"; selain itu balasan JSON/teks = tidak ada data atau pesan galat
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    const teks = new TextDecoder().decode(buf.slice(0, 400));
    return jawab({ status: "kosong", message: teks }, 200);
  }
  return new Response(buf, {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/octet-stream", "x-oe-status": "ok", "x-oe-jenis": jenis, "Cache-Control": "no-store" },
  });
});
