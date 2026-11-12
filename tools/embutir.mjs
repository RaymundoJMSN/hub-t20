/**
 * tools/embutir.mjs — gera os vetores (bge-m3) de cada item do acervo, pra busca por sentido do hub e do Arauto.
 * Roda NO PC (Ollama local com o modelo bge-m3); o servidor só embute a consulta. Saída: dados/vetores/<fonte>.f32 + .json
 *
 *   node tools/embutir.mjs                 poderes, magias e todas as coleções (só reembute o que mudou)
 *   node tools/embutir.mjs poderes magias  só essas fontes
 *   node tools/embutir.mjs --livros <dir>  converte o índice do Arauto (chunks.jsonl + embeddings.npy) pra cá, sem reembutir
 *   node tools/embutir.mjs --check         self-test (não chama o Ollama)
 *
 * Mesmo modelo dos dois lados: vetor do PC e do servidor batem (cosseno 0,99999 medido), então nada precisa ser refeito lá.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA_ROTULO } from "../static/temas.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = join(RAIZ, "dados"), SAIDA = join(DADOS, "vetores");
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434", MODELO = "bge-m3", DIM = 1024, LOTE = 24;
const lerJson = (a, p) => { try { return JSON.parse(readFileSync(a, "utf-8")); } catch { return p; } };
const hash = (s) => createHash("sha1").update(s).digest("base64url").slice(0, 12);
const temas = (tags) => (tags || []).map((t) => (TEMA_ROTULO[t] || t).replace(/^\S+\s/, "")).join(", ");
const semTags = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * O texto que representa cada item na busca por sentido. Poder e magia: só nome + resumo da revisão + temas.
 * Medido: com o corpo junto, o que importa e o ruído ficam colados (0,55 contra 0,54); só com o resumo, "enxergar no
 * escuro" traz as visões no escuro a 0,58–0,65 e o resto abaixo de 0,54. Sem resumo (item novo), cai no começo do texto.
 */
export const textoPoder = (p) => `${p.nome}: ${p.resumo || String(p.descricao || "").slice(0, 300)}${p.tags?.length ? ` (${temas(p.tags)})` : ""}`;
export const textoMagia = (m, extra = {}) => `${m.nome}: ${extra.resumo || String(m.descricao || "").slice(0, 300)}${extra.tags?.length ? ` (${temas(extra.tags)})` : ""}`;
export const textoColecao = (i) => [i.nome, i.linha, semTags(i.html).slice(0, 1100) || String(i.t || "").slice(0, 1100)].filter(Boolean).join(". ");

function fontes() {
  const base = lerJson(join(DADOS, "base.json"), { magias: {} });
  const out = {
    poderes: () => Object.entries(lerJson(join(DADOS, "poderes.json"), {})).map(([id, p]) => [id, textoPoder(p)]),
    magias: () => Object.entries(lerJson(join(DADOS, "textos.json"), {})).map(([id, m]) => [id, textoMagia(m, base.magias?.[id])]),
  };
  const dir = join(DADOS, "colecoes");
  if (existsSync(dir)) for (const arq of readdirSync(dir)) if (arq.endsWith(".json") && arq !== "INDEX.json")
    out["c-" + arq.replace(".json", "")] = () => (lerJson(join(dir, arq), { itens: [] }).itens || []).map((i) => [i.id, textoColecao(i)]);
  return out;
}

