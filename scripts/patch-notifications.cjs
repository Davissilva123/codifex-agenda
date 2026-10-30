const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'page.tsx');
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Adicionar botão 🔔 no header, antes do botão de backup ──────
const backupBtn = `<button type="button" className="btn btn-ghost px-2 py-2" aria-label="Baixar backup dos dados em JSON" title="Baixar backup dos dados em JSON" onClick={() => {`;

const bellBtn = `<button type="button" disabled={pushBusy} className="btn btn-ghost px-2 py-2" aria-label={alertsOn ? "Desativar notificações" : "Ativar notificações"} title={alertsOn ? "Notificações ativas neste dispositivo" : "Ativar notificações neste dispositivo"} onClick={alertsOn ? disablePush : enablePush}>{pushBusy ? "…" : alertsOn ? "🔔" : "🔕"}</button>
            ` + backupBtn;

if (src.includes(backupBtn)) {
  src = src.replace(backupBtn, bellBtn);
  console.log('✅ Botão 🔔 adicionado no header');
} else {
  console.warn('⚠️ Padrão do botão de backup não encontrado');
}

// ── 2. Remover o card "Notificações neste dispositivo" do rodapé ───
// Encontrar e remover a section de notificações
const notifStart = `\n        <section className="card mt-6 p-4 sm:p-5">`;
const notifEnd = `</section>\n      </div>`;

const startIdx = src.indexOf(notifStart);
if (startIdx !== -1) {
  // Encontrar o fim correto — a section de notificações é a última antes de </div>
  const endIdx = src.indexOf(notifEnd, startIdx);
  if (endIdx !== -1) {
    const toRemove = src.slice(startIdx, endIdx + notifEnd.length);
    src = src.replace(toRemove, `\n      </div>`);
    console.log('✅ Card de notificações removido do rodapé');
  } else {
    console.warn('⚠️ Fim do card de notificações não encontrado');
  }
} else {
  console.warn('⚠️ Início do card de notificações não encontrado — tentando variante...');
  // Tenta com p-5 sm:p-6
  const notifStart2 = `\n        <section className="card mt-6 p-5 sm:p-6">`;
  const startIdx2 = src.indexOf(notifStart2);
  if (startIdx2 !== -1) {
    const endIdx2 = src.indexOf(notifEnd, startIdx2);
    if (endIdx2 !== -1) {
      const toRemove2 = src.slice(startIdx2, endIdx2 + notifEnd.length);
      src = src.replace(toRemove2, `\n      </div>`);
      console.log('✅ Card de notificações removido (variante 2)');
    }
  }
}

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅ patch-notifications aplicado!');
