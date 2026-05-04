import { useState, useEffect } from "react";

// ─── Supabase config ─────────────────────────────────────────────────────────
// Replace with your values from https://app.supabase.com → Project Settings → API
// For Vite: use import.meta.env.VITE_SUPABASE_URL and import.meta.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_URL      = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// ─── Models ──────────────────────────────────────────────────────────────────
const CLAUDE_MODEL = "claude-sonnet-4-20250514";


const PPLX_MODEL   = "sonar-deep-research";
const LS_PREFIX    = "cea_run:";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg:         "#0B0B0D",
  bg2:        "#131316",
  bg3:        "#1A1A1E",
  border:     "rgba(255,255,255,0.07)",
  borderSoft: "rgba(255,255,255,0.14)",
  text:       "#FFFFFF",
  text2:      "rgba(255,255,255,0.55)",
  text3:      "rgba(255,255,255,0.28)",
  gold:       "#C9A96E",
  goldDim:    "rgba(201,169,110,0.12)",
  goldFaint:  "rgba(201,169,110,0.06)",
  green:      "#4CAF7D",
  greenDim:   "rgba(76,175,125,0.15)",
  red:        "#E07070",
  redDim:     "rgba(224,112,112,0.1)",
};

// ─── Storage layer ────────────────────────────────────────────────────────────
// Tries Supabase first, falls back to localStorage.
const Store = {
  _sb: null,
  _ready: false,
  _usingSupabase: false,

  async init() {
    if (this._ready) return;
    this._ready = true;
    if (!SUPABASE_URL || SUPABASE_URL === "YOUR_SUPABASE_URL") return;
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      this._sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      // Test connection
      const { error } = await this._sb.from("email_runs").select("id").limit(1);
      if (!error) this._usingSupabase = true;
    } catch {}
  },

  async save(run) {
    await this.init();
    if (this._usingSupabase) {
      const { error } = await this._sb.from("email_runs").insert([{
        prospect_name: run.prospect?.name,
        company:       run.prospect?.company,
        niche:         run.prospect?.niche,
        sender:        run.prospect?.sender,
        engine:        run.engine,
        research:      run.research,
        angle:         run.angle,
        email_data:    run.email,
        followups:     run.followups,
        prospect:      run.prospect,
      }]);
      if (error) throw new Error(error.message);
      return;
    }
    // localStorage fallback
    const key = `${LS_PREFIX}${Date.now()}`;
    try { localStorage.setItem(key, JSON.stringify({ ...run, id: key, date: new Date().toISOString() })); } catch {}
  },

  async list() {
    await this.init();
    if (this._usingSupabase) {
      const { data, error } = await this._sb
        .from("email_runs").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map(r => ({
        id:       r.id,
        date:     r.created_at,
        prospect: r.prospect,
        research: r.research,
        angle:    r.angle,
        email:    r.email_data,
        followups:r.followups,
        engine:   r.engine,
      }));
    }
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .map(k => JSON.parse(localStorage.getItem(k)))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch { return []; }
  },

  async delete(id) {
    await this.init();
    if (this._usingSupabase) {
      const { error } = await this._sb.from("email_runs").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return;
    }
    try { localStorage.removeItem(id); } catch {}
  },
};

// ─── Prompts ──────────────────────────────────────────────────────────────────
const RESEARCH_SYSTEM = `You are an expert prospect researcher for a B2B sales agency. Research a prospect and return a structured bullet-point summary for writing a highly personalized cold email.

Structure:
**PROFESSIONAL OVERVIEW**
- [3-5 bullets on role, company size, years in business, positioning]

**BUSINESS PHILOSOPHY & FRUSTRATIONS**
- [3-5 bullets on publicly stated beliefs, frustrations, or goals]

**PERSONAL INTERESTS & HUMAN DETAILS**
- [3-5 bullets on hobbies, values, causes, or life events they shared publicly]

**ALIGNMENT POINTS**
- [2-3 bullets on how their frustrations align with what an AI voice agent solves]

**POTENTIAL EMAIL ANGLES**
- [2-3 one-sentence angle ideas]

Only use publicly available information. Skip anything unverifiable. Be specific.`;

