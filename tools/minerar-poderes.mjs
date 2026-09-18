/**
 * Gera `dados/poderes.json` — todos os poderes do jogo, por slug, servidos pelo
 * server local (mesma política de `dados/textos.json`: texto da Jambo fica FORA
 * do repo e sobe por scp no deploy).
 *
 * Duas fontes, porque nenhuma sozinha cobre tudo:
 *  1. compêndio do sistema Tormenta20 do Foundry (LevelDB) — Livro Básico e
 *     Distinções, com texto literal, categoria, página e custo em PM já prontos;
 *  2. os markdowns de `tormenta-livros` — Heróis de Arton e Dragão Brasil, que
 *     compêndio nenhum traz.
 * O compêndio ganha em caso de nome repetido (é dado estruturado, não OCR).
 *
 *   node tools/minerar-poderes.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const SAIDA = join(RAIZ, "dados", "poderes.json");
const FOUNDRY = process.env.FOUNDRY_DIR ?? "X:/FoundryVTT";
const LIVROS = process.env.T20_LIVROS ?? join(RAIZ, "..", "tormenta-livros", "livros");

// ---------- utilidades ----------
export const semAcento = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const slugify = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function htmlParaTexto(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&([a-z]+|#\d+);/gi, (t, e) => ENTIDADES[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCharCode(+e.slice(1)) : t))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const ENTIDADES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", aacute: "á", agrave: "à", acirc: "â", atilde: "ã", eacute: "é", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú", ccedil: "ç", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ccedil: "Ç" };

/**
 * Separa o "Pré-requisito: X" do corpo — vira campo próprio na carta.
 * Aparece tanto em linha própria (compêndio) quanto colado no fim do último
 * parágrafo (Heróis de Arton), daí casar em qualquer posição até o fim da linha.
 */
