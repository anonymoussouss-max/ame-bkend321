// Phone + laptop sync for the study desk. Stores one compressed copy of the desk per sync code.
// Needs a free Upstash Redis database connected to this Vercel project (Storage → Upstash for Redis),
// which adds KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN) automatically.
import { createHash } from "crypto";

// The page sends the desk gzipped + base64; a few years of data stays far below this.
const MAX_BYTES = 4000000;
const ONE_YEAR = 365 * 24 * 3600;

const redisUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const r = await fetch(redisUrl(), {
    method: "POST",
    headers: { "Authorization": `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis HTTP ${r.status}`);
  return data.result;
}

// The sync code itself is never stored, only its hash.
const keyFor = code => "desk:" + createHash("sha256").update(code).digest("hex");
const validCode = code => typeof code === "string" && /^[A-Za-z0-9]{24,64}$/.test(code);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!redisUrl() || !redisToken()) {
    console.error("[desk sync] no Upstash Redis env vars");
    return res.status(500).json({ error: "Sync storage isn't connected yet (add Upstash for Redis in Vercel)" });
  }

  try {
    if (req.method === "GET") {
      const code = req.query.key;
      if (!validCode(code)) return res.status(400).json({ error: "Bad sync code" });
      return res.status(200).json({ data: await redis(["GET", keyFor(code)]) });
    }
    if (req.method === "POST") {
      const { key: code, data } = req.body || {};
      if (!validCode(code)) return res.status(400).json({ error: "Bad sync code" });
      if (typeof data !== "string" || !data || data.length > MAX_BYTES) return res.status(400).json({ error: "Desk data missing or too large" });
      await redis(["SET", keyFor(code), data, "EX", ONE_YEAR]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[desk sync] error:", err);
    return res.status(502).json({ error: err.message });
  }
}
