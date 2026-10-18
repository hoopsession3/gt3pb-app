"use client";

import { useRef, useState } from "react";
import { useAuth, roleOf } from "./AuthProvider";
import { useAppStable } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { uploadToBucket } from "@/lib/uploads";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { edited } from "@/lib/formGuard";
import { wrote } from "@/lib/wrote";

// Your GT3 profile — photo, name, title, bio. Team culture: a face + a line on who you are, feeding
// the org chart in Leadership. Avatar goes to the 'avatars' bucket under your own uid folder.
// A customer's is a photo and a name (2026-10-12, A2 of the account audit, #17): Title and Bio are the crew's, for the
// org chart, and were asked of every customer.
// THE ALERTS MOVED OUT (2026-10-14, R6): "Order notifications" sat at the foot of the profile, and Settings & privacy's
// Notifications opened the profile scrolled down to it. Notifications is a screen of its own now
// (components/NotificationsSheet: this phone, then a switch per kind), and the profile is a photo and a name.
export default function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const crew = roleOf(profile) !== "member";
  const { toast } = useAppStable();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [title, setTitle] = useState(profile?.title ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickAvatar = async (file: File) => {
    if (!supabase || !user) return;
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const up = await uploadToBucket({ bucket: "avatars", file, path: `${user.id}/avatar.${ext || "jpg"}`, upsert: true });
    if ("error" in up) { toast(`Upload failed — ${up.error}`, "error"); setBusy(false); return; }
    const url = `${up.url}?v=${Date.now()}`;
    // The photo is yours once the profile says so (R12b, F4): "Photo updated" was said over a refused update, and the
    // sheet showed a picture the account never kept.
    if (!wrote(await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id), toast, "Couldn't set the photo")) { setBusy(false); return; }
    setAvatar(url);
    await refreshProfile();
    setBusy(false);
    toast("Photo updated");
  };

  const save = async () => {
    if (!supabase || !user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update(crew
      ? { display_name: name.trim() || null, title: title.trim() || null, bio: bio.trim() || null }
      : { display_name: name.trim() || null }).eq("id", user.id);
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    await refreshProfile();
    toast("Profile saved"); onClose();
  };

  const initial = (name || profile?.display_name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <Sheet open onClose={onClose} label="Your profile" dirty={edited({ name, title, bio }, { name: profile?.display_name, title: profile?.title, bio: profile?.bio }, ["name", "title", "bio"])}
      header={<div style={{ display: "flex", alignItems: "center" }}><span className="isheet-title">Your profile</span><span style={{ marginLeft: "auto" }} /><CloseButton className="isheet-x" onClick={onClose} /></div>}>
          <div className="prof-av-row">
            <div className="prof-av" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined} aria-hidden>{!avatar && initial}</div>
            <div className="prof-av-ctl">
              <button type="button" className="btn-sec btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Uploading…" : avatar ? "Change photo" : "Add photo"}</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAvatar(f); e.target.value = ""; }} />
              <div className="prof-av-hint">A clean headshot reads best.</div>
            </div>
          </div>
          <label className="prod-f" style={{ marginTop: 14 }}><span>Name</span><input className="note-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={60} /></label>
          {crew && <label className="prod-f" style={{ marginTop: 8 }}><span>Title</span><input className="note-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lead Operator · Co-Founder" maxLength={60} /></label>}
          {crew && <label className="prod-f" style={{ marginTop: 8 }}><span>Bio</span><textarea className="note-in" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line or two — what you bring to the bar." maxLength={600} /></label>}
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <LeaveButton className="btn-ter" onClick={onClose}>Cancel</LeaveButton>
            <button type="button" className="btn-pri" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
          </div>
    </Sheet>
  );
}
