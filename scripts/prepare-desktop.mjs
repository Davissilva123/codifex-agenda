import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneDirectory = path.join(projectRoot, ".next", "standalone");
const staticDirectory = path.join(projectRoot, ".next", "static");
const publicDirectory = path.join(projectRoot, "public");
const standaloneModulesDirectory = path.join(standaloneDirectory, "node_modules");
const desktopModulesDirectory = path.join(standaloneDirectory, "desktop_modules");

if (!existsSync(path.join(standaloneDirectory, "server.js"))) {
  throw new Error("Build standalone do Next.js não encontrado. Execute `npm run build` primeiro.");
}

if (!existsSync(path.join(standaloneModulesDirectory, "next", "package.json"))) {
  throw new Error("O Next.js não foi incluído no build standalone. Apague a pasta `.next` e execute `npm run desktop:package` novamente.");
}

if (!existsSync(staticDirectory)) {
  throw new Error("Arquivos estáticos do Next.js não foram encontrados em `.next/static`.");
}

mkdirSync(path.join(standaloneDirectory, ".next"), { recursive: true });
cpSync(staticDirectory, path.join(standaloneDirectory, ".next", "static"), { recursive: true });
cpSync(standaloneModulesDirectory, desktopModulesDirectory, { recursive: true });

if (existsSync(publicDirectory)) {
  cpSync(publicDirectory, path.join(standaloneDirectory, "public"), { recursive: true });
}

if (!existsSync(path.join(desktopModulesDirectory, "next", "package.json"))) {
  throw new Error("O pacote Next.js está ausente no diretório standalone preparado.");
}

console.log("Aplicativo Next.js preparado para o pacote desktop.");
