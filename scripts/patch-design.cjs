const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'page.tsx');
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Reverter ícone de busca feio (🔍) de volta ao original (⌕) ──
src = src.replace(
  `<span className="muted absolute left-3 top-1/2 -translate-y-1/2 text-base pointer-events-none select-none">🔍</span>`,
  `<span className="muted absolute left-3 top-2.5 text-lg pointer-events-none select-none">⌕</span>`
);

// ── 2. Melhorar header – logo 📅 com sombra e nome mais visível ──
src = src.replace(
  `<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-xl text-white shadow-sm">📅</span>`,
  `<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-xl text-white" style={{boxShadow:'0 2px 6px rgba(37,99,235,.4)'}}>📅</span>`
);

// ── 3. Remover backdropFilter inline (não funciona bem no header) ──
src = src.replace(
  `<header className="surface sticky top-0 z-30 border-b line" style={{backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)'}}>`,
  `<header className="surface sticky top-0 z-30 border-b line">`
);

// ── 4. Melhorar WorkItem – linha do card com borda colorida à esq ──
src = src.replace(
  '`rounded-xl border-l-4 border border-line p-3 transition-shadow hover:shadow-sm ${item.concluido ? "opacity-55" : ""}`',
  '`rounded-xl border line p-3 transition-shadow hover:shadow-md ${item.concluido ? "opacity-50" : ""}`'
);

// ── 5. Melhorar badge Online/Offline ──
src = src.replace(
  '`rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${isOnline ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`',
  '`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isOnline ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`'
);

// ── 6. Melhorar formulário de login – logo 📅 ──
src = src.replace(
  `<div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600 text-3xl text-white shadow-md">📅</div>`,
  `<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-3xl text-white" style={{boxShadow:'0 4px 14px rgba(37,99,235,.4)'}}>📅</div>`
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅ patch-design v2 aplicado!');
