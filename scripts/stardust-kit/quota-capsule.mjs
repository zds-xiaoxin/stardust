import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const components = "apps/web/src/components/usage/";
const destination = "stardust-kit/quota-capsule/";
const files = [
  components + "QuotaTopbar.tsx",
  components + "quotaTopbar.module.css",
  components + "quotaTopbarModel.ts",
  components + "usageQuotaPresentation.ts",
  "packages/shared/src/quotaFreshness.ts",
];
const [mode] = process.argv.slice(2);
if (process.argv.length !== 3 || !["--check", "--sync"].includes(mode)) {
  throw new Error("Expected --check or --sync");
}

for (const source of files) {
  const name = source.split("/").at(-1);
  const output = new URL(destination + name, root);
  let expected = await readFile(new URL(source, root), "utf8");
  if (name === "usageQuotaPresentation.ts") {
    // A workshop installation may target a host with the old four-argument function.
    const from = 'export { quotaReadingStale } from "@t3tools/shared/usageLimits";';
    if (expected.split(from).length !== 2) throw new Error("Review the workshop freshness export");
    expected = expected.replace(from, 'export { quotaReadingStale } from "./quotaFreshness";');
  }
  const actual = await readFile(output, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (actual === expected) continue;
  if (mode === "--sync") {
    await writeFile(output, expected);
  } else {
    console.error(`Out of sync: ${destination}${name} (source: ${source})`);
    process.exitCode = 1;
  }
}
