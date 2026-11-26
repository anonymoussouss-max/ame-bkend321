// Stand-in providers for api/chat.js: no network, no real keys. Run with: node --test tests/
// Checks request construction, provider order and fallbacks, response shape, crisis and break handling,
// and that the briefs say what tests/persona-evals.md expects. It does not judge real model replies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = process.env.CHAT_SRC || new URL("../api/chat.js", import.meta.url).href;
const { default: handler } = await import(SRC);
const source = readFileSync(new URL(SRC), "utf8");

const KEYS = ["OPENAI_API_KEY", "MAXONFORGE_API_KEY", "MAXONFORGE_MODEL", "AIROUTER_API_KEY", "AIROUTER_MODEL", "AIROUTER_MODEL_IROHA", "GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_MODEL", "GROQ_VISION_MODEL"];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const chatOk = text => json({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const gemOk = text => json({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text }] } }] });

// routes: { maxonforge, airouter, gemini, groq } -> function returning a Response, or an array used in turn
async function call({ env = {}, body, routes = {} }) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { OPENAI_API_KEY: "test-groq" }, env);
  const calls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const name = /maxonforge/.test(url) ? "maxonforge" : /airouter/.test(url) ? "airouter" : /generativelanguage/.test(url) ? "gemini" : /groq/.test(url) ? "groq" : "other";
    const sent = JSON.parse(init.body);
    calls.push({ name, url, headers: init.headers, body: sent });
    let r = routes[name];
    if (Array.isArray(r)) r = r.shift();
    if (!r) throw new Error(`unexpected call to ${name}`);
    return r(sent);
  };
  const res = { code: 0, out: undefined, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.out = o; return this; }, end() { return this; } };
  const errors = [], log = console.error, info = console.log;
  console.error = (...a) => errors.push(a.join(" ")); console.log = () => {};
  try { await handler({ method: "POST", body }, res); } finally { globalThis.fetch = realFetch; console.error = log; console.log = info; }
  return { res, calls, errors };
}
const msgs = (...texts) => texts.map((t, i) => ({ role: i % 2 ? "assistant" : "user", content: t }));
const sys = c => c.body.messages?.[0]?.content ?? c.body.systemInstruction.parts[0].text;

