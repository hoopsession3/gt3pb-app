"use client";

// TWO-STEP FOR THE OWNERS AND ADMINS, THE APP'S HALF (R28, 2026-10-18 — the 10/10 audit, security F6; Ryan: "Yes,
// owner/admin"). The database holds every owner's and admin's power to the second step (0433: is_admin and is_owner ask
// two_step_ok — an authenticator's code given on this sign-in, or none set up and none required). This is how the app
// asks for it, with Supabase's own MFA (TOTP — on for this project: Authentication → Multi-Factor):
//
//   · setting one up — Settings & privacy › Two-step sign-in (components/TwoStepSetup): an authenticator app scans the
//     code (or takes the key, or the otpauth link on the iPhone), and its first code proves it;
//   · giving the code — opening the crew console as an owner or admin who has one, on a sign-in that hasn't given it
//     (components/TwoStepPrompt): once a sign-in, and the session keeps it;
//   · a business that requires it (0433 require_two_step) — an owner or admin without one is asked to set one up.
//
// The secret and the QR code are shown to the person setting it up and nowhere else: never logged, never sent anywhere.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { errorMessage } from "./errorMessage";
import { authedFetch } from "./authedFetch";
import { failureOr } from "./failureWords";

/** An authenticator's code: six digits (TOTP). */
export const TOTP_LEN = 6;
const ISSUER = "GT3 Performance Bar";

/** The second step, for the caller alone — 0433 two_step_state. */
export type TwoStepState = { leader: boolean; owner: boolean; enrolled: boolean; given: boolean; required: boolean; ok: boolean };

/** What the database says, or null when it can't (not asked yet: 0433 not pasted, offline). */
export async function twoStepState(sb: SupabaseClient): Promise<TwoStepState | null> {
  try {
    const { data, error } = await sb.rpc("two_step_state");
    if (error || !data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    return { leader: d.leader === true, owner: d.owner === true, enrolled: d.enrolled === true, given: d.given === true, required: d.required === true, ok: d.ok === true };
  } catch {
    return null;
  }
}

/** An authenticator's code, as typed or pasted: its digits. */
export const digitsOf = (v: string): string => v.replace(/\D/g, "").slice(0, TOTP_LEN);

/** Supabase's words for a refusal, in the app's. */
export function twoStepWords(message: string | undefined | null): string {
  const m = String(message ?? "");
  if (/invalid totp|invalid code|code.*(expired|invalid)/i.test(m)) return "That code didn't work — enter the one showing in your authenticator now.";
  if (/aal2|assurance level/i.test(m)) return "Give your current code first, then try again.";
  if (/fetch|network|offline/i.test(m)) return "You're offline. Connect, then try again.";
  if (/too many|rate limit/i.test(m)) return "Too many tries — wait a minute, then try again.";
  return "That didn't go through. Try again in a minute.";
}

/** The QR code as an image the page may draw: Supabase hands an SVG (as a data URL, or bare); either is drawn from its
 *  own encoded copy, so nothing in it can end the URL early. */
export function qrSrc(qr: string): string {
  let svg = qr.startsWith("data:") ? qr.slice(qr.indexOf(",") + 1) : qr;
  if (qr.startsWith("data:") && /%[0-9a-f]{2}/i.test(svg)) { try { svg = decodeURIComponent(svg); } catch { /* drawn as it came */ } }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The key, as an authenticator asks for it typed: groups of four. */
export const keyGroups = (secret: string): string => secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/** The person's verified authenticator, if they have one. */
async function verifiedTotp(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp?.[0]?.id ?? null;
}

/** The session gives its second step now (aal2), and Realtime hasn't heard: supabase-js hands Realtime a new token on a
 *  sign-in or a renewal, not on MFA's verify, and the database asks that token's aal of every change it sends a screen
 *  (0433 — is_admin() is two-step's), so an owner's live lists would wait for the next renewal, up to an hour. Handed the
 *  new token now; a failure leaves them to that renewal. */
function realtimeHearsIt(sb: SupabaseClient, token: unknown): void {
  if (typeof token !== "string" || !token) return;
  try { void Promise.resolve(sb.realtime?.setAuth(token)).catch(() => undefined); } catch { /* caught up at the renewal */ }
}

/** Give the code on this sign-in: the session comes back at aal2. */
export async function giveCode(sb: SupabaseClient, code: string): Promise<{ error?: string }> {
  try {
    const factorId = await verifiedTotp(sb);
    if (!factorId) return { error: "There's no authenticator on this account. Set one up in Settings & privacy." };
    const { data, error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: digitsOf(code) });
    if (error) return { error: twoStepWords(error.message) };
    realtimeHearsIt(sb, data?.access_token);
    return {};
  } catch (e) {
    return { error: twoStepWords(errorMessage(e)) };
  }
}

export type Enrolment = { factorId: string; qr: string; secret: string; uri: string };

/** Start setting one up: an earlier start never finished is let go first (it would only be in the way). */
export async function startSetup(sb: SupabaseClient): Promise<Enrolment | { error: string }> {
  try {
    const { data: list, error: listError } = await sb.auth.mfa.listFactors();
    if (listError) return { error: twoStepWords(listError.message) };
    for (const f of list?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
    }
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", issuer: ISSUER, friendlyName: `GT3 ${new Date().toISOString().slice(0, 16)}` });
    if (error || !data) return { error: twoStepWords(error?.message) };
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
  } catch (e) {
    return { error: twoStepWords(errorMessage(e)) };
  }
}

/** Its first code proves it: the authenticator is on, and this sign-in has given its code. */
export async function finishSetup(sb: SupabaseClient, factorId: string, code: string): Promise<{ error?: string }> {
  try {
    const { data, error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: digitsOf(code) });
    if (error) return { error: twoStepWords(error.message) };
    realtimeHearsIt(sb, data?.access_token);
    return {};
  } catch (e) {
    return { error: twoStepWords(errorMessage(e)) };
  }
}

