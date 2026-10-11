import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Removed source modules must not survive in an incremental production build.
for (const folder of ["dist", "dist-electron"]) {
  rmSync(fileURLToPath(new URL(`../${folder}`, import.meta.url)), {
    recursive: true,
    force: true,
  });
}
