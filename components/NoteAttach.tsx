"use client";

import { useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { authedFetch } from "@/lib/authedFetch";
import Icon from "@/components/Icon";

// Multi-file, multi-format attach → transcribe. Photos of handwritten notes, PDFs, screenshots or
// .txt — read client-side, sent to the transcribe agent (Claude vision/document), and the combined
// transcript is handed back to the note composer. Plain-text files are read locally (no AI needed).
const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
const readText = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = rej; r.readAsText(f); });

export default function NoteAttach({ onText }: { onText: (t: string) => void }) {
  const { toast } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, 8);
    if (!files.length) return;
    if (files.some((f) => f.size > 12 * 1024 * 1024)) { toast("Each file must be under 12 MB", "error"); return; }
    setBusy(true); setCount(files.length);
    try {
      const parts: string[] = [];
      const media: { name: string; media_type: string; data: string }[] = [];
      for (const f of files) {
        if (f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt")) parts.push(`--- ${f.name} ---\n${(await readText(f)).slice(0, 20000)}`);
        else media.push({ name: f.name, media_type: f.type || "application/octet-stream", data: await readB64(f) });
      }
      if (media.length) {
        const r = await authedFetch("/api/agents/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: media }) });
        const d = await r.json();
        if (!d?.ok) toast(d?.error || "Couldn't transcribe those", "error");
        else if (d.text) parts.push(d.text);
      }
      const combined = parts.join("\n\n").trim();
      if (combined) { onText(combined); toast(`Transcribed ${files.length} file${files.length === 1 ? "" : "s"} → transcript`); }
    } catch { toast("Transcription failed — try again", "error"); }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  };

  return (
    <div className="natt">
      <input ref={ref} type="file" multiple accept="image/*,application/pdf,text/plain" hidden onChange={(e) => pick(e.target.files)} />
      <button type="button" className="natt-btn" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? `Transcribing ${count} file${count === 1 ? "" : "s"}…` : <><Icon name="link" /> Attach photos · PDFs · transcripts</>}
      </button>
      <span className="natt-hint">Handwritten notes, PDFs & screenshots — read into the transcript.</span>
    </div>
  );
}