/** Turn it off: every authenticator on the account let go (Supabase asks for this sign-in's code first). */
export async function turnOff(sb: SupabaseClient): Promise<{ error?: string }> {
  try {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) return { error: twoStepWords(error.message) };
    for (const f of data?.all ?? []) {
      if (f.factor_type !== "totp") continue;
      const r = await sb.auth.mfa.unenroll({ factorId: f.id });
      if (r.error) return { error: twoStepWords(r.error.message) };
    }
    await sb.auth.refreshSession().catch(() => undefined);
    return {};
  } catch (e) {
    return { error: twoStepWords(errorMessage(e)) };
  }
}

// ── RECOVERY CODES (R37, 2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes"; 0438) ──────────────────────
// Ten one-time codes made by the server on a sign-in that gave the authenticator's code, shown once (TwoStepSetup). Any
// one, on a sign-in proved in the last few minutes, takes a lost authenticator off the account (TwoStepPrompt) — and
// Supabase signs the person out everywhere as it does; they sign in again and set up a new one.

/** Ten new recovery codes; the ten before them stop working. */
export async function makeRecoveryCodes(): Promise<{ codes: string[] } | { error: string }> {
  try {
    const r = await authedFetch("/api/two-step/codes", { method: "POST" });
    const j = (await r.json().catch(() => null)) as { codes?: unknown; error?: unknown } | null;
    if (r.ok && Array.isArray(j?.codes)) return { codes: j.codes.map(String) };
    return { error: failureOr(typeof j?.error === "string" ? j.error : null, "We couldn't make recovery codes just now. Try again.") };
  } catch {
    return { error: "You're offline. Connect, then try again." };
  }
}

/** How many of this person's recovery codes are unused, or null when the server couldn't say. */
export async function recoveryCodesLeft(): Promise<number | null> {
  try {
    const r = await authedFetch("/api/two-step/codes");
    const j = (await r.json().catch(() => null)) as { left?: unknown } | null;
    return r.ok && typeof j?.left === "number" ? j.left : null;
  } catch {
    return null;
  }
}

