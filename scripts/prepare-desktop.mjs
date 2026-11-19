import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneDirectory = path.join(projectRoot, ".next", "standalone");
const staticDirectory = path.join(projectRoot, ".next", "static");
const publicDirectory = path.join(projectRoot, "public");
const standaloneModulesDirectory = path.join(standaloneDirectory, "node_modules");
const desktopModulesDirectory = path.join(standaloneDirectory, "desktop_modules");
const rootNextModule = path.join(projectRoot, "node_modules", "next");

if (!existsSync(path.join(standaloneDirectory, "server.js"))) {
  throw new Error("Build standalone do Next.js não encontrado. Execute `npm run build` primeiro.");
}

if (!existsSync(staticDirectory)) {
  throw new Error("Arquivos estáticos do Next.js não foram encontrados em `.next/static`.");
}

mkdirSync(path.join(standaloneDirectory, ".next"), { recursive: true });
cpSync(staticDirectory, path.join(standaloneDirectory, ".next", "static"), { recursive: true });
cpSync(standaloneModulesDirectory, desktopModulesDirectory, { recursive: true });

// Garante que todo o pacote next da raiz seja copiado para desktop_modules/next
// prevenindo que arquivos omitidos pelo trace do Next.js standalone quebrem a execução no Windows
if (existsSync(rootNextModule)) {
  cpSync(rootNextModule, path.join(desktopModulesDirectory, "next"), { recursive: true, force: true });
}

if (existsSync(publicDirectory)) {
  cpSync(publicDirectory, path.join(standaloneDirectory, "public"), { recursive: true });
}

const serverEnvFile = path.join(projectRoot, "server.env");
if (existsSync(serverEnvFile)) {
  cpSync(serverEnvFile, path.join(standaloneDirectory, "server.env"), { force: true });
  cpSync(serverEnvFile, path.join(standaloneDirectory, ".env.local"), { force: true });
}

if (!existsSync(path.join(desktopModulesDirectory, "next", "package.json"))) {
  throw new Error("O pacote Next.js está ausente no diretório standalone preparado.");
}

console.log("Aplicativo Next.js preparado para o pacote desktop.");
