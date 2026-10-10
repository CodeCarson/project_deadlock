import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

it("ships the credited, unchanged game artwork instead of LFS pointer files", () => {
  const folder = join(process.cwd(), "public/deadlock");
  const sources = JSON.parse(
    readFileSync(join(folder, "sources.json"), "utf8"),
  );
  for (const [name, source] of Object.entries(sources) as [
    string,
    { sha256: string; url: string },
  ][]) {
    const bytes = readFileSync(join(folder, name));
    expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
      source.sha256,
    );
    expect(bytes.toString().startsWith("version https://git-lfs")).toBe(false);
    expect(source.url).toMatch(
      /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//,
    );
    if (name.endsWith(".svg"))
      expect(bytes.toString()).not.toMatch(/<script|onload=|<foreignObject/i);
  }
  for (let tier = 0; tier <= 11; tier++)
    expect(sources[`rank-${tier}.webp`]).toBeDefined();
  expect(readFileSync(join(folder, "NOTICE.txt"), "utf8")).toContain(
    "Valve Corporation",
  );
});
