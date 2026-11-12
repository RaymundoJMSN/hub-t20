// tools/livro.mjs — lê o texto dos livros pelo índice de trechos do Arauto (dados/vetores/livros-trechos.json), por página.
// Serve às auditorias ("o que este livro tem que a base estruturada não tem?"). O texto é da Jambo: só consulta local.
//
//   node tools/livro.mjs --livros                         → livros do índice, com faixa de páginas
//   node tools/livro.mjs "Heróis de Arton" 120-126        → o texto dessas páginas, em ordem
//   node tools/livro.mjs "Heróis de Arton" --achar "tabela 3-2"   → páginas onde o termo aparece, com o trecho
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = join(dirname(fileURLToPath(import.meta.url)), "..", "dados");
const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"); // acentos soltos depois do NFD
const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(MARCAS, "");
const trechos = JSON.parse(readFileSync(join(DADOS, "vetores", "livros-trechos.json"), "utf-8"));
const [a, b, c] = process.argv.slice(2);

if (!a || a === "--livros") {
  const por = {};
  for (const x of trechos) { const v = (por[x.l] ??= { n: 0, min: Infinity, max: 0 }); v.n++; const p = +x.p; if (p > 0) { v.min = Math.min(v.min, p); v.max = Math.max(v.max, p); } }
  for (const [l, v] of Object.entries(por).sort((x, y) => y[1].n - x[1].n)) console.log(`${String(v.n).padStart(5)} trechos | ${v.max ? `p. ${v.min}-${v.max}` : "sem página"} | ${l}`);
} else {
  const doLivro = trechos.filter((x) => norm(x.l).includes(norm(a)));
  if (!doLivro.length) { console.log("livro não encontrado; use --livros"); process.exit(1); }
  if (b === "--achar") {
    const q = norm(c), vistos = new Set();
    for (const x of doLivro) {
      const i = norm(x.t).indexOf(q);
      if (i < 0 || vistos.has(x.p + ":" + i)) continue;
      vistos.add(x.p + ":" + i);
      console.log(`p. ${x.p}: …${x.t.replace(/\s+/g, " ").slice(Math.max(0, i - 80), i + 160)}…`);
      if (vistos.size >= 60) { console.log("(mais de 60 ocorrências; refine o termo)"); break; }
    }
    if (!vistos.size) console.log("nenhuma ocorrência");
  } else {
    const [ini, fim = ini] = String(b || "").split("-").map(Number);
    if (!ini) { console.log('uso: node tools/livro.mjs "<livro>" <pIni>-<pFim> | --achar "termo"'); process.exit(1); }
    // trechos vizinhos se sobrepõem um pouco (janela do índice): a repetição no começo de cada um é esperada
    const pags = doLivro.filter((x) => +x.p >= ini && +x.p <= fim).sort((x, y) => +x.p - +y.p);
    let ult = null, total = 0;
    for (const x of pags) {
      if (x.p !== ult) { console.log(`\n===== p. ${x.p} =====`); ult = x.p; }
      console.log(x.t.trim());
      if ((total += x.t.length) > 60000) { console.log("\n(cortado em 60 mil caracteres: peça uma faixa menor)"); break; }
    }
    if (!pags.length) console.log("nenhum trecho nessas páginas");
  }
}
