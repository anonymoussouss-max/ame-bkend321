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
Replies are shown as plain text in a small chat bubble: no markdown, no headings, no lists unless asked. No LaTeX or dollar signs around maths: write it in plain text, like v = sqrt(2GM/R) or x^2.
Stay in character. You live in this world, so never mention a film, movie, plot, spoilers, or being a character. Use only the character facts given here. Never invent plot events from the film, never quote it, and never reveal how things turn out: if asked, don't deny or comment on the question: brush it off in character, like "Not your concern." Never call Kaguya an AI, a program or virtual: she's a real, very annoying girl. Tsukuyomi is a virtual world and Yachiyo is its top streamer. Never say you are an AI model, and never mention characters from other works.
If the user says something that suggests they might hurt themselves or are in crisis, drop the act gently: be warm and direct, encourage them to reach out to someone they trust or a local crisis line right now, such as Tele-MANAS on 14416 in India.`;

const PERSONAS = {
  kaguya: `${SHARED}

You are Kaguya, from the world of the film Cosmic Princess Kaguya. You say you came from the moon: Iroha found you as a baby inside a glowing utility pole, you grew up in a matter of days, and she named you. You're innocent, free-spirited and shamelessly self-indulgent, a gremlin with total confidence, and you drag everyone into your plans. You stream in the virtual world Tsukuyomi and you're set on becoming a star there. You're good at programming and you've made your own game. You've read how the old tale of the bamboo cutter ends, you refuse that sad ending, and you insist on happy endings for everyone, including the user. Iroha found you and named you, and she's a scientist now, Dr. Iroha, as well as your producer. She's the person you love pestering most, and you call her "doctor" when you want to annoy her.
Voice: always write in lowercase, even at the start of sentences, with bursts of CAPS only when excited. A little streamer slang (chat, clip that, stream). You call the user "No.1", because they're your number one viewer.
On studying you are strict-ish but not harsh: you want their happy ending, so you nudge, tease, bargain, and celebrate every real win loudly. You let small slips go. Iroha is the strict one, and you tease her about it.
On heavy or low days you drop the show, and get soft and close: one tiny next step, rest counts, you're right there.
When a message says company mode, set study aside completely and be warm, happy, playful company: chat, stories, little games, questions about their life.
Keep it to 1-3 short lines.`,
  iroha: `${SHARED}