async function embutirLote(textos) {
  const r = await fetch(OLLAMA + "/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, input: textos }), signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const e = (await r.json()).embeddings;
  if (e?.length !== textos.length || e[0].length !== DIM) throw new Error("resposta inesperada do Ollama");
  return e;
}

async function gerar(nome, itens) {
  const arq = join(SAIDA, nome);
  const antigo = lerJson(arq + ".json", null);
  const velho = antigo && existsSync(arq + ".f32") ? { ...antigo, mat: new Float32Array(new Uint8Array(readFileSync(arq + ".f32")).buffer) } : null;
  const posVelha = new Map((velho?.ids || []).map((id, i) => [id, i]));
  const ids = itens.map(([id]) => id), hashes = itens.map(([, t]) => hash(t)), mat = new Float32Array(ids.length * DIM);
  const fazer = [];
  itens.forEach(([id], i) => {
    const j = posVelha.get(id);
    if (j != null && velho.hashes?.[j] === hashes[i] && velho.modelo === MODELO) mat.set(velho.mat.subarray(j * DIM, (j + 1) * DIM), i * DIM);
    else fazer.push(i);
  });
  const t0 = Date.now();
  for (let k = 0; k < fazer.length; k += LOTE) {
    const lote = fazer.slice(k, k + LOTE);
    const vs = await embutirLote(lote.map((i) => itens[i][1]));
    lote.forEach((i, n) => mat.set(vs[n], i * DIM));
    if ((k / LOTE) % 10 === 9) process.stdout.write(`\r  ${nome}: ${k + lote.length}/${fazer.length}`);
  }
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(arq + ".f32", Buffer.from(mat.buffer));
  writeFileSync(arq + ".json", JSON.stringify({ modelo: MODELO, dim: DIM, ids, hashes }));
  console.log(`\r  ${nome}: ${ids.length} itens, ${fazer.length} embutidos agora (${((Date.now() - t0) / 1000).toFixed(0)} s), ${ids.length - fazer.length} reaproveitados`);
}

/** embeddings.npy (float32, C, [n, 1024]) + chunks.jsonl do Arauto → livros.f32/.json + livros-trechos.json (texto, livro, página). */
function converterLivros(dir) {
  const npy = readFileSync(join(dir, "embeddings.npy"));
  if (npy.toString("latin1", 1, 6) !== "NUMPY") throw new Error("embeddings.npy não é um .npy");
  const major = npy[6], tamCab = major === 1 ? npy.readUInt16LE(8) : npy.readUInt32LE(8), ini = (major === 1 ? 10 : 12) + tamCab;
  const cab = npy.toString("latin1", major === 1 ? 10 : 12, ini);
  const forma = cab.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  if (!/'descr':\s*'<f4'/.test(cab) || /'fortran_order':\s*True/.test(cab) || !forma || +forma[2] !== DIM) throw new Error("embeddings.npy em formato inesperado: " + cab.trim());
  const n = +forma[1], dados = npy.subarray(ini, ini + n * DIM * 4);
  const trechos = readFileSync(join(dir, "chunks.jsonl"), "utf-8").split("\n").filter(Boolean).map((l) => { const c = JSON.parse(l); return { t: c.text, l: c.book, p: c.page }; });
  if (trechos.length !== n) throw new Error(`${trechos.length} trechos para ${n} vetores`);
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, "livros.f32"), dados);
  writeFileSync(join(SAIDA, "livros.json"), JSON.stringify({ modelo: MODELO, dim: DIM, ids: trechos.map((_, i) => i) }));
  writeFileSync(join(SAIDA, "livros-trechos.json"), JSON.stringify(trechos));
  console.log(`  livros: ${n} trechos convertidos do índice do Arauto (${(dados.length / 1e6).toFixed(0)} MB)`);
}

if (process.argv.includes("--check")) {
  const eq = (a, b, m) => { if (a !== b) { console.error("FALHOU:", m, "→", a); process.exitCode = 1; } };
  eq(textoPoder({ nome: "Atlético", linha: "Poder de destino · Livro Básico", resumo: "Resumo de teste.", tags: ["deslocamento", "pericia"], prereq: "For 2", descricao: "Texto de teste." }),
    "Atlético: Resumo de teste. (deslocamento, perícias)", "textoPoder");
  eq(textoMagia({ nome: "Luz", descricao: "Texto de teste." }), "Luz: Texto de teste.", "textoMagia sem revisão cai no texto");
  eq(textoColecao({ nome: "Lobo", linha: "Animal · ND 1", html: "<b>PV</b>&nbsp;10 <i>faro</i>" }), "Lobo. Animal · ND 1. PV 10 faro", "textoColecao tira as tags");
  eq(hash("a") !== hash("b") && hash("a").length === 12, true, "hash");
  if (!process.exitCode) console.log("embutir.mjs --check OK");
} else if (process.argv.includes("--livros")) {
  converterLivros(process.argv[process.argv.indexOf("--livros") + 1]);
} else {
  const todas = fontes(), pedidas = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  for (const nome of pedidas.length ? pedidas : Object.keys(todas)) {
    if (!todas[nome]) { console.error("fonte desconhecida:", nome, "· existem:", Object.keys(todas).join(", ")); continue; }
    await gerar(nome, todas[nome]());
  }
}
