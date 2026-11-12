/**
 * tools/construir-base.mjs — monta a BASE DE CONHECIMENTO do hub.
 *
 *   dados/poderes.json   todo poder do jogo (v2): o que é, de quem é e COMO SE OBTÉM
 *   dados/base.json      raças, classes, divindades, origens e distinções ligadas aos seus poderes
 *
 * Fontes, na ordem de confiança:
 *  1. compêndios do Foundry (LevelDB): sistema tormenta20 + módulo Suplementos de Arton + módulos
 *     próprios. É dado estruturado (tipo, dono, pasta, página), sem OCR.
 *  2. dados do criador de fichas (pré-requisitos estruturados, progressão de classe, origens, deuses).
 *  3. o poderes.json anterior, só para o que nenhum compêndio traz (Dragão Brasil), marcado como tal.
 *  4. data/revisao.json — a revisão 1 a 1 (temas, resumo, correções), aplicada por cima.
 *
 * Texto é da Jambô: tudo que sai daqui fica em dados/ (fora do git).
 *
 *   node tools/construir-base.mjs            gera
 *   node tools/construir-base.mjs --check    self-test (não lê o Foundry)
 *   node tools/construir-base.mjs --lotes    também grava dados/revisao-lotes/ (entrada da revisão)
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const DADOS = join(RAIZ, "dados");
const FOUNDRY = process.env.FOUNDRY_DIR ?? "X:/FoundryVTT";
const CRIADOR = process.env.CRIADOR_DIR ?? join(RAIZ, "..", "criador-ficha-foundry", "src", "data");
const LIVROS_MD = process.env.LIVROS_DIR ?? join(RAIZ, "..", "tormenta-livros", "livros");

// ---------------------------------------------------------------- texto
export const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const slugify = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const slugU = (s) => slugify(s).replace(/-/g, "_"); // ids do criador de fichas / T20-DB

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", ndash: "–", mdash: "—", minus: "−", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", times: "×", divide: "÷", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", bull: "•", middot: "·", sup2: "²",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", eacute: "é", egrave: "è", ecirc: "ê", iacute: "í", icirc: "î", oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", ccedil: "ç", ntilde: "ñ",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê", Iacute: "Í", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç" };

/** HTML do compêndio → texto limpo com parágrafos. Links @UUID/@Compendium e rolagens viram só o rótulo. */
export function htmlParaTexto(html) {
  return String(html ?? "")
    .replace(/@(?:UUID|Compendium|Item|Actor)\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@(?:UUID|Compendium|Item|Actor)\[[^\]]*\]/g, "")
    .replace(/\[\[\/r(?:oll)?\s+([^\]]+?)\]\](?:\{([^}]*)\})?/g, (_, f, r) => r || f)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6]|tr|table|ul|ol)>/gi, "\n")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (t, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? ENT[e.toLowerCase()] ?? t)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Tira o "Pré-requisito(s): X" do corpo (linha própria ou colado no fim do parágrafo). */
