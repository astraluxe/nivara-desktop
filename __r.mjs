// __r.ts
function rehydrate(content) {
  try {
    const parsed = JSON.parse(content);
    const saved = Array.isArray(parsed) ? parsed : parsed?.voices ?? [];
    const question = Array.isArray(parsed) ? "" : parsed?.question ?? "";
    if (!saved.length) return null;
    return { role: "council", content: question, council: saved.map((v, i) => ({ key: v.key || `saved-${i}`, name: v.name, human: v.human || v.name.replace(/^The\s+/i, "").slice(0, 2), text: v.text })) };
  } catch {
    return null;
  }
}
var fails = 0;
var ok = (n, c, x) => {
  if (c) console.log("  PASS  " + n);
  else {
    fails++;
    console.log("  FAIL  " + n, JSON.stringify(x));
  }
};
console.log("\n=== a saved council reopens ===\n");
var current = JSON.stringify({ question: "Is this the right plan?", voices: [
  { key: "council_contrarian", name: "The Contrarian", human: "Vikram", text: "### Risk\n**Pricing** is missing." },
  { key: "council_executor", name: "The Executor", human: "Dev", text: "Day 3: score the list." }
] });
var a = rehydrate(current);
ok("current shape reopens", !!a && a.council.length === 2);
ok("question is restored to the header", a.content === "Is this the right plan?");
ok("keys survive", a.council[1].key === "council_executor");
ok("handles survive", a.council[0].human === "Vikram");
ok("markdown is kept intact for the renderer", a.council[0].text.includes("###") && a.council[0].text.includes("**"));
console.log("\n=== a council saved by the FIRST build still reopens ===\n");
var legacy = JSON.stringify([{ name: "The Contrarian", text: "x" }, { name: "The Executor", text: "Day 3: do it." }]);
var b = rehydrate(legacy);
ok("legacy array shape reopens", !!b && b.council.length === 2);
ok("placeholder key assigned", b.council[0].key === "saved-0");
ok("avatar initials derived from the name", b.council[0].human === "Co", b.council[0].human);
ok("Executor still found BY NAME", !!b.council.find((v) => v.key === "council_executor" || /executor/i.test(v.name)));
console.log("\n=== bad rows are dropped, not shown raw ===\n");
ok("malformed json drops", rehydrate("not json") === null);
ok("empty voices drops", rehydrate(JSON.stringify({ question: "q", voices: [] })) === null);
ok("empty array drops", rehydrate("[]") === null);
console.log(fails ? "\n" + fails + " FAILURE(S)\n" : "\nALL GOOD\n");
process.exit(fails ? 1 : 0);
