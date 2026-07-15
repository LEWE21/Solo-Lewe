// api/store.js — Relais de mémoire ROBI (Upstash Redis REST).
// Sert deux choses via une clé personnelle "id" (code de liaison, propre à chaque membre) :
//   - la synchro de l'état de l'app entre appareils (actions push / pull)
//   - le flux d'activité déposé par le Claude Code perso de la personne (actions report / feed)
// La personne provisionne une base Upstash gratuite depuis Vercel, ce qui définit
// UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN (jamais visibles côté client).

// Selon l'intégration Vercel, les variables peuvent s'appeler UPSTASH_... ou KV_... : on accepte les deux.
const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("Redis " + r.status);
  const j = await r.json();
  return j.result;
}

// Le code de liaison sert aussi de clé secrète : long et aléatoire, non devinable.
function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!URL || !TOKEN) {
    return res.status(500).json({ error: "Store non configuré : ajoute UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN dans Vercel." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = body.action;
  const id = body.id;
  if (!validId(id)) return res.status(400).json({ error: "Code de liaison invalide" });

  try {
    // Synchro : sauvegarder l'état complet de l'app
    if (action === "push") {
      if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state requis" });
      await redis(["SET", "state:" + id, JSON.stringify(body.state)]);
      return res.status(200).json({ ok: true });
    }

    // Synchro : récupérer l'état
    if (action === "pull") {
      const raw = await redis(["GET", "state:" + id]);
      return res.status(200).json({ state: raw ? JSON.parse(raw) : null });
    }

    // Reporting : le Claude Code de la personne dépose un événement d'activité
    if (action === "report") {
      const kind = (body.kind || "info").toString().slice(0, 40);
      const text = (body.text || "").toString().slice(0, 800);
      if (!text) return res.status(400).json({ error: "text requis" });
      const ev = { kind, text, at: (body.at || new Date().toISOString()) };
      await redis(["LPUSH", "feed:" + id, JSON.stringify(ev)]);
      await redis(["LTRIM", "feed:" + id, 0, 49]); // on garde les 50 derniers
      return res.status(200).json({ ok: true });
    }

    // Reporting : l'app lit le flux d'activité
    if (action === "feed") {
      const arr = (await redis(["LRANGE", "feed:" + id, 0, 29])) || [];
      const feed = arr.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ feed });
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
