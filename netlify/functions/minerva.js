// Netlify Function: proxy Minerva FMS Lite (PAKAL) -> metrik TMM & Barging
// Endpoint publik (tanpa token). Sumber: dashboard "Overall Shift Performance".
// ENV:
//   MINERVA_URL   (opsional) base endpoint. Default sudah diisi endpoint PAKAL.
//   MINERVA_SHIFT (opsional) 'DS' (Day) / 'NS' (Night). Default: otomatis dari jam WIT.
//   MINERVA_TOKEN (opsional) biasanya tidak perlu.
const DEFAULT_URL = 'https://pakal-micro-production.minervasuite.app/pakal/fom/api/v1/overall-shift-performance/overall/overallhighlight';
export async function handler() {
  const BASE  = process.env.MINERVA_URL || DEFAULT_URL;
  const KEY   = process.env.MINERVA_TOKEN;
  const J = (b) => ({ statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: b });
  // tanggal & shift dalam waktu WIT (UTC+9)
  const wit = new Date(Date.now() + 9 * 3600 * 1000);
  const date = wit.toISOString().slice(0, 10);
  const hour = wit.getUTCHours();
  const shift = process.env.MINERVA_SHIFT || (hour >= 7 && hour < 19 ? 'DS' : 'NS');
  const url = BASE + (BASE.includes('?') ? '&' : '?') +
    'updated_at_gte=' + date + '&updated_at_lte=' + date + '&shift_type=' + shift;
  try {
    const r = await fetch(url, { headers: KEY ? { Authorization: 'Bearer ' + KEY } : {} });
    const j = await r.json();
    const d = (j && j.data) || {};
    const prods = Array.isArray(d.Productions) ? d.Productions : [];
    const sumOre = prods.filter(p => /ORE/i.test(p.Material || '')).reduce((a, p) => a + (+p.Production || 0), 0);
    const totalMov = +d.TotalMovement || 0;
    let ore = sumOre;
    let waste = totalMov ? Math.max(0, totalMov - ore) : prods.filter(p => /WASTE/i.test(p.Material || '')).reduce((a, p) => a + (+p.Production || 0), 0);
    if (!ore && totalMov) ore = Math.max(0, totalMov - waste);
    const r2 = (x) => (x == null ? null : Number((+x).toFixed(2)));
    const out = {
      tmm: {
        ore: Math.round(ore),
        waste: Math.round(waste),
        sr: r2(d.StrippingRatio),
        mf: r2(d.MatchFactor),
        productivity: Math.round(+d.Productivity || 0),
        distance: null            // tidak ada di endpoint ini (nanti dari endpoint TMM bila diperlukan)
      },
      barging: {
        transhipment: Math.round((d.OreBarging && +d.OreBarging.OreBarging) || 0),
        productivity: null,
        distance: null
      },
      _meta: { date, shift, source: url }
    };
    return J(JSON.stringify(out));
  } catch (e) { return J('{}'); }
}
