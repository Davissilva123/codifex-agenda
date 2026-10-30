const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const strStart = '<section className="card mt-6 p-5 sm:p-6">';
const idxStart = content.indexOf(strStart);

if (idxStart !== -1) {
  const strEnd = '</section>';
  const idxEnd = content.indexOf(strEnd, idxStart);
  if (idxEnd !== -1) {
    const sectionToRemove = content.slice(idxStart, idxEnd + strEnd.length);
    content = content.replace(sectionToRemove, '').replace(/\n\s*\n\s*<\/div>/, '\n      </div>');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Sucesso: Card de notificações do rodapé removido!');
  } else {
    console.log('Fim da tag não encontrado');
  }
} else {
  console.log('Início da tag não encontrado');
}
