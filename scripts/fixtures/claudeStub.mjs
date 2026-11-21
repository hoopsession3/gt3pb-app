// A STAND-IN FOR THE MODEL, for local journeys only (0476). Loaded into the app server with `node --import`, it answers
// calls to the Messages API without the network or a key: the reply quotes the recipe the route put in its own system
// prompt — the version line and the amounts — so a journey can see WHICH version Ask GT3 answered from. It never runs in
// the app; nothing imports it. Every other request goes out as before.
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (!url.startsWith("https://api.anthropic.com/")) return real(input, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text ?? "").join("\n");
  const ask = String([...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "").toLowerCase();
  const sections = system.split(/\n## /).slice(1).map((s) => ({ name: s.split(/[\n(]/)[0].trim(), text: s }));
  const hit = sections.find((s) => ask.includes(s.name.toLowerCase())) ?? sections.find((s) => (s.text.match(/ALSO CALLED: ([^\n|]+)/)?.[1] ?? "").toLowerCase().split(/,\s*/).some((a) => a && ask.includes(a)));
  const line = (re) => hit?.text.match(re)?.[1]?.trim();
  // The build step as the route wrote it (the method, " → " between steps): the one that starts "Single mix:".
  const build = (hit?.text.match(/brew: ([^|]+)/)?.[1] ?? "").split(" → ").find((x) => /^Single mix:/.test(x.trim()))?.trim();
  const text = hit
    ? `${hit.name} — ${line(/RECIPE VERSION: ([^\n|]+)/) ?? "no version line"}.\nAmounts (single / large): ${line(/AMOUNTS \(single mix \/ large batch\): ([^|\n]+)/) ?? line(/AMOUNTS: ([^|\n]+)/) ?? "none listed"}.\nBuild: ${build ?? "no build step"}`
    : "I don't have a recipe for that on file.";
  return new Response(JSON.stringify({ id: "stub", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
};
