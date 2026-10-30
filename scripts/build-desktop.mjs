import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
if (!existsSync(nextCli)) {
  throw new Error("Dependências do projeto não instaladas. Execute `npm install` nesta pasta e depois tente novamente.");
}

const result = spawnSync(process.execPath, [nextCli, "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_OUTPUT_STANDALONE: "1" },
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
