/**
 * tools/juntar-revisao.mjs — junta o resultado da revisão 1 a 1 (workflow de agentes, um lote por agente)
 * em dados/revisao.json, que o construir-base.mjs aplica por cima do que foi deduzido.
 *
 *   node tools/juntar-revisao.mjs <journal.jsonl do workflow>     grava dados/revisao.json e mostra a cobertura
 *   node tools/juntar-revisao.mjs --problemas [tipo]              lista o que os revisores sinalizaram
 *
 * O journal traz uma linha "started" (agentId + label = nome do lote) e uma "result" (agentId + itens) por agente.
 * Só entra item cujo identificador existe no lote (dados/revisao-lotes/indice.json): revisor não inventa slug.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = join(dirname(fileURLToPath(import.meta.url)), "..", "dados");
const ARQ = join(DADOS, "revisao.json");
const lerJson = (a, p) => { try { return JSON.parse(readFileSync(a, "utf-8")); } catch { return p; } };

if (process.argv.includes("--problemas")) {
  const rv = lerJson(ARQ, {}), tipo = process.argv[process.argv.indexOf("--problemas") + 1];
  for (const [grupo, itens] of Object.entries(rv)) for (const [id, v] of Object.entries(itens || {}))
    if (v.problema && (!tipo || v.tipo_problema === tipo || grupo === tipo)) console.log(`${grupo} | ${v.tipo_problema || "-"} | ${id} | ${v.problema}`);
  process.exit(0);
}

const journal = process.argv[2];
if (!journal) { console.error("uso: node tools/juntar-revisao.mjs <journal.jsonl>"); process.exit(1); }
const linhas = readFileSync(journal, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const loteDe = new Map(linhas.filter((l) => l.type === "started").map((l) => [l.agentId, l.label]));
const indice = lerJson(join(DADOS, "revisao-lotes", "indice.json"), []);
const esperado = new Map(indice.map((l) => [l.arquivo.replace(".md", ""), l]));

const out = lerJson(ARQ, {}); // juntar de novo (lote refeito) só troca o que veio
for (const k of ["poderes", "magias", "racas"]) out[k] ??= {};
const limpo = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
let aceitos = 0, estranhos = 0;
const faltando = [];
for (const l of linhas) {
  if (l.type !== "result" || !l.result?.itens) continue;
  const lote = esperado.get(loteDe.get(l.agentId));
  if (!lote) { console.warn("! resultado sem lote:", loteDe.get(l.agentId)); continue; }
  const ids = new Set(lote.itens), vistos = new Set();
  for (const it of l.result.itens) {
    const id = lote.tipo === "racas" ? it.nome : it.slug;
    if (!ids.has(id) || vistos.has(id)) { estranhos++; continue; }
    vistos.add(id);
    const base = { resumo: limpo(it.resumo), tags: [...new Set(it.tags || [])] };
    if (limpo(it.problema)) base.problema = limpo(it.problema);
    if (lote.tipo === "poderes") { if (it.tipo_problema && it.tipo_problema !== "nenhum") base.tipo_problema = it.tipo_problema; else delete base.problema; }
    if (lote.tipo === "magias") base.papel = it.papel || [];
    if (lote.tipo === "racas") Object.assign(base, { atributos: limpo(it.atributos), deslocamento: limpo(it.deslocamento), tamanho: it.tamanho, tipo: limpo(it.tipo), sentidos: limpo(it.sentidos), escolhas: limpo(it.escolhas) });
    out[lote.tipo][id] = base;
    aceitos++;
  }
  for (const id of ids) if (!vistos.has(id)) faltando.push(`${lote.arquivo}: ${id}`);
}
// Os revisores marcaram "pm" em quase tudo que CUSTA PM (734 de 2.615). O tema é de quem DÁ, recupera ou economiza PM:
// fica só onde o texto do poder diz isso; se era o único tema, vira o segundo palpite ("acao") pra não ficar sem nenhum.
const P = lerJson(join(DADOS, "poderes.json"), {});
const DA_PM = /recebe \+?\d+ (PM|pontos? de mana)|(PM|pontos? de mana) tempor|recuper\w* [^.]{0,60}(PM|pontos? de mana)|custo[^.]{0,90}(diminu|reduz|menos|[–-] ?\d)|[–-]\d+ PM|PM adiciona|pontos? de mana (adiciona|por n[ií]vel|extras?)|(soma|adiciona)[^.]{0,50}(total de PM|seus PM|pontos de mana)|n[ãa]o gasta PM|sem gastar PM|limite de PM/i;
let pmTirados = 0;
for (const [slug, v] of Object.entries(out.poderes)) {
  if (!v.tags.includes("pm") || !P[slug] || DA_PM.test(P[slug].descricao)) continue;
  v.tags = v.tags.filter((t) => t !== "pm");
  if (!v.tags.length) v.tags = ["acao"];
  pmTirados++;
}
if (pmTirados) console.log(`  tema "pm" retirado de ${pmTirados} poderes que só gastam PM`);
writeFileSync(ARQ, JSON.stringify(out));
const conta = (o, f) => { const c = {}; for (const v of Object.values(o)) for (const k of [].concat(f(v) ?? [])) c[k] = (c[k] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); };
console.log(`${aceitos} itens aceitos (${Object.keys(out.poderes).length} poderes, ${Object.keys(out.magias).length} magias, ${Object.keys(out.racas).length} raças) · ${estranhos} com identificador fora do lote · ${faltando.length} sem revisão`);
if (faltando.length) console.log("  sem revisão:", faltando.slice(0, 30).join(" | "));
console.log("  problemas em poderes:", conta(out.poderes, (v) => v.tipo_problema).map(([k, n]) => `${k} ${n}`).join(" · ") || "nenhum");
console.log("  problemas em magias:", Object.values(out.magias).filter((v) => v.problema).length, "· em raças:", Object.values(out.racas).filter((v) => v.problema).length);
console.log("  temas (poderes):", conta(out.poderes, (v) => v.tags).map(([k, n]) => `${k} ${n}`).join(" · "));
