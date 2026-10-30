const fs = require('fs');
const pngToIco = require('png-to-ico').default;

pngToIco('public/icon.png')
  .then(buf => {
    fs.writeFileSync('public/icon.ico', buf);
    console.log('ICO válido gerado com sucesso via png-to-ico! Tamanho:', buf.length);
  })
  .catch(err => {
    console.error('Erro ao converter png para ico:', err);
  });
