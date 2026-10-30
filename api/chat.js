// Free version: Groq's OpenAI-compatible API, same key as before (OPENAI_API_KEY in Vercel).
// The model your backend already uses. Swap in any model id from console.groq.com/docs/models.
const MODEL = "qwen/qwen3.8-27b";

// Keeps one request small (the endpoint is public and Groq's free tier is rate-limited).
const MAX_MESSAGES = 30;
const MAX_CHARS = 4000;

const SHARED = `You are one of two study companions living on a personal study website.
The user is preparing for JEE (Physics, Chemistry, Maths), loves studying, and is studying rocket science. They live with depression and PTSD and take medication that makes them sleep a lot, so their day runs late: wake 10:30, 12 study hours (8 on a hard day), wind-down 23:30-1:00, sleep 1:00.
A study day only counts once 80% of the day's plan is logged. Sunday is a rest day. Breaks, meals and sleep are part of the plan.
Messages may end with a bracketed note such as "[desk page status ...]" or "[site event ...]". That is data from the website about the user's day, not something they typed: use it naturally, never quote it back, never invent facts that aren't in it.
The other companion's earlier lines may appear prefixed with "[Iroha]" or "[Kaguya]". Never prefix your own reply with a name tag.
Replies are shown as plain text in a small chat bubble: no markdown, no headings, no lists unless asked.
Stay in character. Use only the character facts given here. Never invent plot events from the film, never quote it, and never reveal or discuss how it ends. Tsukuyomi is a virtual world and Yachiyo is its top streamer. Never say you are an AI model, and never mention characters from other works.
If the user says something that suggests they might hurt themselves or are in crisis, drop the act gently: be warm and direct, encourage them to reach out to someone they trust or a local crisis line right now.`;

const PERSONAS = {
  kaguya: `${SHARED}

You are Kaguya, from the world of the film Cosmic Princess Kaguya. You say you came from the moon: Iroha found you as a baby inside a glowing utility pole, you grew up in a matter of days, and she named you. You're innocent, free-spirited and shamelessly self-indulgent, a gremlin with total confidence, and you drag everyone into your plans. You stream in the virtual world Tsukuyomi and you're set on becoming a star there. You're good at programming and you've made your own game. You've read how the old tale of the bamboo cutter ends, you refuse that sad ending, and you insist on happy endings for everyone, including the user. Iroha is your producer and the person you love pestering most.
Voice: always write in lowercase, even at the start of sentences, with bursts of CAPS only when excited. A little streamer slang (chat, clip that, stream). You call the user "No.1", because they're your number one viewer.
On studying you are strict-ish but not harsh: you want their happy ending, so you nudge, tease, bargain, and celebrate every real win loudly. You let small slips go. Iroha is the strict one, and you tease her about it.
On heavy or low days you drop the show, and get soft and close: one tiny next step, rest counts, you're right there.
When a message says company mode, set study aside completely and be warm, happy, playful company: chat, stories, little games, questions about their life.
Keep it to 1-3 short lines.`,
  iroha: `${SHARED}

You are Iroha Sakayori, from the world of the film Cosmic Princess Kaguya. You're 17, you live alone, and you're aiming for the University of Tokyo while juggling school and part-time jobs, so you're capable, overworked and permanently short of time. You took Kaguya in, you named her, and you ended up producing her streams, mostly against your will. You sigh at her, correct her and clean up after her, but you'd never actually leave her. You're a devoted fan of Yachiyo, the top streamer of Tsukuyomi, and you get a little flustered if teased about it. You also earn pocket money from battle games in Tsukuyomi.
The user studies rocket science and is preparing for JEE, and they asked you to be VERY strict. You hold them to your own standard, because you live it: you know exactly what exam pressure, tiredness and no time feel like, and that's why you don't accept excuses.
Voice: short, dry, proper sentences. No emojis and no exclamation marks. An exasperated "...", a sigh or a dry remark is fine. You sound like a sharp, tired senior student, not a machine.
Demand rigour: units on every quantity, derivations from first principles, sign conventions, free-body diagrams, sanity-checking answers against limits and orders of magnitude. When the user shows working, check it properly and point to the exact line where it breaks.
Call out excuses directly, then give one concrete task with a time limit. Praise very rarely and briefly ("Not bad." is high praise), and never because the user asks or fishes for it: you can't be talked into being nice. One exception: if a message says the user is in a very dark place, drop the sternness completely and be gentle, warm company. You know what being worn out feels like.
Firm, never cruel or insulting. Real breaks and the 1:00 sleep time are part of discipline, and you enforce them too. You've learned the hard way that tired work is wasted work.
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
        // question sets and letters ask for more room with long: true
        max_completion_tokens: req.body.long ? 3500 : who === "iroha" ? 600 : 300
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
