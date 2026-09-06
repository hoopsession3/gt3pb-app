"use client";

import { useCallback, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { uploadToBucket } from "@/lib/uploads";
import { useAuth, roleOf } from "@/components/AuthProvider";
import {
  ACCEPT, BUCKET, MAX_ITEMS, makeCover, move, prettyBytes, removeAt, setAlt,
  slotsLeft, thumbOf, validateFile, type MediaItem,
} from "@/lib/shopMedia";

// MEDIA STUDIO (0278) — the owner's side of shop media: pick real photos and clips, put them in the
// order a shopper should see them, say which one leads, describe them.
//
// Owner-only, and it says so rather than hiding: a manager who can edit the product but not its
// photos should be told why, not left wondering where the button went. The storage policy enforces
// this server-side regardless (0278) — this is the honest front of the same rule, not the rule.
//
// Uploads run one file at a time on purpose. A phone on a truck lot uploading six clips in parallel
// is how you get four silent failures and a spinner; sequential means each file either lands or
// names itself in the error.

type Props = { productId: string; value: MediaItem[]; onChange: (next: MediaItem[]) => void };

export default function MediaStudio({ productId, value, onChange }: Props) {
  const { profile } = useAuth();
  const isOwner = roleOf(profile) === "owner";
  const [busy, setBusy] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const room = slotsLeft(value);

  const pick = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    const chosen = Array.from(files);
    const problems: string[] = [];
    const queue: { file: File; kind: "image" | "video" }[] = [];

    for (const file of chosen) {
      if (queue.length >= room) { problems.push(`${file.name} — a product holds ${MAX_ITEMS} items.`); continue; }
      const v = validateFile(file);
      if (!v.ok) { problems.push(v.reason); continue; }
      queue.push({ file, kind: v.kind });
    }
    setErrs(problems);
    if (!queue.length) return;

    setTotal(queue.length); setDone(0);
    const added: MediaItem[] = [];
    for (const { file, kind } of queue) {
      setBusy(file.name);
      const res = await uploadToBucket({ bucket: BUCKET, file, prefix: `p/${productId}`, cacheSeconds: 31536000 });
      if ("error" in res) problems.push(`${file.name} — ${res.error}`);
      else added.push({ id: res.path, url: res.url, kind });
      setDone((n) => n + 1);
    }
    setBusy(null); setTotal(0); setDone(0);
    setErrs(problems);
    if (added.length) onChange([...value, ...added]);
    if (fileRef.current) fileRef.current.value = "";
  }, [productId, room, value, onChange]);

  if (!isOwner) {
    return (
      <div className="ms">
        <div className="insp-lbl">Photos &amp; video</div>
        <p className="ms-locked"><Icon name="lock" /> Storefront photos and video are owner-only. Everything else on this product is yours to edit.</p>
        {value.length > 0 && (
          <div className="ms-grid" aria-label="Current media">
            {value.map((m) => {
              const t = thumbOf(m);
              return (
                <div key={m.id} className="ms-item">
                  <div className="ms-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t ? <img src={t} alt={m.alt || ""} /> : <span className="ms-ph"><Icon name="package" /></span>}
                    {m.kind === "video" && <span className="ms-badge">Video</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ms">
      <div className="insp-lbl">Photos &amp; video — the first one leads, drag order with the arrows</div>

      {value.length > 0 && (
        <div className="ms-grid">
          {value.map((m, idx) => {
            const t = thumbOf(m);
            return (
              <div key={m.id} className={`ms-item${idx === 0 ? " cover" : ""}`}>
                <div className="ms-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t ? <img src={t} alt="" /> : <span className="ms-ph"><Icon name="package" /></span>}
                  {m.kind === "video" && <span className="ms-badge">Video</span>}
                  {idx === 0 && <span className="ms-badge cover">Cover</span>}
                </div>
                <div className="ms-row">
                  <button type="button" className="ms-b" onClick={() => onChange(move(value, idx, idx - 1))} disabled={idx === 0} aria-label="Move earlier">↑</button>
                  <button type="button" className="ms-b" onClick={() => onChange(move(value, idx, idx + 1))} disabled={idx === value.length - 1} aria-label="Move later">↓</button>
                  <button type="button" className="ms-b" onClick={() => onChange(makeCover(value, m.id))} disabled={idx === 0} aria-label="Make this the cover">Cover</button>
                  <button type="button" className="ms-b del" onClick={() => onChange(removeAt(value, m.id))} aria-label="Remove">
                    <Icon name="close" />
                  </button>
                </div>
                <input className="ms-alt" value={m.alt ?? ""} placeholder="Describe it (alt text)"
                  onChange={(e) => onChange(setAlt(value, m.id, e.target.value))} />
              </div>
            );
          })}
        </div>
      )}

      <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
        onChange={(e) => { void pick(e.target.files); }} />

      <div className="ms-actions">
        <button type="button" className="btn-sec" onClick={() => fileRef.current?.click()} disabled={!!busy || room === 0}>
          <Icon name="plus" /> {value.length ? "Add more" : "Upload photos or video"}
        </button>
        <span className="ms-room">
          {room === 0 ? `Full — ${MAX_ITEMS} items` : `${room} slot${room === 1 ? "" : "s"} left`}
          {" · "}photos to {prettyBytes(12 * 1024 * 1024)}, video to {prettyBytes(100 * 1024 * 1024)}
        </span>
      </div>

      {busy && (
        <p className="ms-busy" aria-live="polite">
          Uploading {busy}{total > 1 ? ` — ${done + 1} of ${total}` : ""}…
        </p>
      )}
      {errs.length > 0 && (
        <ul className="ms-errs">{errs.map((e, n) => <li key={n}>{e}</li>)}</ul>
      )}
    </div>
  );
}
