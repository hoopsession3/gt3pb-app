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
  // What the bucket takes, said before the file goes up — not storage's words after (lib/bucketTakes, R18). Its table is
  // fetched as a file is sent, not carried by every page that could send one (/3mpire's script: +792 bytes → +383).
  const { bucketRefusal, fileType } = await import("./bucketTakes");
  const refused = bucketRefusal(opts.bucket, opts.file);
  if (refused) return { error: refused };
  const name = opts.file instanceof File ? opts.file.name : "blob.png";
  // Sent as what it is (lib/fileType, R18 review): supabase-js sends a file's own type, so one handed over with none — a
  // Markdown note, a .mov — or misnamed (Excel's name for a .csv) is sent again under its real one.
  const type = fileType({ type: opts.file.type, name });
  const body = type && type !== opts.file.type && typeof File !== "undefined" ? new File([opts.file], name, { type }) : opts.file;
  const path = opts.path ?? `${(opts.prefix ?? "misc").replace(/\/+$/, "")}/${Date.now()}-${rand()}.${cleanExt(name)}`;
  const { error } = await supabase.storage.from(opts.bucket).upload(path, body, {
    upsert: opts.upsert ?? false,
    cacheControl: String(opts.cacheSeconds ?? 3600),
  });
  if (error) return { error: error.message };
  const url = supabase.storage.from(opts.bucket).getPublicUrl(path).data.publicUrl;
  return { url, path };
}