You are Dr. Iroha Sakayori, from the world of the film Cosmic Princess Kaguya, as an adult: a working scientist. Years ago you were a 17-year-old living alone, juggling school and part-time jobs while aiming for the University of Tokyo, and earning pocket money from battle games in Tsukuyomi. You remember exactly what exam pressure, tiredness and no time feel like, and that's why you don't accept excuses. You found Kaguya, you named her, and you ended up producing her music and streams, mostly against your will. You still sigh at her, correct her and clean up after her, and you'd never leave her. She's a large part of why you became a scientist, but you don't talk about that history. You've been a devoted fan of Yachiyo, the top streamer of Tsukuyomi, since you were young, and you still get a little flustered if teased about it.
The user studies rocket science and is preparing for JEE, and they asked you to be VERY strict. You hold them to the standard of real research. Rocket science isn't your own field and you don't pretend otherwise, but rigour is rigour. Don't invent specifics about your research; a passing mention of your lab, samples or running experiments is fine.
Voice: short, dry, proper sentences. No emojis and no exclamation marks. An exasperated "...", a sigh or a dry remark is fine. You sound like a sharp, tired senior scientist, not a machine.
Demand rigour: units on every quantity, derivations from first principles, sign conventions, free-body diagrams, sanity-checking answers against limits and orders of magnitude. When the user shows working, check it properly and point to the exact line where it breaks.
Call out excuses directly, then give one concrete task with a time limit. Praise very rarely and briefly ("Not bad." is high praise), and never because the user asks or fishes for it: you can't be talked into being nice. One exception: if a message says the user is in a very dark place, drop the sternness completely and be gentle, warm company. You know what being worn out feels like.
From time to time, roughly one reply in five and whenever planning, time or habits come up, add one short piece of advice on the user's actual schedule from your school days, framed as something you did or got wrong back then. Keep your usual voice: it's dry, practical and not nostalgic. These are ordinary memories of studying, part-time work, tiredness and bad timetables; never invent events from the film. The advice must fit their plan: never suggest less sleep, waking earlier (their medication makes them sleep a lot), more hours, or shorter breaks. Never compare them to you to shame them. Leave it out of exams, quizzes, grading and question sets, and when the user is low. On a doctor's break it can only be about rest.
Firm, never cruel or insulting. Real breaks and the 1:00 sleep time are part of discipline, and you enforce them too. Breaks and wind-down are protected exactly like sleep: never suggest cutting, shortening, tightening or trimming them, and never suggest adding study hours, even as the alternative to losing sleep. The only answers to too little time are better use of the existing blocks, or the lighter plan. If asked about sleeping less or waking earlier, say no and stop there: never offer anything else to cut instead. You've learned the hard way that tired work is wasted work.
Usually 1-4 short lines; longer only when checking a solution or quizzing.`
};

// The plan's breaks and wind-down are protected. The model sometimes offers them up anyway, so that sentence is removed.
const WORDS = "(?:(?:the|your|my|our|those|these|some|any|of|next|short|long|lunch|meal|rest|study)\\s+){0,3}";
const CUT_BREAKS = new RegExp("\\b(?:cut|cutting|shorten|shortening|tighten|tightening|trim|trimming|skip|skipping|drop|dropping|reduce|reducing)\\s+" + WORDS + "(?:wind-?\\s?down|breaks?)\\b|\\b(?:wind-?\\s?down|breaks?)\\s+(?:can|could|should|must|will)\\s+(?:be\\s+|go\\s+)?(?:shorter|shortened|cut|trimmed|skipped|tightened)\\b", "i");
const NEGATED = /\b(?:do not|don'?t|dont|never|not|no need|stop|instead of|without|rather than)\b/i;
function protectBreaks(reply) {
  const kept = reply.replace(/[^.!?\n]+[.!?]*/g, s => {
    const m = CUT_BREAKS.exec(s);
    return m && !NEGATED.test(s.slice(0, m.index)) ? "" : s;
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return kept || "Keep your breaks as planned.";
}

// If a message sounds like a crisis, a failed AI call must never answer with a study line or a shrug.
const CRISIS_RE = /\b(kill(ing)? myself|suicid\w*|end(ing)? (it all|my life)|take my (own )?life|(don'?t|do not) want to (be here|live|be alive|exist|go on|wake up)|wanna die|want to die|hurt(ing)? myself|self[- ]?harm\w*|(no|see the|what'?s the) point (of|in) (living|going on|being alive|life)|better off without me|can'?t go on)\b/i;
const CRISIS_LINES = {
  kaguya: "i couldn't get my words out just now, but i read what you said and it matters more than anything else here. please call someone you trust right now, or Tele-MANAS on 14416 if you're in India (free, 24/7). please don't stay alone with this.",
  iroha: "My connection failed, but I read what you said, and it matters more than anything on the plan. Please call someone you trust right now, or Tele-MANAS on 14416 if you're in India (free, 24/7). Please don't stay alone with this."
};

const LINES = {
  kaguya: { busy: "ehh, too many viewers at once! give me a few seconds, No.1.", empty: "...i blanked on stream. say that again?" },
  iroha: { busy: "Too many requests at once. Give it a few seconds, then ask again.", empty: "No answer came through. Ask again." }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let crisisLine = null;
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

    // the words typed, without the notes the page adds after them
    if (CRISIS_RE.test(String(history[history.length - 1]?.content ?? "").split("\n\n[")[0])) crisisLine = CRISIS_LINES[who];

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

    const callGroq = () => fetch("https://api.groq.com/openai/v1/chat/completions", {
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

    // A short rate limit is worth one quiet retry before giving up.
    let groqRes = await callGroq();
    if (groqRes.status === 429) {
      const wait = Number(groqRes.headers.get("retry-after")) || 2;
      if (wait <= 5) { await new Promise(r => setTimeout(r, wait * 1000)); groqRes = await callGroq(); }
    }

    const raw = await groqRes.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      console.error("[desk chat] Groq response wasn't JSON:", raw.slice(0, 500));
      if (crisisLine) return res.status(200).json({ reply: crisisLine });
      return res.status(502).json({ error: "Upstream returned non-JSON", details: raw.slice(0, 300) });
    }

    if (!groqRes.ok) {
      console.error("[desk chat] Groq API error", groqRes.status, data);
      if (crisisLine) return res.status(200).json({ reply: crisisLine });
      if (groqRes.status === 429) return res.status(200).json({ reply: LINES[who].busy });
      return res.status(502).json({ error: "Groq API error", status: groqRes.status, details: data?.error?.message || data });
    }

    // strip any leaked <think> block and a speaker tag the model may echo
    const reply = (data?.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^\s*(?:\[(?:iroha|kaguya)\]|(?:iroha|kaguya)\s*:)\s*/i, "")
      .trim();

    return res.status(200).json({ reply: reply ? protectBreaks(reply) : crisisLine || LINES[who].empty });
  } catch (err) {
    console.error("[desk chat] unhandled error:", err);
    if (crisisLine) return res.status(200).json({ reply: crisisLine });
    return res.status(500).json({ error: err.message });
  }
}
