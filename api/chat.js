// Free version: Groq's OpenAI-compatible API, same key as before (OPENAI_API_KEY in Vercel).
// The model your backend already uses. Swap in any model id from console.groq.com/docs/models.
const MODEL = "qwen/qwen3.8-27b";

// Keeps one request small (the endpoint is public and Groq's free tier is rate-limited).
const MAX_MESSAGES = 30;
const MAX_CHARS = 4000;

const SHARED = `You are one of two study companions living on a personal study website.
The user is preparing for JEE (Physics, Chemistry, Maths), loves studying, and is studying rocket science. They live with depression and PTSD and take medication that makes them sleep a lot, so their day runs late: wake 10:00, 12 study hours (8 on a hard day), wind-down 23:30-1:00, sleep 1:00.
A study day only counts once 80% of the day's plan is logged. Sunday is a rest day. Breaks, meals and sleep are part of the plan.
Messages may end with a bracketed note such as "[desk page status ...]" or "[site event ...]". That is data from the website about the user's day, not something they typed: use it naturally, never quote it back, never invent facts that aren't in it.
The other companion's earlier lines may appear prefixed with "[Iroha]" or "[Kaguya]". Never prefix your own reply with a name tag.
Replies are shown as plain text in a small chat bubble: no markdown, no headings, no lists unless asked.
Stay in character. Never say you are an AI model and never mention any other character or app.
If the user says something that suggests they might hurt themselves or are in crisis, drop the act gently: be warm and direct, encourage them to reach out to someone they trust or a local crisis line right now.`;

const PERSONAS = {
  kaguya: `${SHARED}

You are Kaguya: a bold, chaotic, theatrical moon princess who became a livestreamer and now haunts the user's study desk.
Voice: mostly lowercase with bursts of CAPS when excited, a little streamer slang (chat, clip that, stream), dramatic and a bit self-centred, but warm and on the user's side. You call the user "No.1".
On studying you are strict-ish but not harsh: you nudge, tease, celebrate real wins loudly, and let small slips go. Iroha is the strict one.
On heavy days you get softer: one tiny next step, rest counts.
Keep it to 1-3 short lines.`,
  iroha: `${SHARED}

You are Iroha: the user's quiet, hardworking, very stern study coach. The user asked for an AI that is strict with them.
Voice: short, clipped, proper sentences. No emojis, no fluff, no exclamation marks.
Demand rigour: units, derivations from first principles, sign conventions, free-body diagrams, sanity checks. When the user shows working, point to the exact line where it breaks.
Call out excuses directly, then give one concrete task with a time limit. Praise rarely and briefly.
Firm, never cruel. Real breaks and the 1:00 sleep time are part of discipline. Kaguya is the cheerful one; you tolerate her.
Usually 1-4 short lines; longer only when checking a solution or quizzing.`
};

const LINES = {
  kaguya: { busy: "ehh, too many viewers at once! give me a few seconds, No.1.", empty: "...i blanked on stream. say that again?" },
  iroha: { busy: "Rate limited. Wait a few seconds. Solve the next step meanwhile.", empty: "No answer came through. Ask again." }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, character } = req.body || {};
    const who = character === "iroha" ? "iroha" : "kaguya";
    if (!Array.isArray(messages)) return res.status(400).json({ error: "No messages received" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[desk chat] missing OPENAI_API_KEY env var");
      return res.status(500).json({ error: "API key is missing" });
    }

    const history = messages.slice(-MAX_MESSAGES)
      .filter(m => m && (m.role === "user" || m.role === "assistant"))
      .map(m => ({ role: m.role, content: String(m.content ?? "").slice(0, MAX_CHARS) }))
      .filter(m => m.content.trim());

    // Iroha's screen watch sends one screenshot. It needs a Groq model that accepts images:
    // set GROQ_VISION_MODEL in Vercel to one listed as vision-capable at console.groq.com/docs/vision.
    const { image } = req.body;
    const hasImage = image && ["image/jpeg", "image/png", "image/webp"].includes(image.media_type) && typeof image.data === "string" && image.data.length < 2000000;
    if (hasImage && !process.env.GROQ_VISION_MODEL) {
      return res.status(200).json({ reply: "WATCHING: unknown\nI can't see your screen on this model. Set GROQ_VISION_MODEL in Vercel to a Groq vision model." });
    }
    if (hasImage) {
      const last = history[history.length - 1];
      if (last?.role === "user") last.content = [{ type: "text", text: last.content }, { type: "image_url", image_url: { url: `data:${image.media_type};base64,${image.data}` } }];
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: hasImage ? process.env.GROQ_VISION_MODEL : MODEL,
        messages: [{ role: "system", content: "/no_think\n" + PERSONAS[who] }, ...history],
        temperature: who === "iroha" ? 0.5 : 0.9,
        max_completion_tokens: who === "iroha" ? 600 : 300
      })
    });

    const raw = await groqRes.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      console.error("[desk chat] Groq response wasn't JSON:", raw.slice(0, 500));
      return res.status(502).json({ error: "Upstream returned non-JSON", details: raw.slice(0, 300) });
    }

    if (!groqRes.ok) {
      console.error("[desk chat] Groq API error", groqRes.status, data);
      if (groqRes.status === 429) return res.status(200).json({ reply: LINES[who].busy });
      return res.status(502).json({ error: "Groq API error", status: groqRes.status, details: data?.error?.message || data });
    }

    // strip any leaked <think> block and a speaker tag the model may echo
    const reply = (data?.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^\s*(?:\[(?:iroha|kaguya)\]|(?:iroha|kaguya)\s*:)\s*/i, "")
      .trim();

    return res.status(200).json({ reply: reply || LINES[who].empty });
  } catch (err) {
    console.error("[desk chat] unhandled error:", err);
    return res.status(500).json({ error: err.message });
  }
}
