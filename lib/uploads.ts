import { supabase } from "./supabase";

// THE storage upload. Seven components hand-rolled supabase.storage upload+getPublicUrl with three
// different extension sanitizers (one had none — raw user filenames straight into a path), split
// upsert conventions, and four error-reporting styles. One implementation, one sanitizer.

const cleanExt = (name: string, fallback = "bin") =>
  ((name.split(".").pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, "") || fallback).slice(0, 8);

const rand = () => Math.random().toString(36).slice(2, 8);

export async function uploadToBucket(opts: {
  bucket: string;
  file: File | Blob;
  // Path strategy: exact `path` wins; otherwise `{prefix}/{ts-rand}.{ext}`.
  path?: string;
  prefix?: string;
  upsert?: boolean;
  cacheSeconds?: number;
}): Promise<{ url: string; path: string } | { error: string }> {
  if (!supabase) return { error: "Storage isn't configured." };
  const name = opts.file instanceof File ? opts.file.name : "blob.png";
  const path = opts.path ?? `${(opts.prefix ?? "misc").replace(/\/+$/, "")}/${Date.now()}-${rand()}.${cleanExt(name)}`;
  const { error } = await supabase.storage.from(opts.bucket).upload(path, opts.file, {
    upsert: opts.upsert ?? false,
    cacheControl: String(opts.cacheSeconds ?? 3600),
  });
  if (error) return { error: error.message };
  const url = supabase.storage.from(opts.bucket).getPublicUrl(path).data.publicUrl;
  return { url, path };
}
