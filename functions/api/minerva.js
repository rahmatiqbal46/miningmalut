/* Cloudflare Pages Function — GET /api/minerva
 * Pengganti netlify/functions/minerva.js.
 * Rute otomatis dari struktur folder: functions/api/minerva.js -> /api/minerva
 * (tidak perlu netlify.toml / redirect apa pun).
 *
 * Proxy Minerva FMS Lite (PAKAL) -> metrik TMM & Barging. Endpoint publik, tanpa token.
 *
 * Perbedaan penting dari versi Netlify: respons DI-CACHE 180 detik di edge Cloudflare.
 * Berapa pun tab dashboard yang terbuka, function hanya benar-benar berjalan
 * maksimal 20x per jam. Sisanya dijawab CDN tanpa memakai kuota.
 *
 * Environment variable (semua OPSIONAL, tidak perlu diisi):
 *   MINERVA_URL   base endpoint pengganti
 *   MINERVA_SHIFT 'DS' / 'NS' untuk memaksa shift
 *   MINERVA_TOKEN biasanya tidak perlu
 */

const DEFAULT_URL = 'https://pakal-micro-production.minervasuite.app/pakal/fom/api/v1/overall-shift-performance/overall/overallhighlight';
const TTL = 180; // detik — umur cache di edge & di browser

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  // ---- 1. Coba jawab dari cache edge lebih dulu -------------------------
  const kunci = new Request(new URL(request.url).origin + '/api/minerva', { method: 'GET' });
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(kunci);
      if (hit) return hit;
    } catch (e) { /* cache bermasalah -> lanjut ambil data asli */ }
  }

  // ---- 2. Tentukan tanggal & shift dalam waktu WIT (UTC+9) --------------
  const BASE = env.MINERVA_URL || DEFAULT_URL;
  const KEY  = env.MINERVA_TOKEN;
  const wit  = new Date(Date.now() + 9 * 3600 * 1000);
  const date = wit.toISOString().slice(0, 10);
  /* Shift berganti 06.30 dan 18.30 WIT (pergantian shift sebenarnya di site; sama
     dengan label shift di Home, Digital Twin, dan Worker 9.1). 07.00/19.00 hanya
     jadwal sinkronisasi Operator Performance, bukan batas shift (24 September 2026). */
  const menit = wit.getUTCHours() * 60 + wit.getUTCMinutes();
  const shift = env.MINERVA_SHIFT || (menit >= 390 && menit < 1110 ? 'DS' : 'NS');
  const url = BASE + (BASE.includes('?') ? '&' : '?') +
    'updated_at_gte=' + date + '&updated_at_lte=' + date + '&shift_type=' + shift;

  // ---- 3. Ambil & petakan data (logika sama persis dengan versi Netlify) -
  let body = '{}';
  let sukses = false;
  try {
    const r = await fetch(url, { headers: KEY ? { Authorization: 'Bearer ' + KEY } : {} });
    const j = await r.json();
    const d = (j && j.data) || {};
    const prods = Array.isArray(d.Productions) ? d.Productions : [];
    const sumOre = prods.filter(p => /ORE/i.test(p.Material || '')).reduce((a, p) => a + (+p.Production || 0), 0);
    const totalMov = +d.TotalMovement || 0;
    let ore = sumOre;
    let waste = totalMov
      ? Math.max(0, totalMov - ore)
      : prods.filter(p => /WASTE/i.test(p.Material || '')).reduce((a, p) => a + (+p.Production || 0), 0);
    if (!ore && totalMov) ore = Math.max(0, totalMov - waste);
    const r2 = (x) => (x == null ? null : Number((+x).toFixed(2)));
    const out = {
      tmm: {
        ore: Math.round(ore),
        waste: Math.round(waste),
        sr: r2(d.StrippingRatio),
        mf: r2(d.MatchFactor),
        productivity: Math.round(+d.Productivity || 0),
        distance: null
      },
      barging: {
        transhipment: Math.round((d.OreBarging && +d.OreBarging.OreBarging) || 0),
        productivity: null,
        distance: null
      },
      _meta: { date, shift, source: url, host: 'cloudflare' }
    };
    body = JSON.stringify(out);
    sukses = true;
  } catch (e) {
    body = '{}';
  }

  // ---- 4. Balas + simpan ke cache (hanya bila sukses) --------------------
  const resp = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': sukses
        ? ('public, max-age=' + TTL + ', s-maxage=' + TTL)
        : 'no-store',
      'access-control-allow-origin': '*'
    }
  });

  if (sukses && cache) {
    try { context.waitUntil(cache.put(kunci, resp.clone())); } catch (e) { /* abaikan */ }
  }
  return resp;
}
