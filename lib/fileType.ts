// WHAT KIND OF FILE THIS IS (R18 review, 2026-10-17). A phone or a computer names a file's type when it hands it over,
// and not always: a Markdown note or a .mov from some phones comes with none, Excel on Windows calls a .csv an Excel
// sheet, and a type can carry parameters ("video/mp4;codecs=avc1"). Storage judges the type it is sent — supabase-js
// sends the file's own — so a file with no type arrived as "some bytes" and a bucket that takes pictures and PDFs refused
// it in its own words. The type is read here once, by what was said and then by the name, for every upload (lib/uploads,
// lib/receipts) and the shop's picker (components/MediaStudio, for lib/shopMedia). Pure; no imports.

const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif",
  heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", markdown: "text/markdown",
};
// What a type is called by something other than its own name — only where the name agrees (a real Excel sheet stays one).
const ALSO_CALLED: Readonly<Record<string, readonly string[]>> = {
  csv: ["application/vnd.ms-excel", "application/csv", "text/x-csv", "text/comma-separated-values"],
  md: ["text/x-markdown"], markdown: ["text/x-markdown"],
  mov: ["video/mov"], m4v: ["video/x-m4v"], jpg: ["image/jpg", "image/pjpeg"], jpeg: ["image/jpg", "image/pjpeg"],
};

/** The file's type: what it was handed over as (without parameters) — or, when that was nothing, "some bytes", or another
 *  name for what its extension says, the extension's type. "" when neither says. Pure. */
export function fileType(file: { type?: string | null; name?: string | null }): string {
  const said = String(file.type ?? "").split(";")[0].trim().toLowerCase();
  const name = String(file.name ?? "");
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const byName = BY_EXTENSION[ext];
  if (byName && (!said || said === "application/octet-stream" || (ALSO_CALLED[ext] ?? []).includes(said))) return byName;
  return said === "application/octet-stream" ? "" : said;
}