/** Use a recovery code: the lost authenticator comes off the account. `prove`: the sign-in is older than a few minutes —
 *  they sign in again first. */
export async function recoverWithCode(code: string): Promise<{ left?: number; error?: string; prove?: boolean }> {
  try {
    const r = await authedFetch("/api/two-step/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = (await r.json().catch(() => null)) as { left?: unknown; error?: unknown; prove?: unknown } | null;
    if (r.ok) return { left: typeof j?.left === "number" ? j.left : undefined };
    return { error: failureOr(typeof j?.error === "string" ? j.error : null, "That didn't go through. Try again in a minute."), prove: j?.prove === true };
  } catch {
    return { error: "You're offline. Connect, then try again." };
  }
}

/** Require it of every owner and admin of the business, or stop (0433: an owner, on a sign-in with the code). */
export async function setRequired(sb: SupabaseClient, on: boolean): Promise<{ error?: string }> {
  const { error } = await sb.rpc("require_two_step", { p_on: on });
  return error ? { error: /only an owner/i.test(error.message) ? "Only an owner, signed in with their authenticator's code, can change this." : twoStepWords(error.message) } : {};
}

/** What the crew console asks of an owner or admin as it opens (0433):
 *    "checking" — not known yet; "code" — they have an authenticator and this sign-in hasn't given its code;
 *    "setup" — their business requires one and they have none; "none" — nothing to ask.
 *  `later` lets them use the crew's tools without it for now (their owner and admin powers wait for it). */
export type TwoStepNeed = "checking" | "code" | "setup" | "none";
type Seen = { uid: string; need: Exclude<TwoStepNeed, "checking"> };

/** What is owed, from the session's levels (Supabase's getAuthenticatorAssuranceLevel: an authenticator set up makes the
 *  next level aal2) and, when none is set up, the database's word (null: not asked, or couldn't be — "no"). Pure. */
export function needFrom(aal: { currentLevel?: string | null; nextLevel?: string | null } | null, state: TwoStepState | null): Exclude<TwoStepNeed, "checking"> {
  if (aal?.nextLevel === "aal2") return aal.currentLevel === "aal2" ? "none" : "code";
  // Set up on another device, and this session hasn't heard yet (its user is from before): the database knows.
  if (state?.leader && state.enrolled && !state.given) return "code";
  return state?.leader && state.required && !state.enrolled ? "setup" : "none";
}

/** `hold` is the provider's "Not now" (components/AuthProvider waitingForCode): held there, not here, so every screen —
 *  the bar, ⌘K, the sheets — draws the crew's tools while the code waits, not only this one. */
export function useTwoStep(leader: boolean, uid: string | null, hold: { waiting: boolean; wait: (on: boolean) => void }): { need: TwoStepNeed; done: () => void; later: () => void; ask: () => void; deferred: boolean } {
  const [seen, setSeen] = useState<Seen | null>(null);
  useEffect(() => {
    if (!leader || !uid || !supabase) return;
    const sb = supabase;
    let live = true;
    (async () => {
      // The session says it at once (no network): an authenticator set up (nextLevel aal2), and given or not.
      const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!live) return;
      if (data?.nextLevel === "aal2") { setSeen({ uid, need: needFrom(data, null) }); return; }
      // None it knows of: the console opens at once, and the database's word follows — one set up on another device, or
      // a business that requires one — and asks then, if it must.
      setSeen({ uid, need: "none" });
      const need = needFrom(data, await twoStepState(sb));
      if (live && need !== "none") setSeen({ uid, need });
    })().catch(() => { if (live) setSeen({ uid, need: "none" }); });
    return () => { live = false; };
  }, [leader, uid]);
  const need: TwoStepNeed = !leader || !uid ? "none" : seen?.uid !== uid ? "checking" : hold.waiting ? "none" : seen.need;
  return {
    need,
    deferred: !!uid && hold.waiting && !!seen && seen.uid === uid && seen.need !== "none",
    done: () => { if (uid) { setSeen({ uid, need: "none" }); hold.wait(false); } },
    later: () => hold.wait(true),
    ask: () => hold.wait(false),
  };
}
