"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToBucket } from "@/lib/uploads";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// TRAIN THE AI (Team → Train the AI, owner/admin) — the correction loop for the freeform agents.
// The owner writes the truth once (with an optional photo of the recipe card / receipt as proof),
// it's injected as an AUTHORITATIVE override into that agent's prompt (lib/agentKnowledge), and
// the agent obeys it forever. Every agent answer is logged below, so a wrong one — like the Brew
// AI's phantom "200 g cacao" — becomes a one-tap correction. Grounding, not fine-tuning.

const AGENTS = [
  { key: "all", label: "All agents" },
  { key: "operator", label: "Operator" },
  { key: "brew", label: "Brew" },
  { key: "concierge", label: "Concierge" },
] as const;
const AGENT_LABEL: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.key, a.label]));

type Know = { id: string; agent: string; title: string; body: string; media_url: string | null; active: boolean; author_name: string | null; created_at: string };
type Convo = { id: string; agent: string; question: string | null; answer: string | null; created_at: string };

export default function AiTraining() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [agent, setAgent] = useState<string>("all");
  const [rows, setRows] = useState<Know[]>([]);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [openConvo, setOpenConvo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [k, c] = await Promise.all([
      supabase.from("agent_knowledge").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("agent_convos").select("id, agent, question, answer, created_at").order("created_at", { ascending: false }).limit(40),
    ]);
    setRows((k.data as Know[]) ?? []);
    setConvos((c.data as Convo[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const uploadMedia = async (file: File) => {
    if (!supabase) return;
    setUpBusy(true);
    const res = await uploadToBucket({ bucket: "training", file, prefix: user?.id ?? "x", upsert: true });
    if ("error" in res) {
      toast(res.error.includes("Bucket not found") ? "Run migration 0143 first (training bucket)." : "Upload failed", "error");
    } else {
      setMedia(res.url);
      toast("Proof attached");
    }
    setUpBusy(false);
  };

  const save = async () => {
    if (!supabase || busy) return;
    if (!title.trim() || !body.trim()) { toast("A correction needs a title and the correct fact", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("agent_knowledge").insert({
      agent, title: title.trim(), body: body.trim(), media_url: media,
      created_by: user?.id ?? null, author_name: profile?.display_name?.trim() || null,
    });
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setTitle(""); setBody(""); setMedia(null);
    if (fileRef.current) fileRef.current.value = "";
    toast("Taught — the agent will use this from now on");
    load();
  };

  const toggle = async (k: Know) => {
    if (!supabase) return;
    setRows((r) => r.map((x) => (x.id === k.id ? { ...x, active: !x.active } : x)));
    await supabase.from("agent_knowledge").update({ active: !k.active }).eq("id", k.id);
  };
  const del = async (k: Know) => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete "${k.title}"? The agent will stop using it.`)) return;
    setRows((r) => r.filter((x) => x.id !== k.id));
    await supabase.from("agent_knowledge").delete().eq("id", k.id);
  };

  // Turn a logged answer into a correction — prefill the form with the question, scroll to it.
  const correctFrom = (c: Convo) => {
    setAgent(c.agent);
    setTitle(c.question ? c.question.slice(0, 70) : "Correction");
    setBody("");
    try { formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* */ }
  };

  const shown = rows.filter((r) => agent === "all" ? true : r.agent === agent || r.agent === "all");

  return (
    <div className="adm-sec" id="ai-training">
      <div className="sec">Train the AI {shown.length > 0 && <span className="adm-pill">{shown.filter((r) => r.active).length} live</span>}</div>
      <p className="h-sub" style={{ marginBottom: 12 }}>
        Correct a wrong answer once and it sticks. What you write here overrides the agent&rsquo;s built-in knowledge — it can&rsquo;t contradict you.
      </p>

      <div className="ai-agents">
        {AGENTS.map((a) => (
          <button key={a.key} type="button" className={`oa-day ai-agent${agent === a.key ? " sel" : ""}`} onClick={() => setAgent(a.key)}>
            <b>{a.label}</b>
          </button>
        ))}
      </div>

      <div className="goal-new" ref={formRef}>
        <input className="auth-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What&rsquo;s it about? — e.g. Flow cold-brew cacao per gallon" maxLength={90} />
        <textarea className="auth-input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The correct answer, in your words — e.g. Flow is 68 g cacao per gallon of water, so 170 g at 2.5 gal. Not 200." maxLength={1200} />
        <div className="ai-up">
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); }} />
          <button type="button" className="st-discuss" onClick={() => fileRef.current?.click()} disabled={upBusy}>{upBusy ? "Uploading…" : media ? "✓ Proof attached — replace" : "📎 Attach proof (recipe / receipt photo)"}</button>
          {media && <a className="st-discuss" href={media} target="_blank" rel="noreferrer">View ↗</a>}
        </div>
        <div className="st-log-btns">
          <button type="button" className="dops-mini" onClick={save} disabled={busy}>{busy ? "Saving…" : `Teach ${AGENT_LABEL[agent]}`}</button>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="ai-list">
          {shown.map((k) => (
            <div className={`ai-know${k.active ? "" : " off"}`} key={k.id}>
              <div className="ai-know-top">
                <span className="ai-know-t">{k.title}</span>
                <span className="ai-know-agent">{AGENT_LABEL[k.agent] ?? k.agent}</span>
              </div>
              <p className="ai-know-b">{k.body}</p>
              {k.media_url && <a className="ai-know-media" href={k.media_url} target="_blank" rel="noreferrer">📎 proof ↗</a>}
              <div className="ai-know-act">
                <button type="button" className="st-discuss" onClick={() => toggle(k)}>{k.active ? "Turn off" : "Turn on"}</button>
                <button type="button" className="st-discuss danger" onClick={() => del(k)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {convos.length > 0 && (
        <div className="ai-convos">
          <div className="dops-up-h">Recent answers · tap a wrong one to correct it</div>
          {convos.map((c) => (
            <div className="ai-convo" key={c.id}>
              <button type="button" className="ai-convo-q" onClick={() => setOpenConvo(openConvo === c.id ? null : c.id)}>
                <span><b>{AGENT_LABEL[c.agent] ?? c.agent}</b> · {c.question || "—"}</span>
                <span>{openConvo === c.id ? "▾" : "▸"}</span>
              </button>
              {openConvo === c.id && (
                <div className="ai-convo-a">
                  <p>{c.answer}</p>
                  <button type="button" className="st-discuss danger" onClick={() => correctFrom(c)}>✕ This was wrong — correct it</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
