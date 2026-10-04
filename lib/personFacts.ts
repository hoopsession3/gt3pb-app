import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { fullestName } from "./customerKnown";

// WHAT IS ON FILE FOR THE PERSON A FORM IS ABOUT (2026-10-04, the form audit).
//
// The crew roster (components/useCrew) carries a name, a role and a city. An offer letter or an
// operator agreement also needs the person's email and the name they gave in full — "Niño" on the
// roster is "Niño Ramírez" on a contract. Both are on their customer record: every account has one
// (handle_new_user, 0246/0280), keyed one-to-one by user_id (0151), and staff can read it (0151).
//
// Read once per person, on demand, when they are picked — never the whole table. A read that fails
// is not remembered as "no email": nothing is filled, the field stays theirs to type, and the next
// pick asks again.

export type PersonFacts = { email: string | null; name: string | null };
const NONE: PersonFacts = { email: null, name: null };
const cache = new Map<string, Promise<PersonFacts>>();
const settled = new Map<string, PersonFacts>();

export function readPersonFacts(userId: string): Promise<PersonFacts> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const p = (async (): Promise<PersonFacts> => {
    if (!supabase) return NONE;
    const { data, error } = await supabase.from("customers").select("email, name").eq("user_id", userId).maybeSingle();
    if (error) { cache.delete(userId); return NONE; }
    const row = data as { email?: string | null; name?: string | null } | null;
    const f = { email: row?.email ?? null, name: row?.name ?? null };
    settled.set(userId, f);
    return f;
  })();
  cache.set(userId, p);
  return p;
}

/**
 * A person as the roster has them, with what is on file merged in once it has been read: the fuller
 * name (lib/customerKnown fullestName), and their email. Before the read lands, the roster as is —
 * which is also what a pick that changes away from them compares against, so the fields that
 * followed them follow the next pick too (lib/pickFill).
 */
export function withFacts<T extends { id: string; name: string; email: string | null }>(p: T): T;
export function withFacts<T extends { id: string; name: string; email: string | null }>(p: T | null): T | null;
export function withFacts<T extends { id: string; name: string; email: string | null }>(p: T | null): T | null {
  const f = p ? settled.get(p.id) : undefined;
  return p && f ? { ...p, name: fullestName(f.name, p.name), email: f.email ?? p.email } : p;
}

/**
 * When `id` is set, read what is on file for them (once per person — readPersonFacts caches) and
 * hand it to `apply`, which decides what it fills. `apply` is read from a ref, so a new function
 * each render does not read again; a pick that changes before the read lands is not applied.
 */
export function usePersonFacts(id: string | null | undefined, apply: (id: string, f: PersonFacts) => void): void {
  const ref = useRef(apply);
  useEffect(() => { ref.current = apply; });
  useEffect(() => {
    if (!id) return;
    let live = true;
    void readPersonFacts(id).then((f) => { if (live) ref.current(id, f); });
    return () => { live = false; };
  }, [id]);
}