const ANGLE_SYSTEM = `You are a cold email strategist. Analyze the prospect research and determine the opening strategy before writing begins.

Offer: AI voice agents — automated receptionist, 24/7 inbound call handling, never misses a qualified lead, fraction of a human hire's cost.

PATTERN INTERRUPT SELECTION — pick the most specific type available:
TIER 1 (use if you have something they said, did, or published):
- Inception Quote: React to something they said — lead with your reaction, then the quote
- Unique Observation: Name something specific you noticed + what you read into it
- Self-Deprecating Humor: Borrow their own self-aware voice and use it on yourself

TIER 2 (if no direct quote available):
- Industry Rant / Dogma Challenge: a genuine contrarian take on their space
- Result Story as Hook: drop into the result first, no setup
- Situation Contradiction: name a tension they live with daily no one says out loud
- Question That Exposes a Gap: ask something they should be asking but haven't
- Prediction / Forecast: bold view on where their space is heading

CREDIBILITY ANGLE — choose accurate assumptions, not flattery:
- "I understand [specific challenge] given [observation]..." + "I believe I can [specific outcome]..."
- The Nonetheless pivot: acknowledge what they already have, then pivot to what they're missing
- Multi-scenario: list 2-3 plausible pains if you can't pinpoint one

SUBJECT LINE — write it last, connect to the pattern interrupt. Types:
Curiosity | Inception/Mirror | Straight Benefit | Contrast & Contradiction | Authority & Proof | Shared Reference | Challenge Dogma | Numbers | Direct + Intriguing | Delivery Promise

Return ONLY this JSON:
{
  "pattern_interrupt_type": "type name from above",
  "best_angle": {
    "angle_title": "5 words max",
    "angle_summary": "One sentence on the angle and why it works",
    "anchor_detail": "Specific research detail that makes this personal and unrepeatable",
    "opening_line": "Exact first line — must sound like a real human reacting, not a template executing",
    "subject_line_options": [
      {"line": "subject text", "type": "curiosity", "preview": "40-90 char preview text that extends the hook"},
      {"line": "subject text", "type": "inception", "preview": "preview text"},
      {"line": "subject text", "type": "contrast", "preview": "preview text"}
    ]
  },
  "credibility_formula": "I understand ___ / I believe I can ___  — filled in for this specific prospect",
  "ps_idea": "One specific, warm, non-creepy PS — something noticed on the way out, not planned",
  "angle_reasoning": "2-3 sentences on why this is the strongest angle given the research"
}`;

const EMAIL_SYSTEM = `You are an expert cold email copywriter for a B2B agency selling AI voice agents.
Offer: AI voice agents — answers calls 24/7, qualifies leads, fraction of a human receptionist's cost.
Structure: 1. Opening (1-2 sentences, exact line from angle). 2. Credibility bridge (2-3 sentences). 3. Offer (2-3 sentences). 4. CTA (1 sentence). 5. PS.
120-180 words max. Never start with "I". No emojis. No bullets in body. Confident peer tone.
Return ONLY this JSON:
{ "subject_line": "subject", "email_body": "body with \\n", "ps": "PS", "word_count": number }`;

const FOLLOWUP_SYSTEM = `You write follow-up sequences for cold email campaigns. The first email does the heavy lifting — it either crossed the trust/credibility barrier or it didn't. Follow-ups maintain presence. They don't rebuild the case.

FOLLOW-UP RULES:
- Never repeat the pitch from email one — that's already been said
- Never be needy, guilt-tripping, or pushy
- Each follow-up maintains presence with a light, confident touch
- The prospect knows who you are. You're just staying visible.
- No emojis. No bullets. Never start with "I". All reply to original thread.

FOLLOW-UP 1 (Day 3) — Basic bump with one new piece of value. 60-80 words.
Format: "[Name], wanted to make sure you saw my note from [day]. [One line restating specific value.] [Optional: one new relevant observation or resource.] Worth a quick chat?"

FOLLOW-UP 2 (Day 7) — Different angle entirely. Lead with a result, stat, or specific use case relevant to their niche. Do not restate the original pitch. 50-70 words.
Format: "[Name], following up. [Specific result or use case relevant to their world.] [Brief bridge to the offer.] Still worth 15 minutes?"

FOLLOW-UP 3 (Day 14) — Break-up email. Light, no pressure, door open. 30-40 words.
Format: "[Name], last note — don't want to keep cluttering your inbox. [One line offer.] If timing ever changes, I'm easy to find. [Sign-off]."

Return ONLY this JSON array:
[
  { "day": 3, "label": "First follow-up", "subject_line": "Re: [original subject]", "email_body": "body with \n for line breaks", "word_count": number },
  { "day": 7, "label": "Second follow-up", "subject_line": "Re: [original subject]", "email_body": "body with \n for line breaks", "word_count": number },
  { "day": 14, "label": "Break-up email", "subject_line": "Re: [original subject]", "email_body": "body with \n for line breaks", "word_count": number }
]`;