export function separarPrereq(texto) {
  const re = /\*{0,2}Pr[ée]-?requisitos?\*{0,2}:?\*{0,2}:?[ \t]*([^\n]*)/i;
  const m = texto.match(re);
  if (!m) return { prereq: "", descricao: texto.trim() };
  return {
    prereq: m[1].replace(/^\*+|\*+$/g, "").replace(/\.$/, "").trim(),
    descricao: texto.replace(re, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

// ---------- 1. compêndio do Foundry ----------
const PACKS = [
  "Data/systems/tormenta20/packs/poderes",
  "Data/systems/tormenta20/packs/poderes-distincao",
  "Data/modules/t20-poderes-que-faltam/packs/poderes-que-faltam",
];

// `system.tipo` do item manda na categoria (a pasta do compêndio erra em alguns);
// `ability` são as habilidades de classe, que ficam num balde só delas.
const CATEGORIA = { geral: null, classe: "Classe", ability: "Habilidade", racial: "Racial", concedido: "Concedido", origem: "Origem", distincao: "Distinção" };
const GERAIS = { combate: "Combate", destino: "Destino", magia: "Magia", tormenta: "Tormenta", concedido: "Concedido" };
const maiuscula = (s) => s ? s[0].toUpperCase() + s.slice(1) : "";

/** "Tormenta20 — Edição Jogo do Ano, p. 69" -> "Livro Básico" */
export function livroDe(fonte) {
  const f = semAcento(fonte || "").toLowerCase();
  if (f.includes("distin")) return "Distinções";
  if (f.includes("deuses")) return "Deuses de Arton";
  if (f.includes("herois")) return "Heróis de Arton";
  if (f.includes("dragao brasil") || f.includes("almanaque")) return "Dragão Brasil";
  if (f.includes("ameacas")) return "Ameaças de Arton";
  if (f.includes("npc")) return "Guia de NPCs";
  return "Livro Básico";
}

async function doCompendio(poderes) {
  let ClassicLevel;
  try { ({ ClassicLevel } = await import(`file:///${FOUNDRY}/Code/resources/app/node_modules/classic-level/index.js`)); }
  catch { console.warn("! sem classic-level do Foundry — pulando o compêndio"); return 0; }

  let n = 0;
  for (const caminho of PACKS) {
    const orig = join(FOUNDRY, caminho);
    if (!existsSync(orig)) { console.warn("! pack ausente:", caminho); continue; }
    // o Foundry aberto segura o LOCK: trabalhamos numa cópia
    const copia = join(tmpdir(), "t20-poderes-" + basename(caminho));
    rmSync(copia, { recursive: true, force: true });
    cpSync(orig, copia, { recursive: true, filter: (s) => !s.endsWith("LOCK") });
    const db = new ClassicLevel(copia, { valueEncoding: "json" });
    const itens = [], pastas = {};
    for await (const [k, v] of db.iterator()) {
      const tipo = k.split("!")[1];
      if (tipo === "folders") pastas[v._id] = v;
      else if (tipo === "items" && v.type === "poder") itens.push(v);
    }
    await db.close();
    rmSync(copia, { recursive: true, force: true });

    const caminhoPasta = (id) => !id ? [] : [...caminhoPasta(pastas[id]?.folder), pastas[id]?.name].filter(Boolean);
    for (const it of itens) {
      const tipo = (it.system?.tipo || "").toLowerCase();
      const subtipo = it.system?.subtipo || "";
      const trilha = caminhoPasta(it.folder);            // ex.: ["Geral","Combate"] / ["Classe","Nobre"]
      const categoria = CATEGORIA[tipo] ?? GERAIS[subtipo.toLowerCase()] ?? "Geral";
      const sub = tipo === "distincao" ? trilha[trilha.length - 1] || ""
        : CATEGORIA[tipo] ? maiuscula(subtipo) : "";
      const { prereq, descricao } = separarPrereq(htmlParaTexto(it.system?.description?.value));
      if (!descricao) continue;
      guardar(poderes, {
        nome: it.name, categoria, sub, prereq, descricao,
        livro: livroDe(it.system?.source),
        custo: it.system?.ativacao?.custo ? `${it.system.ativacao.custo} PM` : "",
        publicacao: it.system?.source || "",
      });
      n++;
    }
  }
  return n;
}

// ---------- 2. markdown dos livros ----------
// arquivo -> categoria/sub; só os que descrevem poder (os outros ficam de fora)
const CLASSES = ["arcanista", "barbaro", "bardo", "bucaneiro", "cacador", "cavaleiro", "clerigo", "druida", "guerreiro", "inventor", "ladino", "lutador", "nobre", "paladino"];
// numa distinção os poderes começam na Marca; sem essa seção o arquivo é a abertura do capítulo
const SECAO_DISTINCAO = /^## (Marca da Distinção|Poderes da Distinção)/m;
const ARQUIVOS = [
  ...CLASSES.map((c) => ({ arq: `herois-arton/02-novos-poderes/${c}.md`, categoria: "Classe", sub: titulo(c), livro: "Heróis de Arton" })),
  { arq: "herois-arton/02-novos-poderes/poderes-combate.md", categoria: "Combate", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-destino.md", categoria: "Destino", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-magia.md", categoria: "Magia", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-tormenta.md", categoria: "Tormenta", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-grupo.md", categoria: "Grupo", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-raca.md", categoria: "Racial", livro: "Heróis de Arton" },
  { arq: "herois-arton/02-novos-poderes/poderes-de-raca.md", categoria: "Racial", livro: "Heróis de Arton" },
  { arq: "dragao-brasil/04-pericias-poderes/02-poderes-gerais.md", categoria: "Geral", livro: "Dragão Brasil" },
  // um arquivo por distinção (título do arquivo = nome da distinção, daí o sub "*")
  ...listarMd("herois-arton/02-distincoes").map((arq) => ({ arq, categoria: "Distinção", sub: "*", de: SECAO_DISTINCAO, livro: "Heróis de Arton" })),
  ...listarMd("deuses-arton/03-distincoes").map((arq) => ({ arq, categoria: "Distinção", sub: "*", de: SECAO_DISTINCAO, livro: "Deuses de Arton" })),
  { arq: "deuses-arton/02-campeoes-deuses/09-poderes-concedidos.md", categoria: "Concedido", de: /^## Descrição dos Poderes/m, livro: "Deuses de Arton" },
];

function listarMd(pasta) {
  try {
    return readdirSync(join(LIVROS, pasta))
      // "distinções em jogo" é a explicação do capítulo, com as MESMAS seções de uma distinção
      .filter((f) => f.endsWith(".md") && !/^(README|link_report)/i.test(f) && !/distincoes-em-jogo/.test(f))
      .map((f) => `${pasta}/${f}`);
  } catch { return []; }
}

function titulo(s) {
  const acentos = { barbaro: "Bárbaro", cacador: "Caçador", clerigo: "Clérigo" };
  return acentos[s] || s[0].toUpperCase() + s.slice(1);
}

// cabeçalho que é seção do livro, não poder
const NAO_E_PODER = /^(tabela|índice|indice|sumário|introdu|sobre |navega|poderes? de (classe|combate|destino|magia|tormenta|raça|raca|grupo|arton)\b|novos (efeitos|poderes)|refer|lista de|como (usar|funciona)|pré-requisitos)/i;

/** Uma seção de poder por cabeçalho do nível mais profundo que o arquivo usa. */
export function poderesDoMarkdown(md) {
  const corpo = md.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const nivel = (corpo.match(/^### /gm) || []).length >= 5 ? 3 : 2;
  const re = new RegExp(`^#{${nivel}} +(.+?)\\s*$`, "gm");
  const achados = [...corpo.matchAll(re)];
  const out = [];
  for (let i = 0; i < achados.length; i++) {
    const nome = achados[i][1].replace(/\*+/g, "").trim();
    const ini = achados[i].index + achados[i][0].length;
    const fim = i + 1 < achados.length ? achados[i + 1].index : corpo.length;
    let texto = corpo.slice(ini, fim);
    texto = texto.replace(/^\s*\[[^\]]*\]\([^)]*\)[^\n]*$/gm, "")   // linhas de navegação
                 .replace(/^\s*---\s*$/gm, "")
                 .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                 .replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (NAO_E_PODER.test(nome)) continue;
    if (/^\|/m.test(texto)) continue;          // seção com tabela = índice, não poder
    if (texto.length < 60) continue;
    out.push({ nome, texto });
  }
  return out;
}

function doMarkdown(poderes) {
  let n = 0;
  for (const { arq, categoria, sub, livro, de } of ARQUIVOS) {
    const caminho = join(LIVROS, arq);
    if (!existsSync(caminho)) { console.warn("! livro ausente:", arq); continue; }
    let md = readFileSync(caminho, "utf-8");
    const nomeSub = sub === "*" ? (md.match(/^# +(.+)$/m)?.[1].trim() || "") : (sub || "");
    if (de) {
      const i = md.search(de);
      if (i < 0) continue;                  // arquivo sem a seção de poderes: é abertura de capítulo
      md = md.slice(i);                     // fora dela é lenda e regra de admissão, não poder
    }
    for (const { nome, texto } of poderesDoMarkdown(md)) {
      const { prereq, descricao } = separarPrereq(texto);
      guardar(poderes, { nome, categoria, sub: nomeSub, livro, prereq, descricao, custo: "", publicacao: livro });
      n++;
    }
  }
  return n;
}

// ---------- montagem ----------
const LINHA = { Classe: "Poder de classe", Habilidade: "Habilidade de classe", Racial: "Poder racial", Concedido: "Poder concedido", Origem: "Poder de origem", Distinção: "Distinção", Geral: "Poder geral", Grupo: "Poder de grupo" };

function guardar(poderes, p) {
  const slug = slugify(p.nome);
  if (!slug || poderes[slug]) return;          // primeiro a chegar ganha (compêndio vem antes)
  const base = LINHA[p.categoria] || `Poder de ${p.categoria.toLowerCase()}`;
  poderes[slug] = {
    nome: p.nome,
    categoria: p.categoria,
    sub: p.sub,
    livro: p.livro,
    linha: [p.sub ? `${base} · ${p.sub}` : base, p.livro].join(" · "),
    prereq: p.prereq,
    custo: p.custo,
    descricao: p.descricao,
    publicacao: p.publicacao || p.livro,
  };
}

async function principal() {
  const poderes = {};
  const nc = await doCompendio(poderes);
  const nm = doMarkdown(poderes);
  mkdirSync(dirname(SAIDA), { recursive: true });
  writeFileSync(SAIDA, JSON.stringify(poderes), "utf-8");
  const porCat = {};
  for (const p of Object.values(poderes)) porCat[p.categoria] = (porCat[p.categoria] || 0) + 1;
  console.log(`${Object.keys(poderes).length} poderes -> ${SAIDA}`);
  console.log(`  compêndio ${nc} · markdown ${nm} (repetidos descartados)`);
  console.log("  " + Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
}

// ---------- self-test ----------
function check() {
  const md = `---\ntitle: x\n---\n\n# Poderes de Combate\n\n[← Anterior](a.md) | [Próximo →](b.md)\n\n## Tabela: Poderes de Combate\n\n| Poder | Pré |\n|---|---|\n| Revide | — |\n\n## Revide\n\nQuando alguém te acerta, você pode gastar 2 PM para revidar com um ataque corpo a corpo imediato contra o agressor.\n\n**Pré-requisito:** Reflexos de Combate.\n\n## Curto\n\nnada\n`;
  const ps = poderesDoMarkdown(md);
  const erro = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  if (ps.length !== 1) return erro(`esperava 1 poder, veio ${ps.length}: ${ps.map((p) => p.nome)}`);
  if (ps[0].nome !== "Revide") return erro("nome errado: " + ps[0].nome);
  const { prereq, descricao } = separarPrereq(ps[0].texto);
  if (prereq !== "Reflexos de Combate") return erro("prereq: " + prereq);
  if (/Pré-requisito/i.test(descricao)) return erro("prereq ficou na descrição");
  if (!descricao.startsWith("Quando alguém")) return erro("descrição: " + descricao.slice(0, 40));
  // prereq colado no fim do parágrafo (Heróis de Arton) também sai
  const inline = separarPrereq("Você recebe +2 em Guerra (veja p. 121). Pré-requisito: treinado em Guerra.");
  if (inline.prereq !== "treinado em Guerra") return erro("prereq inline: " + inline.prereq);
  if (inline.descricao !== "Você recebe +2 em Guerra (veja p. 121).") return erro("descrição inline: " + inline.descricao);
  if (livroDe("Tormenta20 — Edição Jogo do Ano, p. 69") !== "Livro Básico") return erro("livroDe LB");
  if (livroDe("T20 - Deuses de Arton (pág. 36)") !== "Deuses de Arton") return erro("livroDe Deuses");
  if (slugify("Evasão (Bucaneiro)") !== "evasao-bucaneiro") return erro("slug: " + slugify("Evasão (Bucaneiro)"));
  if (htmlParaTexto("<p>a&ccedil;&atilde;o<br>2&ordm;</p>") !== "ação\n2º") return erro("html: " + JSON.stringify(htmlParaTexto("<p>a&ccedil;&atilde;o<br>2&ordm;</p>")));
  // markdown não pode sobrescrever o compêndio
  const pd = {};
  guardar(pd, { nome: "Revide", categoria: "Combate", sub: "", livro: "Livro Básico", prereq: "", descricao: "oficial", custo: "", publicacao: "LB" });
  guardar(pd, { nome: "Revide", categoria: "Combate", sub: "", livro: "Heróis de Arton", prereq: "", descricao: "md", custo: "", publicacao: "HdA" });
  if (pd.revide.descricao !== "oficial") return erro("markdown sobrescreveu o compêndio");
  if (!process.exitCode) console.log("minerar-poderes.mjs --check OK");
}

process.argv.includes("--check") ? check() : principal();