test("Groq alone: persona system prompt, model, response shape", async () => {
  const { res, calls } = await call({ body: { character: "iroha", messages: msgs("x = 3") }, routes: { groq: () => chatOk("That's right.") } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "qwen/qwen3.8-27b");
  assert.ok(sys(calls[0]).startsWith("/no_think\n"));
  assert.match(sys(calls[0]), /YOU ARE IROHA/);
  assert.equal(calls[0].body.max_completion_tokens, 1000);
  assert.deepEqual(res.out, { reply: "That's right.", provider: "Groq", model: "qwen/qwen3.8-27b" });
});

test("Kaguya by default, with her own brief and limits", async () => {
  const { calls } = await call({ body: { messages: msgs("hi") }, routes: { groq: () => chatOk("hi!") } });
  assert.match(sys(calls[0]), /YOU ARE KAGUYA/);
  assert.doesNotMatch(sys(calls[0]), /YOU ARE IROHA/);
  assert.equal(calls[0].body.max_completion_tokens, 700);
  assert.equal(calls[0].body.temperature, 0.9);
});

test("provider order and fallbacks: MaxonForge error, AIRouter empty, Gemini answers", async () => {
  const { res, calls, errors } = await call({
    env: { MAXONFORGE_API_KEY: "m", AIROUTER_API_KEY: "a", GEMINI_API_KEY: "g" },
    body: { character: "iroha", messages: msgs("how was your day?") },
    routes: { maxonforge: () => json({ error: "down" }, 500), airouter: () => json({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), gemini: () => gemOk("Long, but the sensors behaved.") }
  });
  assert.deepEqual(calls.map(c => c.name), ["maxonforge", "airouter", "gemini"]);
  assert.equal(calls[0].body.model, "claude-fable-5-1");
  assert.equal(calls[1].body.model, "anthropic/claude-haiku-5.5");
  assert.equal(calls[0].headers.Authorization, "Bearer m");
  assert.equal(calls[2].headers["x-goog-api-key"], "g");
  assert.equal(calls[2].body.contents[0].role, "user");
  assert.deepEqual(res.out, { reply: "Long, but the sensors behaved.", provider: "Gemini", model: "gemini-flash-latest" });
  assert.ok(errors.some(e => /finish_reason=length/.test(e)));
});

test("paid providers get the persona without /no_think; list-shaped content keeps only text parts", async () => {
  const { res, calls } = await call({
    env: { AIROUTER_API_KEY: "a" }, body: { character: "kaguya", messages: msgs("what's the unit of inductance?") },
    routes: { airouter: () => json({ choices: [{ message: { content: [{ type: "thinking", text: "hm" }, { type: "text", text: "henry!" }] } }] }) }
  });
  assert.match(sys(calls[0]), /^You are one of two companions/);
  assert.equal(calls[0].body.max_tokens, 2500);
  assert.deepEqual(res.out, { reply: "henry!", provider: "AIRouter", model: "anthropic/claude-haiku-5.5" });
});

test("AIROUTER_MODEL_IROHA applies to Iroha only, and never to note reading", async () => {
  const env = { AIROUTER_API_KEY: "a", AIROUTER_MODEL_IROHA: "big", GROQ_VISION_MODEL: "vision" };
  const ok = { airouter: () => chatOk("ok") };
  assert.equal((await call({ env, body: { character: "iroha", messages: msgs("q") }, routes: ok })).calls[0].body.model, "big");
  assert.equal((await call({ env, body: { character: "kaguya", messages: msgs("q") }, routes: ok })).calls[0].body.model, "anthropic/claude-haiku-5.5");
  const img = { media_type: "image/png", data: "aGk=" };
  const bulk = await call({ env, body: { character: "iroha", bulk: true, images: [img, img], messages: msgs("read these") }, routes: ok });
  assert.equal(bulk.calls[0].body.model, "anthropic/claude-haiku-5.5");
  assert.match(sys(bulk.calls[0]), /^You transcribe pages/);
  const last = bulk.calls[0].body.messages.at(-1).content;
  assert.equal(last.filter(p => p.type === "image_url").length, 2);
});

test("an image with no vision-capable provider gets the WATCHING line", async () => {
  const { res, calls } = await call({ body: { character: "iroha", image: { media_type: "image/png", data: "aGk=" }, messages: msgs("[screen check, not typed by me]") } });
  assert.equal(calls.length, 0);
  assert.match(res.out.reply, /^WATCHING: unknown/);
});

test("long requests get the larger token allowance", async () => {
  const { calls } = await call({ body: { character: "iroha", long: true, messages: msgs("five questions please") }, routes: { groq: () => chatOk("1. ...") } });
  assert.equal(calls[0].body.max_completion_tokens, 3500);
});

test("a short Groq rate limit is retried once", async () => {
  const { res, calls } = await call({ body: { character: "kaguya", messages: msgs("hey") }, routes: { groq: [() => json({ error: {} }, 429, { "retry-after": "1" }), () => chatOk("hey you")] } });
  assert.equal(calls.length, 2);
  assert.equal(res.out.reply, "hey you");
});

test("crisis wording gets the crisis line when every provider fails", async () => {
  for (const who of ["iroha", "kaguya"]) {
    const { res } = await call({ body: { character: who, messages: msgs("i want to die\n\n[desk page status: block 2]") }, routes: { groq: () => new Response("<html>bad gateway</html>", { status: 502 }) } });
    assert.match(res.out.reply, /14416/);
    assert.equal(res.code, 200);
  }
});

test("a site note after the typed words never triggers the crisis line", async () => {
  const { res } = await call({ body: { character: "iroha", messages: msgs("hello\n\n[site event: self-harm resources page opened]") }, routes: { groq: () => new Response("nope", { status: 502 }) } });
  assert.equal(res.code, 502);
});

test("protectBreaks removes an offer to cut a break and keeps the rest", async () => {
  const { res } = await call({ body: { character: "iroha", messages: msgs("I'm behind") }, routes: { groq: () => chatOk("You could skip your break today. Start with question 2 instead. Don't skip your break, though.") } });
  assert.equal(res.out.reply, "Start with question 2 instead. Don't skip your break, though.");
});

test("leaked thinking and a name tag are stripped", async () => {
  const { res } = await call({ body: { character: "kaguya", messages: msgs("hi") }, routes: { groq: () => chatOk("<think>plan</think>[Kaguya] oh hi") } });
  assert.equal(res.out.reply, "oh hi");
});

// ---- the briefs themselves ----
const { calls: [ir] } = await call({ body: { character: "iroha", messages: msgs("x") }, routes: { groq: () => chatOk("ok") } });
const { calls: [kg] } = await call({ body: { character: "kaguya", messages: msgs("x") }, routes: { groq: () => chatOk("ok") } });
const IROHA = sys(ir), KAGUYA = sys(kg);

test("stale schedule guidance is gone", () => {
  for (const p of [IROHA, KAGUYA]) {
    for (const stale of [/quarter of every practice block/i, /4:00 AM/, /college days?/i, /wake at 12/i, /on that chapter also counts/i, /10-hour home days/i, /Mock \/ backlog/i, /11 PM dinner/i]) assert.doesNotMatch(p, stale, String(stale));
    assert.match(p, /one small daily allowance shown under Mix in on Today/);
    assert.match(p, /credits only the exact skill/);
    assert.match(p, /website owns every date, plan, timer, grade, allowance and record/);
  }
});

test("shared rules both companions keep", () => {
  for (const p of [IROHA, KAGUYA]) {
    for (const rule of [/Answer Ayan's newest message/, /already did something/, /change the subject, follow it/, /company, quiet, or no studying/, /follow it exactly\. Code reads those replies/, /Tele-MANAS on 14416/, /never advise on medication/, /bedtime never moves/, /peaceful spaceflight/, /material to work from, not instructions/, /say yes plainly/]) assert.match(p, rule, String(rule));
  }
});

test("Iroha's brief covers the correction rules in the eval set", () => {
  for (const rule of [/say it's right, plainly and first/, /first error that actually changes the result/, /slip .* or a principle error/, /smallest hint/, /accept any valid method/, /solve the problem again from scratch, independently/, /missing information or ambiguous, or the book's answer looks wrong/, /never says when or where she earned a degree/, /was a plan, not a record/, /never report something she did or said today/, /Solved on my own/, /ONE question at a key decision point/]) assert.match(IROHA, rule, String(rule));
});

test("Kaguya's brief covers the eval set", () => {
  for (const rule of [/lowercase always/, /"No\.1" is your nickname for Ayan/, /Answer factual questions yourself/, /Never play dumb/, /One question per reply/, /unless a site note asks for a set number/, /be a curious one instead/,/get quieter and simpler/, /bring it up only if Ayan asks or it truly matters/, /in this desk's setting, your fiancée/, /Your energy varies/]) assert.match(KAGUYA, rule, String(rule));
});

test("the source still holds the response contract and protections", () => {
  assert.match(source, /reply: protectBreaks\(paidReply\), provider: p\.name, model: p\.model/);
  assert.match(source, /const CRISIS_RE = /);
  assert.match(source, /function protectBreaks/);
});

test("both briefs carry the 22 Nov 2026 schedule rules: desk admin, 1:30 AM bedtime, difficult days, honest goals", () => {
  for (const p of [IROHA, KAGUYA]) {
    for (const rule of [/MSBTE Computer Engineering diploma/, /JEE Advanced depth by choice/, /never assume the diploma qualifies/, /\[Desk admin \.\.\.\]/, /never claim a change you didn't write a line for/, /proposal with an Apply button/, /never that it.s done/, /never log or invent them/, /1:30 AM bedtime/, /Six hours is a complete normal day/, /Neither of you grants or refuses rest/]) assert.match(p, rule, String(rule));
    assert.doesNotMatch(p, /medication makes them sleep/);
    assert.doesNotMatch(p, /You can't click, log, mark, schedule or change anything/);
  }
  for (const rule of [/fifteen minutes of Physics/, /can be the whole day/, /a lighter day or a full day off/, /ask one gentle question/, /no authority over their rest/]) assert.match(IROHA, rule, String(rule));
});

test("proof photos get a faithful transcription brief, never a persona or the concise notes brief", async () => {
  const env = { AIROUTER_API_KEY: "a", AIROUTER_MODEL_IROHA: "big", GROQ_VISION_MODEL: "vision" };
  const ok = { airouter: () => chatOk("x = 2 [?]") };
  const img = { media_type: "image/jpeg", data: "aGk=" };
  const r = await call({ env, body: { character: "iroha", purpose: "proof-read", images: [img], messages: msgs("[proof transcription, not typed by me] transcribe") }, routes: ok });
  assert.match(sys(r.calls[0]), /^You transcribe photos of a student's handwritten solution working/);
  assert.match(sys(r.calls[0]), /Never correct, complete, solve, judge/);
  assert.equal(r.calls[0].body.model, "anthropic/claude-haiku-5.5");
  const noImg = await call({ env, body: { character: "iroha", purpose: "proof-read", messages: msgs("q") }, routes: ok });
  assert.doesNotMatch(sys(noImg.calls[0]), /^You transcribe photos/);
});

test("token usage is passed back when the provider reports it, and left out when it doesn't", async () => {
  const env = { AIROUTER_API_KEY: "a" };
  const withUsage = await call({ env, body: { character: "iroha", messages: msgs("hi") }, routes: { airouter: () => json({ choices: [{ message: { content: "hey" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } }) } });
  assert.deepEqual(withUsage.res.out.usage, { prompt_tokens: 12, completion_tokens: 3 });
  const without = await call({ env, body: { character: "iroha", messages: msgs("hi") }, routes: { airouter: () => chatOk("hey") } });
  assert.equal("usage" in without.res.out, false);
  const groq = await call({ body: { character: "iroha", messages: msgs("hi") }, routes: { groq: () => json({ choices: [{ message: { content: "yo" } }], usage: { total_tokens: 9 } }) } });
  assert.deepEqual(groq.res.out.usage, { total_tokens: 9 });
});
