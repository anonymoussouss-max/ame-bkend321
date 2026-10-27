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
      return res.status(500).json({ error: "API key is missing" });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
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
        max_tokens: 300
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ 
        error: "API error", 
        details: data.error?.message || data 
      });
    }

    const reply = data.choices[0].message.content;
    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}