export function separarPrereq(texto) {
  const re = /\*{0,2}Pr[ée]-?\s?requis+itos?\*{0,2}\s*:\*{0,2}[ \t]*([^\n]*)/i; // "requissito" existe no compêndio
  const m = texto.match(re);
  if (!m || !m[1].trim()) return { prereq: "", descricao: texto.trim() };
  return {
    prereq: m[1].replace(/^\*+|\*+$/g, "").replace(/\.\s*$/, "").trim(),
    descricao: texto.replace(re, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/**
 * O compêndio cola no fim do pré-requisito a marca de "habilidade mágica" (um "@", "[Magia]" ou "Magia" solto) e outras
 * marcas de tipo ("[Medo]"): tira do campo e devolve se a habilidade é mágica.
 */
export function limparPrereq(p) {
  let magica = false;
  p = String(p || "").replace(/[\s.]*(?:@|\[Magia\])\s*$/i, () => { magica = true; return ""; })
    .replace(/(?:\.\s*|\s+)Magia\s*$/, () => { magica = true; return ""; })
    .replace(/\s*\[[^\]]+\]\s*$/, "").replace(/\.\s*$/, "").trim();
  if (/^(Magia|Medo)$/i.test(p)) { magica ||= /^Magia$/i.test(p); p = ""; }
  return { prereq: p, magica };
}

// ---------------------------------------------------------------- de onde veio (livro, página)
const PACK_LIVRO = {
  "tormenta20.poderes": "Livro Básico", "tormenta20.racas": "Livro Básico", "tormenta20.classes": "Livro Básico", "tormenta20.magias": "Livro Básico",
  "tormenta20.poderes-distincao": "Distinções (livreto)",
  "suplementos-de-arton.ameacas-de-arton": "Ameaças de Arton", "suplementos-de-arton.atlas-de-arton": "Atlas de Arton",
  "suplementos-de-arton.deuses-de-arton": "Deuses de Arton", "suplementos-de-arton.guia-de-deuses-menores": "Guia de Deuses Menores",
  "suplementos-de-arton.guia-de-npcs-and-dbs": "Dragão Brasil", "suplementos-de-arton.herois-de-arton": "Heróis de Arton",
  "t20-poderes-que-faltam.poderes-que-faltam": "Libertação de Valkaria", "t20-magias-dragao-brasil.magias-dragao-brasil": "Dragão Brasil",
  "t20-raca-duplo.raca-duplo": "Caseiro",
};
export function fonteDe(src, col = "", trilha = []) {
  const s = semAcento(src || "").toLowerCase();
  let livro =
    /distincoes/.test(s) && /tormenta ?20/.test(s) ? "Distinções (livreto)"
    : /herois de arton/.test(s) ? "Heróis de Arton"
    : /deuses ?de arton/.test(s) ? "Deuses de Arton"
    : /deuses menores/.test(s) ? "Guia de Deuses Menores"
    : /ameacas/.test(s) ? "Ameaças de Arton"
    : /atlas/.test(s) ? "Atlas de Arton"
    : /dragao brasil|\bdb ?#|errata adb/.test(s) ? "Dragão Brasil"
    : /npc/.test(s) ? "Guia de NPCs"
    : /libertacao de valkaria/.test(s) ? "Libertação de Valkaria"
    : /caseira/.test(s) ? "Caseiro"
    : /jogo do ano|tormenta ?20|basico/.test(s) ? "Livro Básico" : "";
  if (!livro) {
    const t0 = trilha[0] || "";
    livro = /- DdA/.test(t0) ? "Deuses de Arton" : /- HdA/.test(t0) ? "Heróis de Arton" : /GdNPCs/.test(t0) ? "Guia de NPCs" : /Deuses de Arton/.test(t0) ? "Deuses de Arton" : PACK_LIVRO[col] || "";
  }
  const pg = String(src || "").match(/(?:p[aá]g|pg|pag|p)\s*[.,]?\s*(\d{1,3})/i);
  const ed = String(src || "").match(/#\s*(\d{2,3})/);
  return { livro, pagina: pg ? +pg[1] : null, edicao: ed ? +ed[1] : null };
}

// ---------------------------------------------------------------- nomes canônicos (o compêndio tem erro de digitação)
const NOME_CERTO = new Map(Object.entries({
  "aeronauto goblin": "Aeronauta Goblin", "guerreiro magico": "Guerreiro Mágico", "chapeu preto": "Chapéu-Preto", "caveleiro feerico": "Cavaleiro Feérico",
  "cacador de cabeca": "Caçador de Cabeças", "armadilheiro": "Armadilheiro Mestre", "mago de batalha de wynlla": "Mago de Batalha de Wynlla",
  "inventor": "Inventor", "miragem": "Miragem", "sereia tritao": "Sereia/Tritão", "kobolds": "Kobold", "tanna toh": "Tanna-Toh", "lin wu": "Lin-Wu",
  "elfo do mar": "Elfo-do-Mar", "meio orc": "Meio-Orc", "meio elfo": "Meio-Elfo", "trog anao": "Trog Anão", "gallok": "Galokk",
}));
const certo = (n) => { n = String(n || "").replace(/\s+/g, " ").trim(); return NOME_CERTO.get(norm(n)) || n; };
/**
 * Raça + linhagem. O compêndio escreve a mesma coisa de vários jeitos ("Moreau - Herança do Lobo", "Moreau do Lobo",
 * "Moreau (Lobo)"; "Aggelus", "Suraggel (Aggelus)"; "Nagah (Macho)"): devolve sempre [raça, linhagem].
 */
export function racaEVariante(n) {
  n = certo(String(n || "").replace(/Búlfalo/i, "Búfalo"));
  let m;
  if ((m = n.match(/^Moreau\s*(?:-\s*Herança d[oa]s?\s+|d[oa]s?\s+|\(\s*)([^()]+?)\s*\)?$/i))) return ["Moreau", certo(m[1])];
  if ((m = n.match(/^(?:Suraggel\s*\(\s*)?(Aggelus|Sulfure)\s*\)?$/i))) return ["Suraggel", m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()];
  if ((m = n.match(/^Nagah\s*\(\s*(Macho|Fêmea)\s*\)$/i))) return ["Nagah", m[1]];
  return [n, ""];
}
const racaCanonica = (n) => racaEVariante(n)[0];
/** Como a raça aparece na carta: "Moreau (Lobo)", "Suraggel (Aggelus)", "Anão". */
const nomeDaRaca = (n) => { const [r, v] = racaEVariante(n); return v ? `${r} (${v})` : r; };
// pastas que só organizam o compêndio: não são "uma opção dentro de uma lista"
const PASTA_GENERICA = /^(Habilidades de Classe|Poderes|Poderes de Classe.*|Poderes Raciais|.*:)$/;

const DOMINIOS = { paz: ["Marah"], honra: ["Lin-Wu"], libertadora: ["Valkaria"], sol: ["Azgher"], goblinoides: ["Thwor"], dragoes: ["Kallyadranoch"], ambicao: ["Valkaria"],
  vida: ["Lena"], conhecimento: ["Tanna-Toh"], traicao: ["Sszzaas"], mares: ["Oceano"], trapaca: ["Hyninn"], tormenta: ["Aharadak"], caos: ["Nimb"], guerra: ["Arsenal"],
  justica: ["Khalmyr"], ressurreicao: ["Thyatis"], magia: ["Wynna"], trevas: ["Tenebra"], natureza: ["Allihanna"], monstros: ["Megalokk"] };
const DEUSES_MAIORES = ["Aharadak", "Allihanna", "Arsenal", "Azgher", "Hyninn", "Kallyadranoch", "Khalmyr", "Lena", "Lin-Wu", "Marah", "Megalokk", "Nimb", "Oceano", "Sszzaas", "Tanna-Toh", "Tenebra", "Thwor", "Thyatis", "Valkaria", "Wynna"];
const EXEC = { action: "padrão", move: "movimento", full: "completa", free: "livre", reaction: "reação", passive: "", hour: "longa" };
const GERAIS = { combate: "Combate", destino: "Destino", magia: "Magia", tormenta: "Tormenta", grupo: "Grupo", geupo: "Grupo" };

/**
 * Como o poder é obtido. `acesso` é a resposta à pergunta "como eu pego isso?":
 *   raca              habilidade de raça: vem com a raça, não se escolhe nem se pega de outra forma
 *   poder-raca        poder geral que exige a raça (Heróis de Arton): escolhido no lugar de um poder de classe
 *   classe-habilidade habilidade de classe: recebida automaticamente num nível da classe
 *   classe-poder      poder de classe: escolhido quando a classe concede "Poder de <classe>"
 *   geral             poder geral (combate, destino, magia, Tormenta, grupo): qualquer um que cumpra os pré-requisitos
 *   concedido         poder concedido: só devotos da divindade
 *   origem            benefício de origem
 *   distincao         poder de distinção: só para quem foi admitido nela
 *   complicacao       complicação (regra opcional do Heróis de Arton)
 *   aventura          recompensa de uma aventura publicada (não se escolhe ao subir de nível)
 * Devolve null para o que não é poder de personagem (parceiros, montarias, habilidades de criatura).
 */
export function classificar({ col, tipo, sub, trilha, nome }) {
  const [t0 = "", t1 = "", t2 = ""] = trilha;
  const st = norm(sub);
  if (/criaturas$|compendium-extra|parceiros$/.test(col)) return null;
  if (/^(montaria|parceiros?|aliado)$/.test(st) || /Montarias$|Parceiros$/.test(t0) || /^(Montaria|Parceiro|Aliado):/.test(nome)) return null;
  if (/^Atributos - /.test(nome)) return null; // item-muleta do compêndio que só carrega os modificadores da raça
  if (nome === "Devoção Ampla") return null; // é regra de devoção (Deuses de Arton, p. 11), não um poder que se escolhe
  const r = (categoria, acesso, dono = "", extra = {}) => ({ categoria, acesso, dono: dono ? certo(dono) : "", ...extra });
  // habilidade/poder de raça: separa a linhagem (Moreau › Lobo, Suraggel › Aggelus) do nome da raça
  const raca = (acesso, bruto, extra = {}) => r("Racial", acesso, nomeDaRaca(bruto), extra);
  const opcao = (pasta) => pasta && !PASTA_GENERICA.test(pasta) ? { opcaoDe: pasta } : {};

  if (tipo === "complicacao" || /Complica[çc][õo]es/.test(t0)) return r("Complicação", "complicacao", /\(Classe\)/.test(t0) ? t1 : "");
  if (col === "tormenta20.poderes-distincao") return r("Distinção", "distincao", t0 || sub);
  if (/^Distinções - /.test(t0)) return r("Distinção", "distincao", t1, t2 ? { opcaoDe: t2 } : {});
  if (tipo === "distincao") return r("Distinção", "distincao", sub);

  // o "Golem" do Ameaças/Dragão Brasil é o golem desperto (montado por chassi + fonte de energia): outra raça, mesmo nome no compêndio
  const desperto = (n) => /^golem$/i.test(n) && /ameacas-de-arton|deuses-de-arton/.test(col) ? "Golem Desperto" : n;
  if (/Raças \(Poderes\)$/.test(t0)) {
    if (/^moreau/.test(st) || /^Moreau/.test(t2)) return raca("raca", /^moreau/.test(st) ? sub : t2); // a pasta da herança é linhagem, não lista de opções
    // kallyanach: só Herança Dracônica é fixa; o resto são as bênçãos (escolhe duas; +1 por patamar no lugar de um poder de classe)
    if (t1 === "Kallyanach" && nome !== "Herança Dracônica") return raca("raca", t1, { opcaoDe: "Bênção de Kallyadranoch" });
    return raca("raca", desperto(t1 || sub), opcao(t2));
  }
  if (/^Raças - /.test(t0)) return raca("raca", t0.replace(/^Raças - /, "").replace(/\s*\(.*$/, ""), opcao(t1));
  if (/Variantes de Suraggel/.test(t0)) return r("Racial", "raca", "Suraggel", { opcaoDe: "Herança" });
  if (/Poderes Raciais/.test(t1)) return t2 === "Várias" || !t2 ? r("Racial", "poder-raca", "", { variasRacas: true }) : raca("poder-raca", t2);
  if (t0 === "Racial") return raca("raca", t1 || sub);
  if (tipo === "racial") return raca("raca", desperto(sub || t0), /^Chassi /.test(nome) ? { opcaoDe: "Chassi" } : /^Herança de /.test(nome) && /suraggel/i.test(sub) ? { opcaoDe: "Herança" } : {});
  // "Escolhido de <deus>": recompensa da aventura Libertação de Valkaria, não um poder que se escolhe ao subir de nível
  if (st === "escolhido dos deuses" || (/Libertação de Valkaria/.test(t0) && /^Escolhido de /.test(nome))) return r("Aventura", "aventura", nome.replace(/^Escolhido de /, ""), { opcaoDe: "Escolhido dos Deuses" });

  if (/Poderes Concedidos|Concedidos:/.test(t0 + " " + t1) || tipo === "concedido") return r("Concedido", "concedido", "", { dominio: t0 === "Geral" ? t2 || t1 : /Poderes Concedidos$/.test(t0) ? t1 : "" });
  if (tipo === "origem" || /Origens/.test(t0)) return r("Origem", "origem", /^mundana$/.test(st) ? "" : sub, { grupoOrigem: /Mundanas/.test(t0) ? "Origem mundana" : /Regionais/.test(t0) ? "Origem regional" : "" });

  if (/Familiares$/.test(t0)) return r("Classe", "classe-poder", "Arcanista", { opcaoDe: "Familiar" });
  const classeDe = () => {
    if (/Classes Variantes$|- Classes$/.test(t0)) return t1;
    if (/Novos Poderes de Classe$/.test(t0)) return t1;
    if (/Novas Classes/.test(t0)) return t1.match(/\(([^)]+)\)/)?.[1] || sub;
    if (t0 === "Classe") return t1 === "Geral" ? "Qualquer classe" : t1;
    return /^melhor amigo$/.test(st) ? "Treinador" : sub;
  };
  if (tipo === "ability" && /Poderes de Grupo/.test(t1)) return r("Grupo", "geral");
  // Guia de NPCs: a pasta "Classe: > Arcanista:" só tem poderes de classe (o tipo do item vem errado)
  if (/^GdNPCs - Poderes/.test(t0) && /^Classe/.test(t1)) return r("Classe", "classe-poder", t2.replace(/:$/, "") || sub);
  // cada "Manifestação Elemental: X" do místico é uma opção DENTRO da habilidade Manifestações Elementais
  if (/^Manifestação Elemental:/.test(nome)) return r("Habilidade", "classe-habilidade", classeDe(), { opcaoDe: "Manifestações Elementais" });
  if (tipo === "ability") return r("Habilidade", "classe-habilidade", classeDe(), opcao(t2));
  if (tipo === "classe") {
    const dono = /Feiticeiro Abençoado/.test(t1) ? "Arcanista" : classeDe();
    return r("Classe", "classe-poder", dono, /^melhor amigo$/.test(st) || t2 === "Truques" ? { opcaoDe: "Melhor Amigo" } : /^Familiar \S/.test(nome) ? { opcaoDe: "Familiar" } : opcao(t2));
  }
  // gerais: o grupo vem da pasta ("Poderes de Combate") ou do subtipo
  const grupo = GERAIS[norm((t1.match(/Poderes d[aeo] (\w+)/) || [])[1])] || GERAIS[st] || (t0 === "Geral" && GERAIS[norm(t1)]) || GERAIS[norm(t1.replace(/:$/, ""))];
  if (grupo) return r(grupo, "geral");
  if (/Libertação de Valkaria/.test(t0)) return r("Destino", "geral", "", /^Escolhido de /.test(nome) ? { divindade: nome.replace(/^Escolhido de /, "") } : {});
  if (/Extras$/.test(t0)) return r("Concedido", "concedido", "", { dominio: "" });
  return r("Destino", "geral", "", { incerto: true });
}

// ---------------------------------------------------------------- pré-requisitos (texto → estrutura)
const ATRS = { for: "for", forca: "for", des: "des", destreza: "des", con: "con", constituicao: "con", int: "int", inteligencia: "int", sab: "sab", sabedoria: "sab", car: "car", carisma: "car" };
const PERICIAS = ["Acrobacia", "Adestramento", "Atletismo", "Atuação", "Cavalgar", "Conhecimento", "Cura", "Diplomacia", "Enganação", "Fortitude", "Furtividade", "Guerra", "Iniciativa", "Intimidação", "Intuição",
  "Investigação", "Jogatina", "Ladinagem", "Luta", "Misticismo", "Nobreza", "Ofício", "Percepção", "Pilotagem", "Pontaria", "Reflexos", "Religião", "Sobrevivência", "Vontade"];
const CLASSES_TODAS = ["Arcanista", "Bárbaro", "Bardo", "Bucaneiro", "Caçador", "Cavaleiro", "Clérigo", "Druida", "Guerreiro", "Inventor", "Ladino", "Lutador", "Nobre", "Paladino",
  "Treinador", "Frade", "Samurai", "Místico", "Miragem", "Alquimista", "Atleta", "Burguês", "Duelista", "Ermitão", "Inovador", "Machado de Pedra", "Magimarcialista", "Necromante", "Santo", "Seteiro", "Usurpador", "Vassalo", "Ventanista"];
/**
 * "Des 2, treinado em Luta, Ataque Poderoso, 6º nível de guerreiro" →
 * { atributos:{des:2}, pericias:["Luta"], nivel:{classe:"Guerreiro",valor:6}, poderes:["Ataque Poderoso"], outros:[] }
 * `nomesDePoder` (Map norm→nome) separa "poder exigido" de texto livre.
 */
export function estruturarPrereq(texto, nomesDePoder = new Map()) {
  const out = { atributos: {}, pericias: [], poderes: [], outros: [] };
  if (!texto) return out;
  for (let parte of texto.split(/[,;]| e (?=(?:treinad|\d+º|For|Des|Con|Int|Sab|Car)\b)/).map((s) => s.trim()).filter(Boolean)) {
    parte = parte.replace(/\.$/, "");
    const n = norm(parte);
    let m;
    if ((m = n.match(/^(for|forca|des|destreza|con|constituicao|int|inteligencia|sab|sabedoria|car|carisma) (\d+)$/))) { out.atributos[ATRS[m[1]]] = +m[2]; continue; }
    if ((m = n.match(/^(\d+) ?[oº°]? nivel de (.+)$/))) {
      const cls = CLASSES_TODAS.find((c) => norm(c) === m[2]);
      if (cls) out.nivel = { classe: cls, valor: +m[1] }; else if (/personagem/.test(m[2])) out.nivelPersonagem = +m[1]; else out.outros.push(parte);
      continue;
    }
    if ((m = parte.match(/^treinad[oa] em (.+)$/i))) {
      for (const p of m[1].split(/ e | ou /)) { const per = PERICIAS.find((x) => norm(p).startsWith(norm(x))); out.pericias.push(per ? (norm(p) === norm(per) ? per : p.trim()) : p.trim()); }
      continue;
    }
    if (nomesDePoder.has(n)) { out.poderes.push(nomesDePoder.get(n)); continue; }
    out.outros.push(parte);
  }
  return out;
}

// ---------------------------------------------------------------- leitura dos compêndios
const PACKS = [
  ...["racas", "classes", "poderes", "poderes-distincao", "magias"].map((p) => `Data/systems/tormenta20/packs/${p}`),
  ...["herois-de-arton", "deuses-de-arton", "ameacas-de-arton", "atlas-de-arton", "guia-de-deuses-menores", "guia-de-npcs-and-dbs", "distincoes"].map((p) => `Data/modules/suplementos-de-arton/packs/${p}`),
  "Data/modules/t20-poderes-que-faltam/packs/poderes-que-faltam", "Data/modules/t20-magias-dragao-brasil/packs/magias-dragao-brasil", "Data/modules/t20-raca-duplo/packs/raca-duplo",
];
async function lerPacks() {
  const { ClassicLevel } = await import(pathToFileURL(join(FOUNDRY, "Code/resources/app/node_modules/classic-level/index.js")).href);
  const out = [];
  for (const rel of PACKS) {
    const orig = join(FOUNDRY, rel);
    if (!existsSync(orig) || !statSync(orig).isDirectory()) { console.warn("! pack ausente:", rel); continue; }
    const copia = join(tmpdir(), "hub-base-" + basename(rel)); // o Foundry aberto segura o LOCK: lê de uma cópia
    rmSync(copia, { recursive: true, force: true });
    cpSync(orig, copia, { recursive: true, filter: (s) => !s.endsWith("LOCK") });
    const db = new ClassicLevel(copia, { valueEncoding: "json" });
    const pastas = {}, itens = [];
    for await (const [k, v] of db.iterator()) {
      const t = k.split("!")[1];
      if (t === "folders") pastas[v._id] = v; else if (t === "items") itens.push(v);
    }
    await db.close();
    rmSync(copia, { recursive: true, force: true });
    const col = rel.replace(/^Data\/systems\/tormenta20\/packs\//, "tormenta20.").replace(/^Data\/modules\/([^/]+)\/packs\//, "$1.");
    const trilha = (id) => !id || !pastas[id] ? [] : [...trilha(pastas[id].folder), pastas[id].name.trim()];
    for (const it of itens) out.push({ col, it, trilha: trilha(it.folder) });
  }
  return out;
}
const lerJson = (arq, padrao) => { try { return JSON.parse(readFileSync(arq, "utf-8")); } catch { return padrao; } };

// ---------------------------------------------------------------- montagem
/** Itens crus do compêndio → { poderes, base }. Puro (sem disco), pra ser testável. */
export function montar(brutos, { criador = {}, antigo = {}, revisao = {} } = {}) {
  const avisos = [];
  const porUuid = new Map(); // "pack.id" → registro do poder (pra resolver os grants das raças)
  const registros = [];
  for (const { col, it, trilha } of brutos) {
    if (it.type !== "poder") continue;
    const s = it.system || {};
    const c = classificar({ col, tipo: s.tipo, sub: s.subtipo || "", trilha, nome: it.name });
    if (!c) continue;
    const sep = separarPrereq(htmlParaTexto(s.description?.value));
    const lp = limparPrereq(sep.prereq || (typeof s.requisitos === "string" ? s.requisitos : ""));
    const descricao = sep.descricao.replace(/\s*@\s*$/, () => { lp.magica = true; return ""; }), prereq = lp.prereq;
    if (!descricao && !prereq) { avisos.push(`sem texto: ${it.name} (${col})`); continue; }
    const f = fonteDe(s.source, col, trilha);
    const reg = { ...c, nome: it.name.replace(/\s+/g, " ").trim(), col, trilha, prereq, magica: lp.magica || undefined, descricao, ...f, publicacao: s.source || "",
      custoPM: Number(s.ativacao?.custo) || 0, execucao: EXEC[s.ativacao?.execucao] ?? "", subtipoCru: s.subtipo || "" };
    registros.push(reg);
    porUuid.set(`${col}.${it._id}`, reg);
    porUuid.set(it._id, reg); // há concessões escritas com o escopo errado ("Compendium.world.…"): o id sozinho resolve
  }

  // ---- raças: o item `race` diz quais poderes a raça CONCEDE (grants) — é a prova de que são inatos
  const racas = [];
  for (const { col, it, trilha } of brutos) {
    if (it.type !== "race") continue;
    const s = it.system || {};
    const exibicao = nomeDaRaca(/^golem$/i.test(it.name) && /ameacas-de-arton/.test(col) ? "Golem Desperto" : it.name);
    const [nome, linhagem] = racaEVariante(exibicao);
    const concedidos = [];
    for (const g of s.grants || []) for (const ch of g.choices || []) {
      const m = String(ch.uuid || "").match(/^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/);
      const reg = m && (porUuid.get(`${m[1]}.${m[2]}`) || porUuid.get(m[2]));
      if (reg) { concedidos.push(reg); (reg.racasQueConcedem ??= new Set()).add(exibicao); }
      else if (m) avisos.push(`raça ${exibicao}: poder concedido não achado (${ch.uuid})`);
    }
    const attrs = Object.fromEntries(Object.entries(s.atributos || {}).filter(([, v]) => v));
    // o compêndio deixa "+1 em Três Atributos Diferentes" como texto-padrão até em raça de atributos fixos: só vale se houver lista de escolha
    const dyn = s.atributosDinamicos || {}, livres = dyn.value?.length || !/^\+1 em Três Atributos Diferentes$/.test(dyn.description || "") ? dyn.description || "" : "";
    racas.push({ nome, linhagem, col, livro: fonteDe(s.source, col, trilha).livro, atributos: attrs, atributosLivres: livres,
      deslocamento: s.movement?.walk ?? null, outrosDeslocamentos: Object.fromEntries(["fly", "swim", "climb", "burrow"].filter((k) => s.movement?.[k]).map((k) => [k, s.movement[k]])),
      tamanho: (s.tamanho || [])[0] || "", texto: htmlParaTexto(s.description?.value), _concedidos: concedidos });
  }

  // ---- junta repetidos: mesmo nome + mesmo texto = um poder com vários donos; texto diferente = poderes distintos
  const nomeBase = (r) => { const m = r.nome.match(/^(.*\S)\s*\(([^)]+)\)$/); return m && (norm(m[2]) === norm(r.dono) || /^v[aá]rias$/i.test(m[2]) || norm(racaCanonica(m[2])) === norm(racaCanonica(r.dono)) || CLASSES_TODAS.some((c) => norm(c) === norm(m[2]))) ? m[1] : r.nome; };
  const ordemPack = (r) => { const i = PACKS.findIndex((p) => p.endsWith("/" + r.col.split(".")[1])); return i < 0 ? 99 : i; };
  registros.sort((a, b) => ordemPack(a) - ordemPack(b));
  const grupos = new Map();
  for (const r of registros) {
    r.base = nomeBase(r);
    if (r.racasQueConcedem) r.donos = [...r.racasQueConcedem]; else r.donos = r.dono ? [r.dono] : [];
    const chave = norm(r.base) + "|" + r.acesso + "|" + norm(r.descricao).slice(0, 300);
    const g = grupos.get(chave);
    if (g) { for (const d of r.donos) if (!g.donos.includes(d)) g.donos.push(d); g.fontesExtras.push(r.livro); }
    else grupos.set(chave, Object.assign(r, { fontesExtras: [] }));
  }
  // o livreto de Distinções foi republicado no Heróis de Arton: se a distinção existe nos dois, fica a do livro
  const distHdA = new Set([...grupos.values()].filter((r) => r.acesso === "distincao" && r.livro !== "Distinções (livreto)").map((r) => norm(r.donos[0])));
  const unicos = [...grupos.values()].filter((r) => !(r.livro === "Distinções (livreto)" && distHdA.has(norm(r.donos[0]))));
  // o compêndio guarda algumas distinções na pasta do livro errado: vale a lista de arquivos dos livros (quando disponível)
  const semPrep = (s) => norm(s).replace(/\b(de|da|do|das|dos)\b/g, " ").replace(/\s+/g, " ").trim();
  for (const r of unicos) if (r.acesso === "distincao" && r.livro !== "Distinções (livreto)") { const l = criador.distincoesLivro?.[semPrep(r.donos[0])]; if (l && l !== r.livro) { r.livro = l; r.pagina = null; } }

  // ---- slugs estáveis: o primeiro de cada nome fica com o slug simples (igual ao hub antigo); os outros ganham o dono ou o livro
  const poderes = {};
  const sigla = { "Livro Básico": "lb", "Heróis de Arton": "hda", "Deuses de Arton": "dda", "Ameaças de Arton": "ada", "Atlas de Arton": "atlas", "Dragão Brasil": "db", "Guia de Deuses Menores": "gdm", "Guia de NPCs": "npcs", "Distinções (livreto)": "livreto" };
  for (const r of unicos) {
    let slug = slugify(r.nome);
    if (poderes[slug]) slug = slugify(`${r.base} ${r.donos[0] || ""}`);
    if (poderes[slug]) slug = slugify(`${r.base} ${r.donos[0] || ""} ${sigla[r.livro] || r.livro}`);
    for (let i = 2; poderes[slug]; i++) slug = slugify(`${r.base} ${r.donos[0] || ""} ${sigla[r.livro] || ""} ${i}`);
    r.slug = slug;
    poderes[slug] = r;
  }

  // ---- o que só existe no hub antigo (markdown do Dragão Brasil etc.) entra marcado, se parecer poder de verdade
  const nomesNovos = new Set(Object.values(poderes).map((r) => norm(r.base)));
  let herdados = 0;
  for (const [slug, t] of Object.entries(antigo)) {
    if (nomesNovos.has(norm(String(t.nome).replace(/\s*\([^)]*\)$/, ""))) || nomesNovos.has(norm(t.nome)) || poderes[slug]) continue;
    if (t.livro !== "Dragão Brasil") continue; // Heróis/Deuses já vêm inteiros do compêndio: o que sobrou do markdown era OCR quebrado
    if (!t.descricao || t.descricao.length < 40 || /\]\(.*\.md\)/.test(t.descricao)) continue;
    const cat = t.categoria;
    poderes[slug] = { slug, nome: t.nome, base: t.nome, categoria: cat, acesso: cat === "Origem" ? "origem" : "geral", dono: "", donos: cat === "Origem" && t.sub ? [t.sub] : [],
      opcaoDe: cat !== "Origem" ? t.sub || "" : "", prereq: t.prereq || "", descricao: t.descricao, livro: "Dragão Brasil", pagina: null, edicao: null, publicacao: "Dragão Brasil (compilado)", custoPM: parseInt(t.custo) || 0, execucao: "",
      col: "markdown", trilha: [], fontesExtras: [], ocr: true };
    herdados++;
  }

  // ---- concedidos: de quais deuses (subtipo com nomes, senão o domínio, senão a lista do deus no criador de fichas)
  const concedidoPor = new Map(); // slugU do poder → deuses
  for (const d of criador.divindades || []) for (const p of d.poderes_concedidos || []) (concedidoPor.get(p) ?? concedidoPor.set(p, []).get(p)).push(d.nome);
  for (const r of Object.values(poderes)) {
    if (r.acesso !== "concedido") continue;
    const doSub = String(r.subtipoCru || "").split(/,\s*/).map((x) => DEUSES_MAIORES.find((d) => norm(d) === norm(x))).filter(Boolean);
    const menor = !doSub.length && /,\s*(?:[oa]s?|d[oae]s?)\s/i.test(r.subtipoCru || "") ? [r.subtipoCru.replace(/\s+/g, " ").trim()] : [];
    r.donos = doSub.length ? [...new Set(doSub)] : menor.length ? menor : concedidoPor.get(slugU(r.base)) || DOMINIOS[norm(r.dominio)] || DOMINIOS[norm(r.subtipoCru)] || (r.subtipoCru && !DOMINIOS[norm(r.subtipoCru)] && !/^system\./.test(r.subtipoCru) ? [certo(r.subtipoCru)] : []);
    if (!r.donos.length) avisos.push(`concedido sem deus: ${r.nome} [${r.subtipoCru}]`);
  }
  for (const r of Object.values(poderes)) if (r.divindade) r.donos = [r.divindade];

  // ---- progressão de classe: em que nível cada habilidade chega (dados do criador de fichas)
  const porNomeU = new Map();
  for (const r of Object.values(poderes)) { const k = slugU(r.base); (porNomeU.get(k) ?? porNomeU.set(k, []).get(k)).push(r); }
  // o id da tabela traz o degrau junto ("ataque_furtivo_3d6", "magias_2_circulo", "casca_grossa_con_mais_1"): vai cortando
  // o fim até casar com uma habilidade DESTA classe (ou da classe base, na variante); nome inteiro pode casar com qualquer uma
  const acharHabilidade = (id, classe, base) => {
    const da = (r, c) => c && r.donos.some((d) => norm(d) === norm(c));
    const partes = id.split("_");
    for (let n = partes.length; n >= 1; n--) {
      const cands = (porNomeU.get(partes.slice(0, n).join("_")) || []).filter((r) => r.acesso.startsWith("classe-"));
      const hit = cands.find((r) => r.acesso === "classe-habilidade" && da(r, classe)) || cands.find((r) => da(r, classe)) || cands.find((r) => r.acesso === "classe-habilidade" && da(r, base)) || (n === partes.length ? cands.find((r) => r.acesso === "classe-habilidade") : null);
      if (hit) return hit;
    }
    return null;
  };
  const classes = [];
  const tabelas = { ...(criador.progressao_classes || {}), ...(criador.progressao_livros || {}) };
  for (const [id, t] of Object.entries(tabelas)) {
    const nome = t.nome || criador.classes?.[id]?.nome || CLASSES_TODAS.find((c) => slugU(c) === id) || id;
    const baseId = criador.classes_variantes?.[id], base = baseId ? criador.classes?.[baseId]?.nome || CLASSES_TODAS.find((c) => slugU(c) === baseId) || baseId : "";
    const habilidades = [];
    for (const [nivel, linha] of Object.entries(t.tabela || {})) for (const hid of linha.automaticos || []) {
      const r = acharHabilidade(hid, nome, base);
      if (r) { (r.niveis ??= {}); (r.niveis[nome] ??= []).includes(+nivel) || r.niveis[nome].push(+nivel); habilidades.push({ nivel: +nivel, poder: r.slug, nome: r.nome }); }
      else habilidades.push({ nivel: +nivel, poder: null, nome: hid });
    }
    classes.push({ id, nome, livro: t.fonte?.livro || "Livro Básico", varianteDe: base, pvPorNivel: t.pv_por_nivel ?? null, pmPorNivel: t.pm_por_nivel ?? null,
      niveisDeEscolha: Object.entries(t.tabela || {}).filter(([, l]) => l.escolhas).map(([n]) => +n), habilidades });
  }
  // classes que só existem no compêndio (Dragão Brasil): sem tabela, mas com dono
  for (const dono of new Set(Object.values(poderes).filter((r) => r.acesso.startsWith("classe-")).flatMap((r) => r.donos)))
    if (dono !== "Qualquer classe" && !classes.some((c) => norm(c.nome) === norm(dono))) classes.push({ id: slugU(dono), nome: dono, livro: "", varianteDe: "", habilidades: [], niveisDeEscolha: [], semTabela: true });
  for (const c of classes) {
    const meus = (acesso) => Object.values(poderes).filter((r) => r.acesso === acesso && r.donos.some((d) => norm(d) === norm(c.nome))).map((r) => r.slug);
    c.poderes = meus("classe-poder");
    c.habilidadesSoltas = meus("classe-habilidade").filter((s) => !c.habilidades.some((h) => h.poder === s));
    if (!c.livro) { // classe sem tabela: o livro é o da maioria das habilidades dela (um poder repetido de outro livro não decide)
      const votos = {}; for (const s of [...c.habilidadesSoltas, ...c.poderes]) votos[poderes[s].livro] = (votos[poderes[s].livro] || 0) + 1;
      c.livro = Object.entries(votos).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
  }
  // a variante escolhe da lista de poderes da classe base (Heróis de Arton)
  for (const c of classes) if (c.varianteDe) c.poderesDaBase = classes.find((b) => norm(b.nome) === norm(c.varianteDe))?.poderes || [];

  // ---- pré-requisitos estruturados: o do criador de fichas (conferido) ganha do lido do texto
  const nomesDePoder = new Map(Object.values(poderes).map((r) => [norm(r.base), r.base]));
  for (const r of Object.values(poderes)) {
    const doCriador = criador.prereqs?.[slugU(r.base)];
    r.pre = estruturarPrereq(r.prereq, nomesDePoder);
    if (doCriador) for (const q of doCriador) {
      if (q.tipo === "atributo" && q.atributo) r.pre.atributos[q.atributo] ??= q.valor;
      if (q.tipo === "nivel_classe" && !r.pre.nivel) r.pre.nivel = { classe: CLASSES_TODAS.find((c) => slugU(c) === q.classe) || q.classe, valor: q.valor };
      if (q.tipo === "nivel" && !r.pre.nivelPersonagem) r.pre.nivelPersonagem = q.valor;
      if (q.tipo === "raca" || q.tipo === "habilidade_racial") r.pre.raca ??= q.valor;
    }
  }
  // quem exige quem (o inverso do pré-requisito): "o que este poder libera?"
  const porBase = new Map(Object.values(poderes).map((r) => [norm(r.base), r]));
  for (const r of Object.values(poderes)) for (const p of r.pre.poderes) { const alvo = porBase.get(norm(p)); if (alvo && alvo !== r) (alvo.libera ??= []).push(r.slug); }

  // ---- revisão 1 a 1 (temas, resumo, correções de classificação) por cima do que foi deduzido
  let revisados = 0;
  for (const [slug, v] of Object.entries(revisao.poderes || {})) {
    const r = poderes[slug];
    if (!r) continue;
    revisados++;
    if (v.tags) r.tags = v.tags;
    if (v.resumo) r.resumo = v.resumo;
    if (v.lixo) r.lixo = true;
    if (v.acesso && v.acesso !== r.acesso) { r.acessoDeduzido = r.acesso; r.acesso = v.acesso; }
    if (v.categoria && v.categoria !== r.categoria) r.categoria = v.categoria;
    if (v.donos) r.donos = v.donos;
    if (v.opcaoDe != null) r.opcaoDe = v.opcaoDe;
    if (v.custo != null) r.custoPM = parseInt(v.custo) || 0;
    if (v.prereq != null) { r.prereq = v.prereq; r.pre = estruturarPrereq(r.prereq, nomesDePoder); }
    if (v.nota) r.nota = v.nota;
  }

  // ---- formato final do poder (compatível com o que as páginas já leem: nome, categoria, sub, livro, linha, prereq, custo, descricao)
  const ehDeRaca = (r) => r.acesso === "raca" || r.acesso === "poder-raca";
  const ROTULO = { raca: "Habilidade de raça", "poder-raca": "Poder de raça", "classe-habilidade": "Habilidade de classe", "classe-poder": "Poder de classe", geral: "Poder geral", concedido: "Poder concedido", origem: "Origem", distincao: "Distinção", complicacao: "Complicação", aventura: "Recompensa de aventura" };
  const final = {};
  for (const r of Object.values(poderes)) {
    if (r.lixo) continue;
    const sub = r.donos.length ? r.donos.slice(0, 4).join(", ") + (r.donos.length > 4 ? ` +${r.donos.length - 4}` : "") : r.variasRacas ? "Várias raças" : r.acesso === "origem" ? r.grupoOrigem || "" : "";
    const rot = r.acesso === "geral" ? `Poder ${r.categoria === "Tormenta" ? "da Tormenta" : "de " + r.categoria.toLowerCase()}` : ROTULO[r.acesso];
    final[r.slug] = {
      nome: r.nome, base: r.base !== r.nome ? r.base : undefined, categoria: r.categoria, acesso: r.acesso, sub, donos: r.donos, opcaoDe: r.opcaoDe || undefined,
      livro: r.livro, pagina: r.pagina || undefined, edicao: r.edicao || undefined, publicacao: r.publicacao,
      linha: [rot, sub, r.livro].filter(Boolean).join(" · "),
      prereq: r.prereq, pre: r.pre, custo: r.custoPM ? `${r.custoPM} PM` : "", execucao: r.execucao || undefined, descricao: r.descricao,
      niveis: r.niveis, libera: r.libera, tags: r.tags, resumo: r.resumo, nota: r.nota, magica: r.magica,
      divindade: r.acesso === "concedido" || r.divindade ? r.donos.join(", ") : undefined,
      // `raca` = o que a carta mostra ("Moreau (Lobo)"); `racas` = raças-base, pra filtrar ("Moreau")
      raca: ehDeRaca(r) ? r.donos.join(", ") || undefined : undefined, racas: ehDeRaca(r) && r.donos.length ? [...new Set(r.donos.map(racaCanonica))] : undefined,
      ocr: r.ocr, incerto: r.incerto,
    };
  }

  // ---- raças com seus poderes: habilidades inatas (as que o item da raça concede + as da pasta dela), listas de opções,
  //      linhagens (Moreau › Lobo, Suraggel › Aggelus) e os poderes de raça do Heróis de Arton
  const daRaca = (nome, acesso) => Object.entries(final).filter(([, p]) => p.acesso === acesso && p.racas?.some((d) => norm(d) === norm(nome))).map(([s]) => s);
  const daLinhagem = (slug, nome, linhagem) => final[slug].donos.some((d) => norm(d) === norm(`${nome} (${linhagem})`));
  const racasFinal = [];
  for (const nome of new Set([...racas.map((r) => r.nome), ...Object.values(final).flatMap((p) => p.racas || [])])) {
    const itens = racas.filter((r) => r.nome === nome), unico = itens.length === 1 && !itens[0].linhagem ? itens[0] : null;
    const inatos = [...new Set([...itens.flatMap((r) => r._concedidos.map((c) => c.slug)).filter((s) => final[s]), ...daRaca(nome, "raca")])];
    const nomesLinhagem = [...new Set([...itens.map((r) => r.linhagem).filter(Boolean), ...inatos.flatMap((s) => final[s].donos.map((d) => racaEVariante(d)).filter(([r, v]) => r === nome && v).map(([, v]) => v))])];
    const soDeLinhagem = (s) => nomesLinhagem.length > 0 && final[s].donos.filter((d) => racaCanonica(d) === nome).every((d) => racaEVariante(d)[1]);
    const extra = (criador.racas || []).find((x) => norm(x.nome) === norm(nome) || slugU(x.nome) === slugU(nome) || (nome === "Kobold" && x.id === "kobolds"));
    const de = unico || itens[0] || {};
    racasFinal.push({ nome, livro: de.livro || final[inatos[0]]?.livro || final[daRaca(nome, "poder-raca")[0]]?.livro || "",
      atributos: unico ? unico.atributos : {}, atributosLivres: unico?.atributosLivres || undefined,
      deslocamento: de.deslocamento ?? extra?.deslocamento ?? null, outrosDeslocamentos: de.outrosDeslocamentos && Object.keys(de.outrosDeslocamentos).length ? de.outrosDeslocamentos : undefined,
      tamanho: de.tamanho || extra?.tamanho || "", texto: unico?.texto || undefined,
      habilidades: inatos.filter((s) => !final[s].opcaoDe && !soDeLinhagem(s)), opcoes: inatos.filter((s) => final[s].opcaoDe && !soDeLinhagem(s)),
      linhagens: nomesLinhagem.length ? nomesLinhagem.map((l) => { const it = itens.find((r) => r.linhagem === l); return { nome: l, atributos: it?.atributos || {}, atributosLivres: it?.atributosLivres || undefined, texto: it?.texto || undefined, habilidades: inatos.filter((s) => daLinhagem(s, nome, l)) }; }) : undefined,
      poderesDeRaca: daRaca(nome, "poder-raca"), semItem: itens.length ? undefined : true });
  }

  const agrupar = (acesso) => {
    const m = new Map();
    for (const [slug, p] of Object.entries(final)) if (p.acesso === acesso) for (const d of p.donos.length ? p.donos : [p.nome]) (m.get(d) ?? m.set(d, { nome: d, livro: p.livro, poderes: [] }).get(d)).poderes.push(slug);
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  };
  // origens: o que o criador de fichas sabe (itens, perícias e poderes à escolha, poder único) junto dos poderes exclusivos
  const origens = agrupar("origem");
  for (const o of criador.origens || []) {
    const alvo = origens.find((x) => norm(x.nome) === norm(o.nome)) ?? origens[origens.push({ nome: o.nome, livro: "", poderes: [] }) - 1];
    const b = o.beneficios || {};
    Object.assign(alvo, { itens: (o.itens_iniciais || []).map((i) => i.item).filter(Boolean), pericias: b.pericias || [],
      poderesAEscolha: (b.poderes || []).map((id) => porNomeU.get(id)?.[0]?.slug).filter((s) => s && final[s]), poderUnico: porNomeU.get(b.poder_unico_id)?.[0]?.slug || undefined });
  }
  // divindades: quem pode ser devoto (do criador de fichas), ao lado dos poderes concedidos
  const divindades = agrupar("concedido");
  for (const d of [...(criador.divindades || []), ...(criador.deuses_menores || [])]) {
    const alvo = divindades.find((x) => norm(x.nome) === norm(d.nome) || norm(x.nome).startsWith(norm(d.nome) + " "));
    const dv = d.devotos_aceitos || d.devotos;
    if (alvo && dv) alvo.devotos = dv.regra === "qualquer" || dv.qualquer ? "qualquer um" : { racas: dv.racas_aceitas || dv.racas || [], classes: dv.classes_aceitas || dv.classes || [] };
    if (alvo) alvo.maior = DEUSES_MAIORES.includes(alvo.nome) || undefined;
  }
  // links antigos (/d/<slug do hub velho>) continuam abrindo o poder certo
  const aliases = {};
  for (const [slug, t] of Object.entries(antigo)) if (!final[slug]) { const alvo = Object.entries(final).find(([, p]) => norm(p.base || p.nome) === norm(String(t.nome).replace(/\s*\([^)]*\)$/, "")) || norm(p.nome) === norm(t.nome)); if (alvo) aliases[slug] = alvo[0]; }

  const base = { racas: racasFinal.sort((a, b) => a.nome.localeCompare(b.nome, "pt")), classes: classes.sort((a, b) => a.nome.localeCompare(b.nome, "pt")),
    divindades, origens: origens.sort((a, b) => a.nome.localeCompare(b.nome, "pt")), distincoes: agrupar("distincao"), aliases };
  return { poderes: final, base, avisos, numeros: { doCompendio: unicos.length, herdados, revisados, total: Object.keys(final).length } };
}

// ---------------------------------------------------------------- lotes da revisão 1 a 1
/** Quebra em linhas de até ~1.400 caracteres no fim de frase (a ferramenta de leitura corta linha comprida). */
export const dobrar = (t, max = 1400) => String(t || "").split("\n").flatMap((l) => {
  const out = [];
  while (l.length > max) { let i = l.lastIndexOf(". ", max); if (i < max / 3) i = l.lastIndexOf(" ", max); if (i <= 0) i = max; out.push(l.slice(0, i + 1).trim()); l = l.slice(i + 1); }
  return [...out, l];
}).join("\n");

/**
 * Escreve dados/revisao-lotes/: um arquivo de texto por lote, cada item com o que foi deduzido (pra ser conferido) e o texto.
 * Itens vizinhos ficam juntos (mesma classe, mesma raça, mesma distinção): o revisor enxerga o conjunto.
 */
function gravarLotes(poderes, base, textos) {
  const dir = join(DADOS, "revisao-lotes");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const indice = [];
  const fatiar = (tipo, itens, fmt, { maxItens = 45, maxChars = 27000 } = {}) => {
    let lote = [], chars = 0, n = 0;
    const fecha = () => {
      if (!lote.length) return;
      const arq = `${tipo}-${String(++n).padStart(2, "0")}.md`;
      writeFileSync(join(dir, arq), lote.map((x) => x.txt).join("\n\n") + "\n");
      indice.push({ arquivo: arq, tipo, itens: lote.map((x) => x.id), de: lote[0].rotulo, ate: lote.at(-1).rotulo });
      lote = []; chars = 0;
    };
    for (const it of itens) {
      const txt = fmt(it);
      if (lote.length >= maxItens || (chars + txt.length > maxChars && lote.length)) fecha();
      lote.push({ id: it.id, txt, rotulo: it.rotulo }); chars += txt.length;
    }
    fecha();
  };
  const ordem = ["raca", "poder-raca", "classe-habilidade", "classe-poder", "geral", "concedido", "origem", "distincao", "complicacao", "aventura"];
  const lp = Object.entries(poderes).map(([slug, p]) => ({ id: slug, p, rotulo: `${p.acesso}:${p.donos[0] || p.categoria}` }))
    .sort((a, b) => ordem.indexOf(a.p.acesso) - ordem.indexOf(b.p.acesso) || (a.p.donos[0] || a.p.categoria).localeCompare(b.p.donos[0] || b.p.categoria, "pt") || a.p.nome.localeCompare(b.p.nome, "pt"));
  fatiar("poderes", lp, ({ id, p }) => [`### ${id}`, `nome: ${p.nome}`, `classificado como: ${p.linha}${p.pagina ? " p. " + p.pagina : ""} [acesso=${p.acesso}${p.opcaoDe ? "; opção de: " + p.opcaoDe : ""}]`,
    `pré-requisito: ${p.prereq || "—"}`, p.custo || p.execucao ? `ativação: ${[p.execucao && "ação " + p.execucao, p.custo].filter(Boolean).join(", ")}` : "", "texto:", dobrar(p.descricao.slice(0, 2600))].filter(Boolean).join("\n"));
  const lm = Object.entries(textos).map(([slug, t]) => ({ id: slug, t, rotulo: `${t.grupo} ${t.circulo}` })).sort((a, b) => a.t.circulo - b.t.circulo || a.t.nome.localeCompare(b.t.nome, "pt"));
  fatiar("magias", lm, ({ id, t }) => [`### ${id}`, `nome: ${t.nome}`, `magia: ${t.linha}`, ...Object.entries(t.stats || {}).map(([k, v]) => `${k}: ${v}`), "texto:", dobrar(String(t.descricao || "").slice(0, 2200)),
    ...(t.aprimoramentos || []).slice(0, 8).map((a) => dobrar(`aprimoramento ${a.custo}: ${String(a.texto).slice(0, 420)}`))].join("\n"), { maxItens: 32 });
  const lr = base.racas.map((r) => ({ id: r.nome, r, rotulo: r.nome }));
  const hab = (s) => `- ${poderes[s].nome}${poderes[s].opcaoDe ? " [opção de " + poderes[s].opcaoDe + "]" : ""}: ${poderes[s].descricao.replace(/\s+/g, " ").slice(0, 520)}`;
  fatiar("racas", lr, ({ r }) => [`### ${r.nome}`, `livro: ${r.livro}`, `no compêndio (pode estar errado): atributos ${JSON.stringify(r.atributos)}${r.atributosLivres ? " + " + r.atributosLivres : ""}; deslocamento ${r.deslocamento ?? "?"}m; tamanho ${r.tamanho || "?"}`,
    r.texto ? "texto da raça:\n" + dobrar(r.texto.slice(0, 2400)) : "", "habilidades de raça (recebe todas):", ...r.habilidades.map(hab),
    ...(r.linhagens || []).flatMap((l) => [`linhagem ${l.nome} (atributos no compêndio: ${JSON.stringify(l.atributos)}${l.atributosLivres ? " + " + l.atributosLivres : ""}):`, ...l.habilidades.map(hab)]),
    r.opcoes.length ? `listas de opções: ${[...new Set(r.opcoes.map((s) => poderes[s].opcaoDe))].join(", ")} (${r.opcoes.length} itens; ex.: ${r.opcoes.slice(0, 6).map((s) => poderes[s].nome).join(", ")})` : ""].filter(Boolean).join("\n"), { maxItens: 14, maxChars: 30000 });
  writeFileSync(join(dir, "indice.json"), JSON.stringify(indice, null, 1));
  console.log(`  revisão: ${indice.length} lotes em ${dir} (${indice.filter((l) => l.tipo === "poderes").length} de poderes, ${indice.filter((l) => l.tipo === "magias").length} de magias, ${indice.filter((l) => l.tipo === "racas").length} de raças)`);
}

// ---------------------------------------------------------------- execução
async function principal() {
  const brutos = await lerPacks();
  const criador = Object.fromEntries(["prereqs", "progressao_classes", "progressao_livros", "classes", "classes_variantes", "racas", "origens", "divindades", "deuses_menores"].map((n) => [n, lerJson(join(CRIADOR, n + ".json"), null)]));
  if (!criador.prereqs) console.warn("! dados do criador de fichas não achados em", CRIADOR, "— sigo sem pré-requisitos conferidos nem progressão de classe");
  for (const k of ["racas", "origens", "divindades", "deuses_menores"]) if (criador[k] && !Array.isArray(criador[k])) criador[k] = Object.values(criador[k]);
  // de qual livro é cada distinção: a lista de arquivos dos livros em markdown (o compêndio põe duas na pasta errada)
  criador.distincoesLivro = {};
  for (const [dir, livro] of [["herois-arton/02-distincoes", "Heróis de Arton"], ["deuses-arton/03-distincoes", "Deuses de Arton"]])
    try { for (const f of readdirSync(join(LIVROS_MD, dir))) { const m = f.match(/^\d+-(.+)\.md$/); if (m && !/introducao|distincoes-em-jogo/.test(m[1])) criador.distincoesLivro[m[1].replace(/-/g, " ").replace(/\b(de|da|do|das|dos)\b/g, " ").replace(/\s+/g, " ").trim()] = livro; } } catch { console.warn("! livros em markdown não achados:", dir); }
  const antigo = lerJson(join(DADOS, "poderes.v1.json"), null) || lerJson(join(DADOS, "poderes.json"), {});
  // a primeira execução guarda o poderes.json antigo (minerado do markdown): é a fonte do que só existe lá
  if (!existsSync(join(DADOS, "poderes.v1.json")) && Object.values(antigo).some((t) => !t.acesso)) writeFileSync(join(DADOS, "poderes.v1.json"), JSON.stringify(antigo));
  // revisão 1 a 1 (temas, resumo) + correções decididas à mão a partir do que os revisores sinalizaram (tools/correcoes.json)
  const revisao = lerJson(join(DADOS, "revisao.json"), {});
  const correcoes = lerJson(join(AQUI, "correcoes.json"), {});
  revisao.poderes ??= {};
  for (const [slug, c] of Object.entries(correcoes)) if (!slug.startsWith("_")) revisao.poderes[slug] = { ...revisao.poderes[slug], ...c };
  const { poderes, base, avisos, numeros } = montar(brutos, { criador, antigo, revisao });
  for (const slug of Object.keys(correcoes)) if (!slug.startsWith("_") && !poderes[slug] && !correcoes[slug].lixo) avisos.push(`correção sem poder: ${slug}`);
  mkdirSync(DADOS, { recursive: true });
  // magias: o texto já está no hub (textos.json); do compêndio vêm o livro e a página de cada uma
  const textos = lerJson(join(DADOS, "textos.json"), {});
  const semDe = (n) => norm(String(n).replace(/\s+d[aeo]s? [A-ZÀ-Ú][\wÀ-ú'’-]+$/, "")); // "Mão Poderosa de Talude" ≈ "Mão Poderosa"
  const magiasFoundry = brutos.filter((x) => x.it.type === "magia" && !/criaturas|compendium-extra/.test(x.col));
  base.magias = {};
  for (const [slug, t] of Object.entries(textos)) {
    const x = magiasFoundry.find((m) => norm(m.it.name) === norm(t.nome)) || magiasFoundry.find((m) => semDe(m.it.name) === semDe(t.nome));
    if (x) { const f = fonteDe(x.it.system.source, x.col, x.trilha); base.magias[slug] = { livro: f.livro, pagina: f.pagina || undefined }; } else avisos.push(`magia sem par no compêndio: ${t.nome}`);
    const rv = revisao.magias?.[slug];
    if (rv) Object.assign(base.magias[slug] ??= {}, { tags: rv.tags, resumo: rv.resumo });
  }
  const soNoCompendio = magiasFoundry.filter((m) => !Object.values(textos).some((t) => norm(t.nome) === norm(m.it.name) || semDe(t.nome) === semDe(m.it.name))).map((m) => `${m.it.name} [${fonteDe(m.it.system.source, m.col, m.trilha).livro}]`);
  if (soNoCompendio.length) avisos.push(`${soNoCompendio.length} magias só no compêndio (fora do grimório): ${soNoCompendio.join("; ")}`);
  // raças: o que a revisão leu no texto (atributos, deslocamento, tamanho, tipo) ganha do campo do compêndio, que erra
  for (const r of base.racas) { const rv = revisao.racas?.[r.nome]; if (rv) Object.assign(r, { ficha: rv }); }
  writeFileSync(join(DADOS, "poderes.json"), JSON.stringify(poderes));
  writeFileSync(join(DADOS, "base.json"), JSON.stringify({ geradoEm: new Date().toISOString(), ...base }));
  if (process.argv.includes("--lotes")) gravarLotes(poderes, base, textos);
  const por = (k) => { const c = {}; for (const p of Object.values(poderes)) c[p[k]] = (c[p[k]] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${v}`).join(" · "); };
  console.log(`${numeros.total} poderes (${numeros.doCompendio} do compêndio, ${numeros.herdados} só do markdown, ${numeros.revisados} com revisão)`);
  console.log("  acesso:", por("acesso"));
  console.log("  categoria:", por("categoria"));
  console.log("  livro:", por("livro"));
  console.log(`  ${base.racas.length} raças · ${base.classes.length} classes · ${base.divindades.length} divindades · ${base.origens.length} origens · ${base.distincoes.length} distinções · ${Object.keys(base.aliases).length} links antigos redirecionados`);
  if (avisos.length) console.log(`  ${avisos.length} avisos (os 12 primeiros):\n   - ` + avisos.slice(0, 12).join("\n   - "));
  if (process.argv.includes("--avisos")) writeFileSync(join(DADOS, "base-avisos.txt"), avisos.join("\n"));
}

// ---------------------------------------------------------------- self-test
function check() {
  const erro = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) erro(`${m}: veio ${JSON.stringify(a)}, esperava ${JSON.stringify(b)}`); };
  eq(htmlParaTexto('<p>a&ccedil;&atilde;o<br>2&ordm; @UUID[Compendium.x.y.Item.z]{Luz} [[/r 2d6]] &#8211;</p><ul><li>um</li></ul>'), "ação\n2º Luz 2d6 –\n• um", "htmlParaTexto");
  eq(separarPrereq("Você voa. Pré-requisitos: Des 2, 5º nível de ladino."), { prereq: "Des 2, 5º nível de ladino", descricao: "Você voa." }, "separarPrereq colado");
  eq(separarPrereq("Texto com poderes que tenham este como pré-requisito."), { prereq: "", descricao: "Texto com poderes que tenham este como pré-requisito." }, "pré-requisito no meio da frase não é campo");
  eq(fonteDe("Tormenta20 — Edição Jogo do Ano, p. 38"), { livro: "Livro Básico", pagina: 38, edicao: null }, "fonte LB");
  eq(fonteDe("T20 - Herois de Arton (pág. 276)").livro, "Heróis de Arton", "fonte HdA sem acento");
  eq(fonteDe("Tormenta20 — Distinções, p. 12-13").livro, "Distinções (livreto)", "fonte livreto");
  eq(fonteDe("DB#220, Pag 74"), { livro: "Dragão Brasil", pagina: 74, edicao: 220 }, "fonte DB");
  eq(fonteDe("", "suplementos-de-arton.distincoes", ["Distinções - DdA", "Pregador"]).livro, "Deuses de Arton", "fonte pela pasta");
  const cl = (o) => classificar({ col: "suplementos-de-arton.herois-de-arton", tipo: "geral", sub: "", trilha: [], nome: "X", ...o });
  eq(cl({ trilha: ["HdA - Poderes Gerais", "Poderes Raciais", "Trog"], sub: "Trog" }), { categoria: "Racial", acesso: "poder-raca", dono: "Trog" }, "poder de raça do HdA");
  eq(cl({ tipo: "racial", sub: "Moreau (Lobo)", col: "suplementos-de-arton.ameacas-de-arton", trilha: ["AdA - Raças (Poderes)", "Moreau", "Moreau do Lobo"] }), { categoria: "Racial", acesso: "raca", dono: "Moreau (Lobo)" }, "habilidade de raça do AdA: herança é linhagem, não opção");
  eq(cl({ tipo: "racial", sub: "Golem", col: "suplementos-de-arton.ameacas-de-arton", trilha: ["AdA - Raças (Poderes)", "Golem", "Chassi"] }), { categoria: "Racial", acesso: "raca", dono: "Golem Desperto", opcaoDe: "Chassi" }, "golem do Ameaças é o desperto");
  eq(cl({ tipo: "ability", sub: "Vassalo", trilha: ["HdA - Classes Variantes", "Vassalo", "Habilidades de Classe"] }), { categoria: "Habilidade", acesso: "classe-habilidade", dono: "Vassalo" }, "pasta genérica não vira opção");
  eq(cl({ tipo: "racial", sub: "Kallyanach", col: "suplementos-de-arton.ameacas-de-arton", trilha: ["AdA - Raças (Poderes)", "Kallyanach"], nome: "Asas Dracônicas" }).opcaoDe, "Bênção de Kallyadranoch", "bênção de kallyanach é opção");
  eq(cl({ tipo: "racial", sub: "Kallyanach", col: "suplementos-de-arton.ameacas-de-arton", trilha: ["AdA - Raças (Poderes)", "Kallyanach"], nome: "Herança Dracônica" }).opcaoDe, undefined, "Herança Dracônica é fixa");
  eq(cl({ tipo: "ability", sub: "Arcanista", col: "suplementos-de-arton.guia-de-npcs-and-dbs", trilha: ["GdNPCs - Poderes", "Classe:", "Arcanista:"] }), { categoria: "Classe", acesso: "classe-poder", dono: "Arcanista" }, "Guia de NPCs: pasta Classe é poder de classe");
  eq(cl({ tipo: "classe", sub: "Arcanista", col: "tormenta20.poderes", trilha: ["Classe", "Arcanista"], nome: "Familiar Coruja" }).opcaoDe, "Familiar", "familiar do Livro Básico é opção de Familiar");
  eq(cl({ tipo: "geral", sub: "Escolhido dos Deuses", col: "t20-poderes-que-faltam.poderes-que-faltam", trilha: ["Libertação de Valkaria"], nome: "Escolhido de Marah" }), { categoria: "Aventura", acesso: "aventura", dono: "Marah", opcaoDe: "Escolhido dos Deuses" }, "recompensa de aventura");
  eq([limparPrereq("3º nível de arcanista. @"), limparPrereq("5º nível de frade. [Magia]"), limparPrereq("Vontade de Ferro Magia"), limparPrereq("Medo"), limparPrereq("habilidade de classe Magias, For 2.")],
    [{ prereq: "3º nível de arcanista", magica: true }, { prereq: "5º nível de frade", magica: true }, { prereq: "Vontade de Ferro", magica: true }, { prereq: "", magica: false }, { prereq: "habilidade de classe Magias, For 2", magica: false }], "limparPrereq");
  eq(separarPrereq("Texto. Pré-requissito: Bruxo ou Mago").prereq, "Bruxo ou Mago", "erro de digitação do compêndio no rótulo");
  eq(["Moreau - Herança da Hiena", "Moreau do Lobo", "Moreau (Búlfalo)", "Aggelus", "Suraggel (Sulfure)", "Nagah (Fêmea)", "Kobolds", "Anão"].map(racaEVariante),
    [["Moreau", "Hiena"], ["Moreau", "Lobo"], ["Moreau", "Búfalo"], ["Suraggel", "Aggelus"], ["Suraggel", "Sulfure"], ["Nagah", "Fêmea"], ["Kobold", ""], ["Anão", ""]], "racaEVariante");
  eq(cl({ tipo: "ability", sub: "Duelista", trilha: ["HdA - Classes Variantes", "Duelista", "x"] }).acesso, "classe-habilidade", "habilidade de variante");
  eq(cl({ tipo: "classe", sub: "Melhor Amigo", trilha: ["HdA - Classes", "Treinador", "Truques"] }), { categoria: "Classe", acesso: "classe-poder", dono: "Treinador", opcaoDe: "Melhor Amigo" }, "truque do melhor amigo");
  eq(cl({ sub: "Geupo", trilha: ["HdA - Poderes Gerais", "Poderes de Grupo"] }), { categoria: "Grupo", acesso: "geral", dono: "" }, "grupo com erro de digitação");
  eq(cl({ col: "suplementos-de-arton.distincoes", sub: "Inovação", trilha: ["Distinções - DdA", "Mestre de Armearia", "Inovações"] }), { categoria: "Distinção", acesso: "distincao", dono: "Mestre de Armearia", opcaoDe: "Inovações" }, "opção de distinção");
  eq(cl({ col: "suplementos-de-arton.ameacas-de-arton", sub: "Montaria", trilha: ["AdA - Montarias"], nome: "Montaria: Troll" }), null, "montaria não é poder");
  eq(cl({ col: "tormenta20.poderes", tipo: "concedido", sub: "Paz", trilha: ["Geral", "Concedido", "Paz"] }).acesso, "concedido", "concedido do LB");
  const nomes = new Map([["ataque poderoso", "Ataque Poderoso"]]);
  eq(estruturarPrereq("Des 2, treinado em Luta e Atletismo, Ataque Poderoso, 6º nível de guerreiro, devoto de Arsenal", nomes),
    { atributos: { des: 2 }, pericias: ["Luta", "Atletismo"], poderes: ["Ataque Poderoso"], outros: ["devoto de Arsenal"], nivel: { classe: "Guerreiro", valor: 6 } }, "estruturarPrereq");

  // montagem: raça concede (inato), mesmo nome com texto diferente vira dois, repetido funde donos, variante herda a lista da base
  const pod = (col, id, name, tipo, subtipo, desc, trilha, extra = {}) => ({ col, trilha, it: { _id: id, name, type: "poder", system: { tipo, subtipo, description: { value: `<p>${desc}</p>` }, source: "", ativacao: {}, ...extra } } });
  const brutos = [
    pod("tormenta20.poderes", "a1", "Faro", "racial", "Minotauro", "Texto de teste um: fareja quem está por perto.", ["Racial", "Minotauro"]),
    pod("suplementos-de-arton.ameacas-de-arton", "a2", "Faro", "racial", "Moreau (Lobo)", "Texto de teste um: fareja quem está por perto.", ["AdA - Raças (Poderes)", "Moreau", "Moreau do Lobo"]),
    pod("suplementos-de-arton.ameacas-de-arton", "a3", "Faro", "racial", "Gnoll", "Texto de teste dois: outra redação, bem diferente da primeira.", ["AdA - Raças (Poderes)", "Gnoll"]),
    pod("tormenta20.poderes", "b1", "Ataque Especial", "ability", "Guerreiro", "Texto de teste: golpe caprichado da classe.", ["Classe", "Guerreiro"]),
    pod("tormenta20.poderes", "b2", "Golpe Demolidor", "classe", "Guerreiro", "Texto de teste: derruba portas. Pré-requisito: For 2.", ["Classe", "Guerreiro"]),
    pod("tormenta20.poderes", "c1", "Dom da Esperança", "concedido", "Paz", "Texto de teste: fica mais difícil de derrubar.", ["Geral", "Concedido", "Paz"]),
    pod("suplementos-de-arton.herois-de-arton", "d1", "Quatro Braços (Trog)", "geral", "Trog", "Texto de teste: tem mais braços que o normal.", ["HdA - Poderes Gerais", "Poderes Raciais", "Trog"]),
    { col: "tormenta20.racas", trilha: [], it: { _id: "r1", name: "Minotauro", type: "race", system: { atributos: { for: 2, con: 1, sab: -1 }, atributosDinamicos: { value: [], description: "+1 em Três Atributos Diferentes" }, movement: { walk: 9 }, tamanho: ["med"], grants: [{ choices: [{ uuid: "Compendium.tormenta20.poderes.Item.a1" }] }] } } },
    { col: "suplementos-de-arton.ameacas-de-arton", trilha: [], it: { _id: "r2", name: "Moreau - Herança do Lobo", type: "race", system: { atributos: { car: 1 }, atributosDinamicos: { value: ["for"], description: "+1 em dois atributos" }, grants: [{ choices: [{ uuid: "Compendium.world.ameacas-de-arton.Item.a2" }] }] } } },
    pod("tormenta20.poderes", "e1", "Ataque Furtivo", "ability", "Ladino", "Texto de teste: acerta onde dói.", ["Classe", "Ladino"]),
  ];
  const criador = { progressao_classes: { guerreiro: { tabela: { 1: { automaticos: ["ataque_especial"], escolhas: 0 }, 2: { automaticos: [], escolhas: 1 }, 5: { automaticos: ["ataque_especial_8"], escolhas: 1 } } },
      ladino: { tabela: { 1: { automaticos: ["ataque_furtivo_1d6"] }, 3: { automaticos: ["ataque_furtivo_2d6", "ocr_quebrado_demais"] } } } },
    progressao_livros: { inovador: { nome: "Inovador", fonte: { livro: "Heróis de Arton" }, tabela: {} } }, classes: { guerreiro: { nome: "Guerreiro" } }, classes_variantes: { inovador: "guerreiro" },
    divindades: [{ nome: "Marah", poderes_concedidos: ["dom_da_esperanca"] }], prereqs: { golpe_demolidor: [{ tipo: "nivel_classe", classe: "guerreiro", valor: 2 }] } };
  const { poderes, base } = montar(brutos, { criador, antigo: { "faro-velho": { nome: "Faro (Minotauro)", livro: "Livro Básico" } }, revisao: { poderes: { "dom-da-esperanca": { tags: ["pv"], resumo: "Resumo de teste." } } } });
  eq(poderes.faro?.donos, ["Minotauro", "Moreau (Lobo)"], "repetido com o mesmo texto funde os donos");
  eq(poderes["faro-gnoll"]?.donos, ["Gnoll"], "mesmo nome com outro texto vira outro poder");
  eq(poderes.faro.acesso, "raca", "acesso de habilidade de raça");
  eq(poderes["ataque-especial"].niveis, { Guerreiro: [1, 5] }, "níveis da habilidade de classe (com o upgrade _8)");
  eq(poderes["golpe-demolidor"].pre.nivel, { classe: "Guerreiro", valor: 2 }, "pré-requisito do criador entra");
  eq(poderes["golpe-demolidor"].pre.atributos, { for: 2 }, "pré-requisito do texto entra");
  eq(poderes["dom-da-esperanca"].donos, ["Marah"], "concedido acha o deus pelo domínio");
  eq(poderes["dom-da-esperanca"].tags, ["pv"], "revisão aplicada");
  eq(poderes["quatro-bracos-trog"].acesso, "poder-raca", "poder de raça");
  eq(poderes["quatro-bracos-trog"].base, "Quatro Braços", "nome base sem o dono entre parênteses");
  const mino = base.racas.find((r) => r.nome === "Minotauro");
  eq([mino?.habilidades, mino?.deslocamento, mino?.atributos, mino?.atributosLivres], [["faro"], 9, { for: 2, con: 1, sab: -1 }, undefined], "raça com o que concede (texto-padrão de atributo livre é ignorado)");
  const moreau = base.racas.find((r) => r.nome === "Moreau");
  eq([moreau?.habilidades, moreau?.linhagens], [[], [{ nome: "Lobo", atributos: { car: 1 }, atributosLivres: "+1 em dois atributos", habilidades: ["faro"] }]], "linhagem: concessão com escopo 'world' resolve pelo id e fica na herança");
  eq(poderes.faro.racas, ["Minotauro", "Moreau"], "raças-base pra filtrar");
  eq(poderes["ataque-furtivo"].niveis, { Ladino: [1, 3] }, "degrau no id da tabela (ataque_furtivo_2d6) casa com a habilidade");
  eq(base.classes.find((c) => c.nome === "Ladino").habilidades.at(-1), { nivel: 3, poder: null, nome: "ocr_quebrado_demais" }, "id que não casa fica sem poder, não casa com qualquer coisa");
  eq(base.racas.find((r) => r.nome === "Trog")?.poderesDeRaca, ["quatro-bracos-trog"], "raça sem item ganha entrada pelos donos");
  const ino = base.classes.find((c) => c.nome === "Inovador");
  eq([ino?.varianteDe, ino?.poderesDaBase], ["Guerreiro", ["golpe-demolidor"]], "variante herda a lista de poderes da base");
  eq(base.aliases["faro-velho"], "faro", "link antigo redirecionado");
  const longo = dobrar("Frase um. ".repeat(300));
  if (longo.split("\n").some((l) => l.length > 1400) || longo.replace(/\s+/g, "") !== "Fraseum.".repeat(300)) erro("dobrar: linha comprida demais ou texto perdido");
  if (!process.exitCode) console.log("construir-base.mjs --check OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.argv.includes("--check") ? check() : await principal();
