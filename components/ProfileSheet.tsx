"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";

// Your GT3 profile — photo, name, title, bio. Team culture: a face + a line on who you are, feeding
// the org chart in Leadership. Avatar goes to the 'avatars' bucket under your own uid folder.
export default function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useApp();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [title, setTitle] = useState(profile?.title ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Notification management — reflect the real permission state; enabling re-subscribes push.
  const [notifState, setNotifState] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setNotifState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const enableNotifs = async () => {
    try {
      if (typeof Notification === "undefined") return;
      const p = await Notification.requestPermission();
      setNotifState(p);
      if (p === "granted") { subscribePush(user?.id ?? null, !!profile?.is_admin); toast("Order alerts are on"); }
    } catch { /* ignore */ }
  };

  const pickAvatar = async (file: File) => {
    if (!supabase || !user) return;
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/avatar.${ext || "jpg"}`;
    const up = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) { toast(`Upload failed — ${up.error.message}`, "error"); setBusy(false); return; }
    const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    setAvatar(url);
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    await refreshProfile();
    setBusy(false);
    toast("Photo updated");
  };

  const save = async () => {
    if (!supabase || !user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() || null, title: title.trim() || null, bio: bio.trim() || null }).eq("id", user.id);
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    await refreshProfile();
    toast("Profile saved"); onClose();
  };

  const initial = (name || profile?.display_name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>Your profile</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          <div className="prof-av-row">
            <div className="prof-av" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined} aria-hidden>{!avatar && initial}</div>
            <div className="prof-av-ctl">
              <button type="button" className="note-save" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Uploading…" : avatar ? "Change photo" : "Add photo"}</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAvatar(f); e.target.value = ""; }} />
              <div className="prof-av-hint">A clean headshot reads best.</div>
            </div>
          </div>
          <label className="prod-f" style={{ marginTop: 14 }}><span>Name</span><input className="note-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Title</span><input className="note-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lead Operator · Co-Founder" maxLength={60} /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Bio</span><textarea className="note-in" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line or two — what you bring to the bar." maxLength={600} /></label>
          {/* Notifications — order-ready alerts, managed right where the account lives. */}
          <div className="prof-notif">
            <div className="prof-notif-t">Order notifications</div>
            {notifState === "granted" ? (
              <div className="prof-notif-s on">✓ On — you&apos;ll get a ping when your order is ready. Turn off anytime in your phone&apos;s settings for this app.</div>
            ) : notifState === "denied" ? (
              <div className="prof-notif-s">Blocked in your phone&apos;s settings — enable notifications for this app to get &ldquo;order ready&rdquo; pings.</div>
            ) : (
              <button type="button" className="note-save" style={{ width: "100%" }} onClick={enableNotifs}>🔔 Turn on order-ready alerts</button>
            )}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
