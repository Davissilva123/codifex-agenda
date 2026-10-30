const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

pkg.build = pkg.build || {};
pkg.build.win = pkg.build.win || {};
pkg.build.win.icon = "public/icon.ico";

// Assegurar também no files do electron se necessário
if (!pkg.build.files.includes("public/icon.png")) {
  pkg.build.files.push("public/icon.png");
}
if (!pkg.build.files.includes("public/icon.ico")) {
  pkg.build.files.push("public/icon.ico");
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('package.json atualizado com win.icon: public/icon.ico');
