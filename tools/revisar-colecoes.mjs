// tools/revisar-colecoes.mjs — resumo de uma linha + temas para as coleções que não passaram pela revisão 1 a 1
// (itens e parceiros). É o que faz "poção de Velocidade" ou "botas" aparecerem quando alguém procura pelo que o item FAZ.
//
//   node tools/revisar-colecoes.mjs --lotes            → dados/revisao-lotes-colecoes/<col>-NN.md + indice.json (um lote por agente)
//   node tools/revisar-colecoes.mjs <journal.jsonl>    → dados/revisao-colecoes.json  ({ itens: { id: { r, tags } }, parceiros: {…} })
//   node tools/revisar-colecoes.mjs --check
//
// O texto dos itens é da Jambo: os lotes e o resultado ficam em dados/ (fora do git).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA_IDS } from "../static/temas.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), ".."), DADOS = join(RAIZ, "dados");
export const COLECOES = ["itens", "parceiros"];
const semHtml = (h) => String(h || "").replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/th)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

/** Fatia os itens em lotes (por quantidade e por tamanho), sem partir um item. */
export function fatiar(itens, fmt, { maxItens = 45, maxChars = 26000 } = {}) {
  const lotes = [];
  let lote = [], chars = 0;
  for (const it of itens) {
    const txt = fmt(it);
    if (lote.length && (lote.length >= maxItens || chars + txt.length > maxChars)) { lotes.push(lote); lote = []; chars = 0; }
    lote.push({ id: it.id, txt }); chars += txt.length;
  }
  if (lote.length) lotes.push(lote);
  return lotes;
}

/** Junta os resultados dos agentes: só ids que existem, só temas do vocabulário, resumo numa linha. */
export function juntar(resultados, validos) {
  const out = {}, fora = [];
  for (const { col, itens } of resultados) {
    for (const x of itens || []) {
      if (!validos[col]?.has(x.id)) { fora.push(`${col}/${x.id}`); continue; }
      const tags = [...new Set((x.tags || []).filter((t) => TEMA_IDS.includes(t)))];
      (out[col] ??= {})[x.id] = { r: String(x.resumo || "").replace(/\s+/g, " ").trim().slice(0, 220), tags, ...(x.problema ? { problema: String(x.problema).slice(0, 200) } : {}) };
    }
  }
  return { out, fora };
}

const ler = (col) => JSON.parse(readFileSync(join(DADOS, "colecoes", col + ".json"), "utf-8")).itens || [];

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/revisar-colecoes.mjs")) {
  const arg = process.argv[2];
  if (arg === "--check") {
    const falha = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
    const ls = fatiar([{ id: "a" }, { id: "b" }, { id: "c" }], (x) => x.id.repeat(10), { maxItens: 2 });
    if (ls.map((l) => l.map((x) => x.id).join("")).join("|") !== "ab|c") falha("fatiar por quantidade");
    if (fatiar([{ id: "a" }, { id: "b" }], () => "x".repeat(30), { maxChars: 40 }).length !== 2) falha("fatiar por tamanho");
    const { out, fora } = juntar([{ col: "itens", itens: [{ id: "bota", resumo: " Dá  +1,5m ", tags: ["deslocamento", "inventado", "deslocamento"] }, { id: "nao-existe", resumo: "x", tags: [] }] }], { itens: new Set(["bota"]) });
    if (JSON.stringify(out) !== '{"itens":{"bota":{"r":"Dá +1,5m","tags":["deslocamento"]}}}' || fora.join() !== "itens/nao-existe") falha("juntar: " + JSON.stringify(out) + fora);
    if (!process.exitCode) console.log("revisar-colecoes.mjs --check OK");
  } else if (arg === "--lotes") {
    const dir = join(DADOS, "revisao-lotes-colecoes");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const indice = [];
    for (const col of COLECOES) {
      const itens = ler(col).slice().sort((a, b) => String(a.linha).localeCompare(String(b.linha), "pt") || a.nome.localeCompare(b.nome, "pt"));
      const lotes = fatiar(itens, (it) => [`### ${it.id}`, `nome: ${it.nome}`, `classificado como: ${it.linha || "—"}`, "texto:", semHtml(it.html).slice(0, 1800)].join("\n"));
      lotes.forEach((lote, i) => {
        const arq = `${col}-${String(i + 1).padStart(2, "0")}.md`;
        writeFileSync(join(dir, arq), lote.map((x) => x.txt).join("\n\n") + "\n");
        indice.push({ arquivo: arq, col, itens: lote.map((x) => x.id) });
      });
      console.log(`${col}: ${itens.length} itens em ${lotes.length} lotes`);
    }
    writeFileSync(join(dir, "indice.json"), JSON.stringify(indice, null, 1));
    console.log(`${indice.length} lotes em ${dir}`);
  } else if (arg && existsSync(arg)) {
    // journal do workflow: cada linha "result" traz { lote, col, itens } de um agente
    const linhas = readFileSync(arg, "utf-8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l?.type === "result" && l.result?.itens);
    const validos = Object.fromEntries(COLECOES.map((c) => [c, new Set(ler(c).map((i) => i.id))]));
    const { out, fora } = juntar(linhas.map((l) => l.result), validos);
    for (const col of COLECOES) {
      const n = Object.keys(out[col] || {}).length, total = validos[col].size;
      console.log(`${col}: ${n} de ${total} revisados${n < total ? " — FALTAM " + [...validos[col]].filter((id) => !out[col]?.[id]).slice(0, 8).join(", ") : ""}`);
    }
    if (fora.length) console.log("ids que os agentes devolveram e não existem:", fora.slice(0, 12).join(", "), fora.length > 12 ? `… (+${fora.length - 12})` : "");
    writeFileSync(join(DADOS, "revisao-colecoes.json"), JSON.stringify(out));
    console.log("gravado dados/revisao-colecoes.json");
  } else console.log("uso: node tools/revisar-colecoes.mjs --lotes | <journal.jsonl> | --check");
}