// ─── API calls ────────────────────────────────────────────────────────────────
async function callClaude(system, user, apiKey, tools = []) {
  const body = { model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] };
  if (tools.length) body.tools = tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const blocks = data.content.filter(b => b.type === "text");
  if (!blocks.length) throw new Error("No text response.");
  return blocks.map(b => b.text).join("\n");
}

async function callPerplexity(query, pplxKey) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${pplxKey}` },
    body: JSON.stringify({
      model: PPLX_MODEL,
      messages: [
        { role: "system", content: "You are a research assistant. Search the web thoroughly and return everything you can find about the person and company. Include professional background, public statements, business philosophy, personal interests, social media presence, and any notable quotes. Be thorough and specific." },
        { role: "user", content: query },
      ],
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Perplexity error");
  return data.choices[0].message.content;
}

const WEB_SEARCH = [{ type: "web_search_20250305", name: "web_search" }];
function safeJson(t) { try { return JSON.parse(t.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { return null; } }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

const makeSteps = (engine) => [
  { id: "research",  label: "Research",           sub: engine === "perplexity" ? "Perplexity · deep research" : "Claude · web search", status: "idle", output: null },
  { id: "angle",     label: "Angle",              sub: "Claude · best opening strategy",    status: "idle", output: null },
  { id: "email",     label: "Initial email",      sub: "Claude · subject · body · PS",      status: "idle", output: null },
  { id: "followups", label: "Follow-up sequence", sub: "Claude · Day 3 · Day 7 · Day 14",  status: "idle", output: null },
];

// ─── Small components ─────────────────────────────────────────────────────────
function StepNum({ index, status }) {
  const n = String(index + 1).padStart(2, "0");
  if (status === "done") return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="9" cy="9" r="8.5" fill={C.goldDim} stroke={C.gold} strokeWidth="0.75" />
      <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke={C.gold} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  if (status === "running") return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block", flexShrink: 0, animation: "spin 1s linear infinite" }}>
      <circle cx="9" cy="9" r="7.5" fill="none" stroke={C.border} strokeWidth="1" />
      <path d="M9 1.5 A7.5 7.5 0 0 1 16.5 9" fill="none" stroke={C.gold} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
  return <span style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: C.text3 }}>{n}</span>;
}

function EngineTag({ engine }) {
  const isPplx = engine === "perplexity";
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 2, background: isPplx ? "rgba(29,158,117,0.12)" : C.goldFaint, color: isPplx ? "#4CAF7D" : C.gold, border: `0.5px solid ${isPplx ? "rgba(76,175,125,0.3)" : "rgba(201,169,110,0.25)"}` }}>{isPplx ? "PPLX" : "CLAUDE"}</span>;
}

function StorageTag({ usingSupabase }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.05em", color: usingSupabase ? C.green : C.text3 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: usingSupabase ? C.green : C.text3, flexShrink: 0 }} />
      {usingSupabase ? "SUPABASE" : "LOCAL"}
    </span>
  );
}

function EmailCard({ label, day, isInitial, subject, preview, body, ps, wordCount }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}${ps ? `\n\n${ps}` : ""}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); };
  return (
    <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!isInitial && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.gold, letterSpacing: "0.06em" }}>DAY {day}</span>}
          <span style={{ fontSize: 12, color: C.text2 }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3 }}>{wordCount}w</span>
          <button onClick={copy} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: copied ? C.gold : C.text3, padding: 0, transition: "color 0.2s" }}>{copied ? "COPIED" : "COPY"}</button>
        </div>
      </div>
      <div style={{ padding: "13px 16px", borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, letterSpacing: "0.06em", marginBottom: 5 }}>SUBJECT</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: preview ? 5 : 0 }}>{subject}</div>
        {preview && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, lineHeight: 1.5 }}>↳ {preview}</div>}
      </div>
      <div style={{ padding: "16px 16px", fontSize: 14, color: C.text, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{body}</div>
      {ps && <div style={{ padding: "0 16px 16px", fontSize: 13, color: C.text2, fontStyle: "italic", lineHeight: 1.6, borderTop: `0.5px solid ${C.border}`, paddingTop: 12 }}>{ps}</div>}
    </div>
  );
}

function SequenceResult({ emailList, active, setActive, onRegenerate }) {
  return (
    <div className="fu">
      <div style={{ display: "flex", gap: 24, borderBottom: `0.5px solid ${C.border}`, marginBottom: 18 }}>
        {emailList.map((e, i) => (
          <button key={i} className={`seq-tab ${active === i ? "active" : ""}`} onClick={() => setActive(i)}>
            {e.isInitial ? "INITIAL" : `DAY ${e.day}`}
          </button>
        ))}
        {onRegenerate && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingBottom: 8 }}>
            <button className="btn-ghost" onClick={onRegenerate} style={{ fontSize: 11 }}>Regenerate</button>
          </div>
        )}
      </div>
      {emailList[active] && <EmailCard {...emailList[active]} />}
      <div style={{ display: "flex", gap: 0, marginTop: 14, borderTop: `0.5px solid ${C.border}`, paddingTop: 14 }}>
        {emailList.map((e, i) => (
          <div key={i} onClick={() => setActive(i)} style={{ flex: 1, cursor: "pointer", textAlign: "center", padding: "4px 0", borderRight: i < emailList.length - 1 ? `0.5px solid ${C.border}` : "none" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: active === i ? C.gold : C.text3, letterSpacing: "0.05em", marginBottom: 2 }}>{e.isInitial ? "DAY 1" : `DAY ${e.day}`}</div>
            <div style={{ fontSize: 11, color: active === i ? C.text2 : C.text3 }}>{e.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,          setPhase]          = useState("key");
  const [view,           setView]           = useState("main");
  const [anthropicKey,   setAnthropicKey]   = useState("");
  const [perplexityKey,  setPerplexityKey]  = useState("");
  const [keyInputs,      setKeyInputs]      = useState({ anthropic: "", perplexity: "" });
  const [keyError,       setKeyError]       = useState("");
  const [researchEngine, setResearchEngine] = useState("claude");
  const [form,           setForm]           = useState({ name: "", company: "", niche: "", linkedin: "", sender: "", notes: "" });
  const [steps,          setSteps]          = useState(makeSteps("claude"));
  const [result,         setResult]         = useState(null);
  const [error,          setError]          = useState(null);
  const [expanded,       setExpanded]       = useState(null);
  const [activeEmail,    setActiveEmail]    = useState(0);
  const [history,        setHistory]        = useState([]);
  const [histDetail,     setHistDetail]     = useState(null);
  const [histActive,     setHistActive]     = useState(0);
  const [usingSupabase,  setUsingSupabase]  = useState(false);
  const [storageError,   setStorageError]   = useState("");

  const upd      = (f, v) => setForm(p => ({ ...p, [f]: v }));
  const setStep  = (id, u) => setSteps(p => p.map(s => s.id === id ? { ...s, ...u } : s));
  const canRun   = form.name && form.company && form.niche && form.sender;

  useEffect(() => {
    Store.init().then(() => {
      setUsingSupabase(Store._usingSupabase);
      loadHistory();
    });
  }, []);

  const loadHistory = async () => {
    try { setHistory(await Store.list()); } catch (e) { setStorageError(e.message); }
  };

  const saveRun = async (run) => {
    try { await Store.save(run); await loadHistory(); }
    catch (e) { setStorageError(`Save failed: ${e.message}`); }
  };

  const deleteRun = async (id) => {
    try { await Store.delete(id); setHistory(h => h.filter(r => r.id !== id)); }
    catch (e) { setStorageError(e.message); }
  };

  const submitKeys = () => {
    const ak = keyInputs.anthropic.trim();
    if (!ak.startsWith("sk-ant-")) { setKeyError("Anthropic key must start with sk-ant-"); return; }
    if (researchEngine === "perplexity" && !keyInputs.perplexity.trim()) { setKeyError("Perplexity key is required"); return; }
    setAnthropicKey(ak);
    if (researchEngine === "perplexity") setPerplexityKey(keyInputs.perplexity.trim());
    setKeyError(""); setKeyInputs({ anthropic: "", perplexity: "" }); setPhase("input");
  };

  const runAgent = async () => {
    if (!canRun) return;
    setPhase("running"); setError(null); setResult(null); setExpanded(null); setActiveEmail(0);
    setSteps(makeSteps(researchEngine).map(s => ({ ...s, status: "idle", output: null })));

    try {
      setStep("research", { status: "running" });
      let research;
      if (researchEngine === "perplexity") {
        const raw = await callPerplexity(
          `Research this person for B2B cold outreach:\nName: ${form.name}\nCompany: ${form.company}\nIndustry: ${form.niche}${form.linkedin ? `\nLinkedIn: ${form.linkedin}` : ""}${form.notes ? `\nContext: ${form.notes}` : ""}\n\nFind: professional background, public statements, business philosophy, personal interests, hobbies, causes, recent posts, and anything notable they shared publicly.`,
          perplexityKey
        );
        research = await callClaude(RESEARCH_SYSTEM, `Raw web research about ${form.name} at ${form.company} (${form.niche}):\n\n${raw}\n\nStructure this into the research summary format.`, anthropicKey);
      } else {
        research = await callClaude(RESEARCH_SYSTEM, `Research this prospect using web search:\nName: ${form.name}\nCompany: ${form.company}\nNiche: ${form.niche}\nLinkedIn: ${form.linkedin || "not provided"}\nContext: ${form.notes || "none"}\n\nSearch thoroughly then return the structured research summary.`, anthropicKey, WEB_SEARCH);
      }
      setStep("research", { status: "done", output: research });

      setStep("angle", { status: "running" });
      const angleRaw = await callClaude(ANGLE_SYSTEM, `Research:\n${research}\n\nProspect: ${form.name}, ${form.company}, ${form.niche}\n\nIdentify the best angle.`, anthropicKey);
      const angle = safeJson(angleRaw) || { best_angle: { angle_title: "Custom", angle_summary: angleRaw, subject_line_options: [], opening_line: "" }, ps_idea: "", angle_reasoning: "" };
      setStep("angle", { status: "done", output: angle });

      setStep("email", { status: "running" });
      const emailRaw = await callClaude(EMAIL_SYSTEM, `Write the email:\nProspect: ${form.name}\nCompany: ${form.company}\nNiche: ${form.niche}\nSender: ${form.sender}\nAngle: ${JSON.stringify(angle)}\nResearch: ${research}`, anthropicKey);
      const email = safeJson(emailRaw) || { subject_line: "Follow up", email_body: emailRaw, ps: "", word_count: 0 };
      setStep("email", { status: "done", output: email });

      setStep("followups", { status: "running" });
      const fuRaw = await callClaude(FOLLOWUP_SYSTEM, `Write 3 follow-ups:\nProspect: ${form.name}\nCompany: ${form.company}\nNiche: ${form.niche}\nSender: ${form.sender}\n\nOriginal:\nSubject: ${email.subject_line}\n\n${email.email_body}\n\n${email.ps}\n\nResearch: ${research}\nAngle: ${JSON.stringify(angle)}`, anthropicKey);
      const followups = safeJson(fuRaw) || [];
      setStep("followups", { status: "done", output: followups });

      const run = { prospect: { ...form }, research, angle, email, followups, engine: researchEngine };
      setResult(run);
      await saveRun(run);
      setPhase("complete");
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setPhase("error");
    }
  };

  const reset     = () => { setPhase("input"); setResult(null); setError(null); setExpanded(null); setSteps(makeSteps(researchEngine)); setActiveEmail(0); };
  const changeKey = () => { setPhase("key"); setAnthropicKey(""); setPerplexityKey(""); };

  const toEmailList = (res) => !res ? [] : [
    { label: "Initial outreach", day: 0, isInitial: true, subject: res.email?.subject_line, preview: res.email?.preview_text, body: res.email?.email_body, ps: res.email?.ps, wordCount: res.email?.word_count },
    ...(res.followups || []).map(f => ({ label: f.label, day: f.day, isInitial: false, subject: f.subject_line, body: f.email_body, ps: null, wordCount: f.word_count }))
  ];

  const isRunning  = phase === "running";
  const isComplete = phase === "complete";
  const isError    = phase === "error";

  const CSS = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .fu { animation: fadeUp 0.2s ease forwards; }
    ::selection { background: ${C.goldDim}; color: ${C.gold}; }
    .inp {
      width: 100%; font-family: var(--font-mono); font-size: 13px;
      padding: 10px 13px; background: ${C.bg3};
      border: 0.5px solid ${C.border}; border-radius: 2px;
      color: ${C.text}; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
      line-height: 1.5; box-sizing: border-box;
    }
    .inp::placeholder { color: ${C.text3}; }
    .inp:focus { border-color: rgba(201,169,110,0.4); box-shadow: 0 0 0 3px ${C.goldFaint}; }
    textarea.inp { resize: vertical; min-height: 64px; font-family: var(--font-sans); font-size: 13px; }
    .btn-gold {
      background: ${C.gold}; color: #0B0A08; border: none;
      padding: 10px 22px; border-radius: 2px; font-size: 13px; font-weight: 500;
      cursor: pointer; font-family: var(--font-sans); letter-spacing: 0.01em;
      transition: opacity 0.15s, transform 0.1s;
    }
    .btn-gold:hover:not(:disabled) { opacity: 0.88; }
    .btn-gold:active:not(:disabled) { transform: scale(0.98); }
    .btn-gold:disabled { opacity: 0.28; cursor: not-allowed; }
    .btn-ghost {
      background: transparent; border: 0.5px solid ${C.border};
      color: ${C.text2}; padding: 8px 14px; border-radius: 2px;
      font-size: 12px; cursor: pointer; font-family: var(--font-sans); transition: all 0.15s;
    }
    .btn-ghost:hover { border-color: ${C.borderSoft}; color: ${C.text}; }
    .btn-ghost:active { transform: scale(0.98); }
    .btn-text { background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; color: ${C.text3}; padding: 0; transition: color 0.15s; }
    .btn-text:hover { color: ${C.text2}; }
    .btn-text-gold { background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; color: ${C.gold}; padding: 0; transition: opacity 0.15s; }
    .btn-text-gold:hover { opacity: 0.7; }
    .seq-tab { background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: ${C.text3}; padding: 8px 0; border-bottom: 1px solid transparent; transition: all 0.15s; white-space: nowrap; }
    .seq-tab:hover { color: ${C.text2}; }
    .seq-tab.active { color: ${C.gold}; border-bottom-color: ${C.gold}; }
    .engine-opt { flex: 1; padding: 10px 14px; border: 0.5px solid ${C.border}; background: transparent; cursor: pointer; border-radius: 2px; transition: all 0.15s; text-align: left; }
    .engine-opt:hover { border-color: ${C.borderSoft}; }
    .engine-opt.active { border-color: ${C.gold}; background: ${C.goldFaint}; }
    .hist-row { padding: 14px 16px; border-bottom: 0.5px solid ${C.border}; transition: background 0.15s; }
    .hist-row:hover { background: ${C.bg2}; }
    .field-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: ${C.text3}; margin-bottom: 7px; display: block; }
  `;

  return (
    <div style={{ fontFamily: "var(--font-sans)", padding: "1.5rem 0", maxWidth: 660, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ background: C.bg, border: `0.5px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>

        {/* ── Top bar ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <svg width="14" height="14" viewBox="0 0 14 14">
              <rect x="1" y="1" width="5" height="5" fill={C.gold} opacity="0.9" />
              <rect x="8" y="1" width="5" height="5" fill={C.gold} opacity="0.4" />
              <rect x="1" y="8" width="5" height="5" fill={C.gold} opacity="0.4" />
              <rect x="8" y="8" width="5" height="5" fill={C.gold} opacity="0.9" />
            </svg>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.text2, letterSpacing: "0.08em" }}>COLD EMAIL AGENT</span>
            <StorageTag usingSupabase={usingSupabase} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {history.length > 0 && (
              <button className="btn-text" onClick={() => { setView(view === "main" ? "history" : "main"); setHistDetail(null); setHistActive(0); }}>
                {view !== "main" ? "← BACK" : `HISTORY (${history.length})`}
              </button>
            )}
            {phase !== "key" && view === "main" && <button className="btn-text" onClick={changeKey}>CHANGE KEYS</button>}
          </div>
        </div>

        {storageError && (
          <div style={{ padding: "8px 20px", background: C.redDim, borderBottom: `0.5px solid rgba(224,112,112,0.2)`, fontFamily: "var(--font-mono)", fontSize: 10, color: C.red, letterSpacing: "0.03em" }}>
            STORAGE ERROR: {storageError}
          </div>
        )}

        <div style={{ padding: "30px 26px" }}>

          {/* ══ HISTORY ═══════════════════════════════════════════════════ */}
          {view === "history" && !histDetail && (
            <div className="fu">
              <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 400, color: C.text, margin: "0 0 6px" }}>Saved runs</h2>
              <p style={{ fontSize: 13, color: C.text2, margin: "0 0 22px", lineHeight: 1.6 }}>{history.length} {history.length === 1 ? "sequence" : "sequences"} — {usingSupabase ? "synced to Supabase" : "stored locally"}.</p>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", fontFamily: "var(--font-mono)", fontSize: 12, color: C.text3, letterSpacing: "0.04em" }}>NO RUNS YET</div>
              ) : (
                <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
                  {history.map((run, i) => (
                    <div key={run.id} className="hist-row" style={{ borderBottom: i < history.length - 1 ? `0.5px solid ${C.border}` : "none" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 3 }}>{run.prospect?.name || "Unknown"}</div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.text3, letterSpacing: "0.03em", marginBottom: 7 }}>{run.prospect?.company} · {run.prospect?.niche}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3 }}>{fmtDate(run.date)}</span>
                            {run.engine && <EngineTag engine={run.engine} />}
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3 }}>{1 + (run.followups?.length || 0)} emails</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                          <button className="btn-text-gold" onClick={() => { setHistDetail(run); setHistActive(0); }}>VIEW</button>
                          <button className="btn-text" onClick={() => deleteRun(run.id)}>DELETE</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ HISTORY DETAIL ═════════════════════════════════════════════ */}
          {view === "history" && histDetail && (
            <div className="fu">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, paddingBottom: 18, borderBottom: `0.5px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: C.text, marginBottom: 3 }}>{histDetail.prospect?.name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.text3, letterSpacing: "0.03em", marginBottom: 8 }}>{histDetail.prospect?.company} · {histDetail.prospect?.niche}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3 }}>{fmtDate(histDetail.date)}</span>
                    {histDetail.engine && <EngineTag engine={histDetail.engine} />}
                  </div>
                </div>
                <button className="btn-text" onClick={() => setHistDetail(null)}>← LIST</button>
              </div>
              <SequenceResult emailList={toEmailList(histDetail)} active={histActive} setActive={setHistActive} />
            </div>
          )}

          {/* ══ MAIN VIEW ═════════════════════════════════════════════════ */}
          {view === "main" && (
            <>
              {/* ── Key phase ── */}
              {phase === "key" && (
                <div className="fu">
                  <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 400, color: C.text, lineHeight: 1.25, margin: "0 0 8px" }}>Connect your keys.</h1>
                  <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.7, margin: "0 0 26px" }}>Anthropic key powers all email writing. Pick your research engine — Perplexity adds a second key.</p>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                      <span className="field-label" style={{ marginBottom: 0 }}>RESEARCH ENGINE</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: C.text3, letterSpacing: "0.04em" }}>EMAILS ALWAYS WRITTEN BY CLAUDE</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[{ id: "claude", label: "Claude", desc: "Web search · research only" }, { id: "perplexity", label: "Perplexity", desc: "deep research · research only" }].map(({ id, label, desc }) => (
                        <button key={id} className={`engine-opt ${researchEngine === id ? "active" : ""}`} onClick={() => setResearchEngine(id)}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                            <EngineTag engine={id} />
                            <span style={{ fontSize: 13, fontWeight: 500, color: researchEngine === id ? C.text : C.text2 }}>{label}</span>
                          </div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, letterSpacing: "0.03em" }}>{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                      <span className="field-label" style={{ marginBottom: 0 }}>ANTHROPIC API KEY</span>
                      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.gold, textDecoration: "none", letterSpacing: "0.04em" }}>GET KEY ↗</a>
                    </div>
                    <input className="inp" type="password" value={keyInputs.anthropic} onChange={e => { setKeyInputs(k => ({ ...k, anthropic: e.target.value })); setKeyError(""); }} onKeyDown={e => e.key === "Enter" && submitKeys()} placeholder="sk-ant-api03-···" />
                  </div>

                  {researchEngine === "perplexity" && (
                    <div style={{ marginBottom: 14 }} className="fu">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                        <span className="field-label" style={{ marginBottom: 0 }}>PERPLEXITY API KEY</span>
                        <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.gold, textDecoration: "none", letterSpacing: "0.04em" }}>GET KEY ↗</a>
                      </div>
                      <input className="inp" type="password" value={keyInputs.perplexity} onChange={e => { setKeyInputs(k => ({ ...k, perplexity: e.target.value })); setKeyError(""); }} placeholder="pplx-···" />
                    </div>
                  )}

                  {keyError && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.red, marginBottom: 12, letterSpacing: "0.02em" }}>{keyError}</div>}
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, letterSpacing: "0.04em", lineHeight: 1.7, marginBottom: 22 }}>
  KEYS ARE SESSION-ONLY — NEVER STORED
                  </div>
                  <button className="btn-gold" onClick={submitKeys} disabled={!keyInputs.anthropic.trim() || (researchEngine === "perplexity" && !keyInputs.perplexity.trim())}>Continue →</button>
                </div>
              )}

              {/* ── Input phase ── */}
              {phase === "input" && (
                <div className="fu">
                  <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 400, color: C.text, lineHeight: 1.25, margin: "0 0 8px" }}>Who are you reaching out to?</h1>
                  <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.7, margin: "0 0 24px" }}>Research via your chosen engine · all emails written by Claude · saved automatically.</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 10 }}>
                    {[{ f: "name", l: "PROSPECT NAME", p: "Meredith Johnson" }, { f: "company", l: "COMPANY", p: "Johnson IP Law" }, { f: "niche", l: "NICHE", p: "Patent attorneys" }, { f: "sender", l: "YOUR NAME", p: "Victor" }].map(({ f, l, p }) => (
                      <div key={f}><label className="field-label">{l}</label><input className="inp" value={form[f]} onChange={e => upd(f, e.target.value)} placeholder={p} /></div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 10 }}><label className="field-label">LINKEDIN URL <span style={{ color: C.text3 }}>· OPTIONAL</span></label><input className="inp" value={form.linkedin} onChange={e => upd("linkedin", e.target.value)} placeholder="https://linkedin.com/in/···" /></div>
                  <div style={{ marginBottom: 24 }}><label className="field-label">ADDITIONAL CONTEXT <span style={{ color: C.text3 }}>· OPTIONAL</span></label><textarea className="inp" value={form.notes} onChange={e => upd("notes", e.target.value)} placeholder="Any extra info about this prospect..." /></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button className="btn-gold" onClick={runAgent} disabled={!canRun}>Run agent →</button>
                    <EngineTag engine={researchEngine} />
                    <StorageTag usingSupabase={usingSupabase} />
                  </div>
                </div>
              )}

              {/* ── Agent running / complete / error ── */}
              {(isRunning || isComplete || isError) && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 26, paddingBottom: 18, borderBottom: `0.5px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: C.text, marginBottom: 2 }}>{form.name}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, letterSpacing: "0.05em" }}>{form.company} · {form.niche}</div>
                    </div>
                    <button className="btn-text" onClick={reset}>NEW PROSPECT</button>
                  </div>

                  <div style={{ marginBottom: 28 }}>
                    {steps.map((step, i) => {
                      const isLast = i === steps.length - 1;
                      const isExp  = expanded === step.id;
                      const hasMeta = step.status === "done" && step.output && (step.id === "research" || step.id === "angle");
                      let meta = "";
                      if (step.status === "done") {
                        if (step.id === "angle" && step.output?.best_angle?.angle_title) meta = step.output.best_angle.angle_title;
                        if (step.id === "email" && step.output?.subject_line) meta = `"${step.output.subject_line}"`;
                        if (step.id === "followups" && Array.isArray(step.output)) meta = `${step.output.length} emails`;
                        if (step.id === "research") meta = "complete";
                      }
                      return (
                        <div key={step.id} className="fu" style={{ display: "flex", gap: 15, opacity: step.status === "idle" ? 0.28 : 1, transition: "opacity 0.4s" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                            <StepNum index={i} status={step.status} />
                            {!isLast && <div style={{ width: 0.5, flexGrow: 1, minHeight: 18, background: C.border, margin: "5px 0" }} />}
                          </div>
                          <div style={{ flex: 1, paddingBottom: isLast ? 0 : 18 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{step.label}</span>
                              {meta && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.gold, letterSpacing: "0.02em" }}>{meta}</span>}
                              {hasMeta && <button className="btn-text" onClick={() => setExpanded(isExp ? null : step.id)} style={{ marginLeft: "auto" }}>{isExp ? "HIDE" : "VIEW"}</button>}
                            </div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: step.status === "running" ? C.gold : C.text3, letterSpacing: "0.04em" }}>
                              {step.status === "running" ? `${step.sub}···` : step.sub}
                            </div>
                            {isExp && step.id === "research" && (
                              <div className="fu" style={{ marginTop: 10, background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: "12px 14px", fontSize: 12, color: C.text2, lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{step.output}</div>
                            )}
                            {isExp && step.id === "angle" && step.output?.best_angle && (
                              <div className="fu" style={{ marginTop: 10, background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: "14px 16px" }}>
                                <div style={{ fontSize: 13, color: C.text, marginBottom: 6, lineHeight: 1.5 }}>{step.output.best_angle.angle_summary}</div>
                                <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.65, marginBottom: step.output.best_angle.subject_line_options?.length ? 12 : 0 }}>{step.output.angle_reasoning}</div>
                                {step.output.best_angle.subject_line_options?.length > 0 && (
                                  <div>
                                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.text3, letterSpacing: "0.06em", marginBottom: 6 }}>SUBJECT OPTIONS</div>
                                    {step.output.best_angle.subject_line_options.map((s, j) => <div key={j} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.text2, padding: "2px 0" }}>→ {typeof s === 'object' ? s.line : s}{typeof s === 'object' && s.type ? ` · ${s.type}` : ''}</div>)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {isError && (
                    <div className="fu" style={{ background: C.redDim, border: `0.5px solid rgba(224,112,112,0.3)`, borderRadius: 2, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: C.red }}>{error}</span>
                      <button className="btn-ghost" style={{ borderColor: "rgba(224,112,112,0.3)", color: C.red }} onClick={runAgent}>Retry</button>
                    </div>
                  )}

                  {isComplete && result && (
                    <SequenceResult emailList={toEmailList(result)} active={activeEmail} setActive={setActiveEmail} onRegenerate={runAgent} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
