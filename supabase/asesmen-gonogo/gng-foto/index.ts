// =====================================================================
// ASESMEN GO/NO-GO · Edge Function "gng-foto"
//
// Ditempel lewat Supabase → Edge Functions → Deploy a new function →
// Via Editor, nama fungsi: gng-foto. Tidak butuh Secret tambahan;
// SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sudah tersedia otomatis.
//
// Kenapa ada fungsi ini: operator dan pengawas masuk dengan NPP, bukan akun
// Supabase, sehingga tidak bisa menulis ke Storage langsung. Fungsi ini
// memeriksa token NPP lewat SQL (gng_sesi_foto / gng_foto_boleh), lalu
// mengunggah atau membuat tautan lihat dengan service role.
//
// Body JSON:
//   {"aksi":"unggah","token":"…","form_id":"<uuid>","data":"data:image/jpeg;base64,…"}
//       → {"path":"<form_id>/<uuid>.jpg"}
//   {"aksi":"lihat","token":"…","paths":["<form_id>/<uuid>.jpg", …]}
//       → {"urls":[{"path":…,"url":…}]}   berlaku 1 jam
//
// Pengguna Mining yang login tidak lewat sini: mereka membuat tautan lihat
// langsung ke Storage (policy "gng foto lihat" di SQL 01).
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "gng-foto";
const MAKS_BYTE = 1_500_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

function jawab(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function base64KeByte(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return jawab(405, { message: "Pakai POST" });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return jawab(400, { message: "Body bukan JSON" }); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const token = typeof b.token === "string" ? b.token : "";
  const sesi = await sb.rpc("gng_sesi_foto", { p_token: token });
  if (sesi.error) return jawab(401, { message: sesi.error.message });

  if (b.aksi === "unggah") {
    const formId = String(b.form_id || "");
    if (!UUID.test(formId)) return jawab(400, { message: "form_id tidak sah" });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
    if (!m) return jawab(400, { message: "Foto harus JPEG" });
    const byte = base64KeByte(m[1]);
    if (byte.length > MAKS_BYTE) return jawab(400, { message: "Foto terlalu besar (maks 1,5 MB)" });
    if (byte[0] !== 0xff || byte[1] !== 0xd8) return jawab(400, { message: "Berkas bukan JPEG" });
    // Form yang sudah terkirim tidak boleh ditambah foto lagi
    const ada = await sb.from("gng_form").select("id").eq("id", formId).maybeSingle();
    if (ada.data) return jawab(409, { message: "Form sudah terkirim" });
    const path = `${formId}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from(BUCKET).upload(path, byte, { contentType: "image/jpeg", upsert: false });
    if (up.error) return jawab(500, { message: up.error.message });
    return jawab(200, { path });
  }

  if (b.aksi === "lihat") {
    const paths = Array.isArray(b.paths) ? (b.paths as unknown[]).map(String) : [];
    if (!paths.length || paths.length > 12 || paths.some((p) => !PATH.test(p))) {
      return jawab(400, { message: "Daftar foto tidak sah" });
    }
    const boleh = await sb.rpc("gng_foto_boleh", { p_token: token, p_paths: paths });
    if (boleh.error) return jawab(401, { message: boleh.error.message });
    if (boleh.data !== true) return jawab(403, { message: "Tidak berhak melihat foto ini" });
    const s = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (s.error) return jawab(500, { message: s.error.message });
    return jawab(200, { urls: (s.data || []).map((x) => ({ path: x.path, url: x.signedUrl })) });
  }

  return jawab(400, { message: "aksi harus unggah atau lihat" });
});
