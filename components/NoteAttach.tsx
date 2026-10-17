"use client";

import { useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { authedFetch } from "@/lib/authedFetch";
import Icon from "@/components/Icon";
import Button from "./Button";
import { batchBySize, fitWithin } from "@/lib/uploadBatches";

// Multi-file, multi-format attach → transcribe. Photos of handwritten notes, PDFs, screenshots or
// .txt — read client-side, sent to the transcribe agent (Claude vision/document), and the combined
// transcript is handed back to the note composer. Plain-text files are read locally (no AI needed).
const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
const readText = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = rej; r.readAsText(f); });

// A PHOTO AT THE SIZE HANDWRITING NEEDS (R15 — the 10/10 audit, API F6). The platform refuses a request over 4.5 MB before
// the route runs, so one ordinary phone photo (3.4 MB, 4.5 as base64) failed the whole batch. A photo is drawn at its
// longest side PHOTO_MAX_SIDE as a JPEG (an iPhone's HEIC too, where the browser reads it); one the browser cannot draw
// goes as it is, and the server says if it cannot read it.
async function asSent(f: File): Promise<{ name: string; media_type: string; data: string }> {
  if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type)) {
    try {
      const bmp = await createImageBitmap(f);
      const { width, height } = fitWithin(bmp.width, bmp.height);
      const c = document.createElement("canvas");
      c.width = width; c.height = height;
      const g = c.getContext("2d");
      if (!g || !width) throw new Error("not drawable");
      g.drawImage(bmp, 0, 0, width, height);
      bmp.close();
      return { name: f.name, media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] || "" };
    } catch { /* sent as it is */ }
  }
  return { name: f.name, media_type: f.type || "application/octet-stream", data: await readB64(f) };
}

export default function NoteAttach({ onText, onFiles }: { onText: (t: string) => void; onFiles?: (files: File[]) => void }) {
  const { toast } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, 8);
    if (!files.length) return;
    if (files.some((f) => f.size > 25 * 1024 * 1024)) { toast("Each file must be under 25 MB", "error"); return; }
    // 0262 note continuation — the caller can KEEP the originals (private note-files bucket), not
    // just the transcription. Hand the File objects up before the transcribe round-trip.
    onFiles?.(files);
    setBusy(true); setCount(files.length);
    try {
      const parts: string[] = [];
      const media: { name: string; media_type: string; data: string }[] = [];
      for (const f of files) {
        if (f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt")) parts.push(`--- ${f.name} ---\n${(await readText(f)).slice(0, 20000)}`);
        else media.push(await asSent(f));
      }
      // As many requests as it takes, each under the platform's limit, in the order picked (lib/uploadBatches); a file
      // too large to send alone is said by name, and the rest are read.
      const { batches, tooBig } = batchBySize(media.map((m) => m.data.length));
      if (tooBig.length) toast(`${tooBig.map((i) => media[i].name).join(", ")} — too large to read here (a PDF under about 2.8 MB, or a photo)`, "error");
      for (const b of batches) {
        const r = await authedFetch("/api/agents/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: b.map((i) => media[i]) }) });
        const d = await r.json().catch(() => null);
        if (!d?.ok) { toast(d?.error || (r.status === 413 ? "Those were too large to send — try fewer at once" : "Couldn't transcribe those"), "error"); continue; }
        if (d.text) parts.push(d.text);
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
      <Button type="button" kind="secondary" compact className="self-start" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? `Transcribing ${count} file${count === 1 ? "" : "s"}…` : <><Icon name="link" /> Attach photos · PDFs · transcripts</>}
      </Button>
      <span className="natt-hint">Handwritten notes, PDFs & screenshots — read into the transcript.</span>
    </div>
  );
}
