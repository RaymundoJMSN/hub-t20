// tools/onde-esta.mjs — dado um nome (poder, magia, item, raça, classe, origem, parceiro…), diz em que parte da base
// estruturada do hub ele está, ou FALTA. Serve às auditorias de cobertura dos livros.
//
//   node tools/onde-esta.mjs "Patas Ligeiras" "Botas Aladas" "Velocidade"
//   node tools/onde-esta.mjs --arquivo nomes.txt        (um nome por linha)
//   node tools/onde-esta.mjs --contagem                 (quantos itens de cada livro em cada parte da base)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = join(dirname(fileURLToPath(import.meta.url)), "..", "dados");
const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"); // acentos soltos depois do NFD
const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(MARCAS, "").replace(/[^a-z0-9]+/g, " ").trim();
const json = (...p) => JSON.parse(readFileSync(join(DADOS, ...p), "utf-8"));

// índice: nome normalizado → [onde]
const indice = new Map(), porLivro = {};
const por = (parte, nome, livro, extra = "") => {
  if (!nome) return;
  const k = norm(nome);
  if (!indice.has(k)) indice.set(k, []);
  indice.get(k).push(`${parte}${extra ? " (" + extra + ")" : ""}${livro ? " — " + livro : ""}`);
  ((porLivro[livro || "?"] ??= {})[parte] ??= 0); porLivro[livro || "?"][parte]++;
};
const P = json("poderes.json");
for (const [, p] of Object.entries(P.poderes || P)) por("poderes", p.nome, p.livro, p.acesso + (p.donos?.length ? ": " + p.donos.slice(0, 2).join("/") : ""));
const B = json("base.json");
const T = json("textos.json");
for (const [slug, m] of Object.entries(T)) por("magias", m.nome, B.magias?.[slug]?.livro || m.livro, `${m.circulo || "?"}º círculo`);
for (const r of B.racas || []) { por("raças", r.nome, r.livro); for (const l of r.linhagens || []) por("raças", `${r.nome} (${l.nome})`, r.livro, "linhagem"); }
for (const c of B.classes || []) por("classes", c.nome, c.livro, c.varianteDe ? "variante de " + c.varianteDe : "");
for (const o of B.origens || []) por("origens", o.nome, o.livro);
for (const d of B.divindades || []) por("divindades", d.nome, d.livro);
for (const d of B.distincoes || []) por("distinções", d.nome, d.livro);
for (const arq of readdirSync(join(DADOS, "colecoes")).filter((f) => f.endsWith(".json") && f !== "INDEX.json")) {
  const col = arq.replace(".json", "");
  for (const it of json("colecoes", arq).itens || []) por("coleção " + col, it.nome, it.f?.livro || it.f?.fonte || "", String(it.linha || "").split(" · ").slice(0, 2).join(" · "));
}

const args = process.argv.slice(2);
if (args[0] === "--contagem") {
  for (const [livro, partes] of Object.entries(porLivro).sort()) console.log(`${livro}: ${Object.entries(partes).map(([k, n]) => `${k} ${n}`).join(", ")}`);
} else {
  const nomes = args[0] === "--arquivo" ? readFileSync(args[1], "utf-8").split("\n").map((l) => l.trim()).filter(Boolean) : args;
  if (!nomes.length) { console.log('uso: node tools/onde-esta.mjs "Nome" … | --arquivo nomes.txt | --contagem'); process.exit(1); }
  const chaves = [...indice.keys()];
  let faltam = 0;
  for (const nome of nomes) {
    const k = norm(nome);
    let onde = indice.get(k);
    let aviso = "";
    if (!onde && k.length >= 5) { // nome parecido: o do livro pode vir com sufixo ("Ímpeto (Bárbaro)") ou artigo
      const perto = chaves.filter((c) => c.startsWith(k + " ") || c.endsWith(" " + k) || (c.length >= 5 && k.startsWith(c + " "))).slice(0, 3);
      if (perto.length) { onde = perto.flatMap((c) => indice.get(c).map((o) => `${o} [como “${c}”]`)); aviso = " (nome parecido)"; }
    }
    if (onde) console.log(`OK    ${nome}${aviso}: ${[...new Set(onde)].slice(0, 4).join(" | ")}`);
    else { faltam++; console.log(`FALTA ${nome}`); }
  }
  console.log(`\n${nomes.length - faltam} de ${nomes.length} na base; ${faltam} faltando.`);
}
