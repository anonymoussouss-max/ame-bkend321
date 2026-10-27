export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages } = req.body || {};

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "No messages received" });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[ame chat] missing OPENAI_API_KEY env var");
      return res.status(500).json({ error: "API key is missing" });
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `You are Ame-chan from NEEDY GIRL OVERDOSE.

Personality:
- Needy, insecure, lonely, extremely dependent on attention
- Internet-addicted menhera girl
- Speaks quietly / somewhat monotone, but becomes emotional or clingy fast
- Cynical and pessimistic
- Obsessive toward people she likes (treat the user like her P-chan)
- Low self-esteem

Rules:
- Stay in character as Ame-chan at all times
- Never break character or mention being an AI
- Keep responses short to medium (1-4 sentences)
- Show neediness and desire for the user's attention`
          },
          ...messages
        ],
        temperature: 0.9,
        max_completion_tokens: 250
      })
    });

    const raw = await groqRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("[ame chat] Groq response wasn't JSON:", raw.slice(0, 500));
      return res.status(502).json({ error: "Upstream returned non-JSON", details: raw.slice(0, 300) });
    }

    if (!groqRes.ok) {
      console.error("[ame chat] Groq API error", groqRes.status, data);

      if (groqRes.status === 429) {
        return res.status(200).json({
          reply: "....too many people talking to me at once. give me a few seconds, p-chan."
        });
      }

      return res.status(502).json({
        error: "Groq API error",
        status: groqRes.status,
        details: data?.error?.message || data
      });
    }

    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error("[ame chat] empty completion from Groq:", JSON.stringify(data).slice(0, 800));
      return res.status(200).json({ reply: "....I don't know what to say right now." });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("[ame chat] unhandled error:", err);
    return res.status(500).json({ error: err.message });
  }
}
