const fs = require('fs');
const path = require('path');

// 1. package.json
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.build) {
  pkg.build.productName = "CODIFEX AGENDAS";
  pkg.build.appId = "br.com.codifex.agendas";
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('package.json atualizado!');

// 2. desktop/main.cjs
const mainPath = path.join(__dirname, '..', 'desktop', 'main.cjs');
let mainCode = fs.readFileSync(mainPath, 'utf8');
mainCode = mainCode.replace(/title:\s*"Minha Agenda"/g, 'title: "CODIFEX AGENDAS"');
mainCode = mainCode.replace(/Minha Agenda/g, 'CODIFEX AGENDAS');
// Adicionar o ícone na janela do Electron se não tiver
if (!mainCode.includes('icon:')) {
  mainCode = mainCode.replace('autoHideMenuBar: true,', `autoHideMenuBar: true,\n    icon: path.join(__dirname, '..', 'public', 'icon.png'),`);
}
fs.writeFileSync(mainPath, mainCode, 'utf8');
console.log('desktop/main.cjs atualizado!');

// 3. app/page.tsx
const pagePath = path.join(__dirname, '..', 'app', 'page.tsx');
let pageCode = fs.readFileSync(pagePath, 'utf8');

// Substituir nomes nas notificações
pageCode = pageCode.replace(/Lembrete: Minha Agenda/g, 'Lembrete: CODIFEX AGENDAS');
pageCode = pageCode.replace(/Aniversário: Minha Agenda/g, 'Aniversário: CODIFEX AGENDAS');
pageCode = pageCode.replace(/"Minha Agenda"/g, '"CODIFEX AGENDAS"');
pageCode = pageCode.replace(/'minha-agenda-/g, "'codifex-agenda-");
pageCode = pageCode.replace(/minha-agenda-backup/g, "codifex-agendas-backup");
pageCode = pageCode.replace(/icon:\s*\"\/icon\.svg\"/g, 'icon: "/icon.png"');

// Substituir o ícone 📅 e o texto "Minha Agenda" no Header
// No header temos:
// <button type="button" className="flex items-center gap-2 text-lg font-bold" onClick={() => { setView("day"); setSearch(""); showDate(today); }}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-xl text-white" style={{boxShadow:'0 2px 6px rgba(37,99,235,.4)'}}>📅</span><span className="hidden sm:inline">Minha Agenda</span></button>
pageCode = pageCode.replace(
  /<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-xl text-white"[^>]*>📅<\/span><span className="hidden sm:inline">Minha Agenda<\/span>/,
  `<img src="/icon.png" alt="CODIFEX AGENDAS" className="h-9 w-9 rounded-xl object-contain shadow-sm" /><span className="hidden sm:inline font-bold">CODIFEX AGENDAS</span>`
);

// Se não bateu pelo regex exato, fazemos trocas diretas:
pageCode = pageCode.replace(
  `<span className="hidden sm:inline">Minha Agenda</span>`,
  `<span className="hidden sm:inline font-bold">CODIFEX AGENDAS</span>`
);

// Substituir no Login:
// <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-3xl text-white" style={{boxShadow:'0 4px 14px rgba(37,99,235,.4)'}}>📅</div><h1 className="text-2xl font-bold">Minha Agenda</h1>
pageCode = pageCode.replace(
  /<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-3xl text-white"[^>]*>📅<\/div><h1 className="text-2xl font-bold">Minha Agenda<\/h1>/,
  `<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center"><img src="/icon.png" alt="CODIFEX AGENDAS" className="h-16 w-16 rounded-2xl object-contain shadow-md" /></div><h1 className="text-2xl font-bold">CODIFEX AGENDAS</h1>`
);
pageCode = pageCode.replace(
  `<h1 className="text-2xl font-bold">Minha Agenda</h1>`,
  `<h1 className="text-2xl font-bold">CODIFEX AGENDAS</h1>`
);

fs.writeFileSync(pagePath, pageCode, 'utf8');
console.log('app/page.tsx atualizado!');

// 4. public/sw.js
const swPath = path.join(__dirname, '..', 'public', 'sw.js');
let swCode = fs.readFileSync(swPath, 'utf8');
swCode = swCode.replace(/Minha Agenda/g, 'CODIFEX AGENDAS');
swCode = swCode.replace(/\/icon\.svg/g, '/icon.png');
fs.writeFileSync(swPath, swCode, 'utf8');
console.log('public/sw.js atualizado!');
