// Passa as 275 oficiais MINERADAS pelo motor de custo do app (custo.mjs) e
// procura regra errada: oficial que o app BLOQUEIA, ou que estoura o orçamento.
// Complementa test-oficiais.mjs (28 recriações à mão) com cobertura total.
// Precisa do dataset local (../magias-t20/dataset.json, fora do repo — Jambo).
//   node test-corpus.mjs        resumo
//   node test-corpus.mjs -v     lista as que estouram
import { readFileSync, existsSync } from "node:fs";
import { calcular } from "./static/custo.mjs";

const tabela = JSON.parse(readFileSync(new URL("./data/tabela-custos.json", import.meta.url)));
const caminho = new URL("../magias-t20/dataset.json", import.meta.url);
if (!existsSync(caminho)) {
  console.log("dataset.json não está aqui (é local, fora do repo) — rode tools/minerar.py");
  process.exit(0);
}
const ds = JSON.parse(readFileSync(caminho));

const dados = (s) => {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(s || "");
  return m ? { n: +m[1], faces: +m[2], fixo: +(m[3] || 0) } : null;
};
const tamanhoArea = (a) => {
  const p = tabela.areas.p_max_m[a.forma] ?? 3, med = tabela.areas.m_max_m[a.forma] ?? 6;
  return (a.tamanho_m || 0) <= p ? "p" : (a.tamanho_m || 0) <= med ? "m" : "g";
};
const CATS = { execucao: Object.keys(tabela.eixos.execucao), alcance: Object.keys(tabela.eixos.alcance),
               duracao: Object.keys(tabela.eixos.duracao) };
const cat = (eixo, v, padrao) => CATS[eixo].includes(v) ? v : padrao;

function paraMagia(m) {
  const a = m.alvo || {};
  const alvo = a.tipo === "area" ? { tipo: "area", tamanho: tamanhoArea(a), forma: a.forma, metros: a.tamanho_m }
    : a.tipo === "pessoal" ? { tipo: "pessoal" }
    : { tipo: "alvos", qtd: a.qtd === "escolhidas" ? "escolhidas" : Number(a.qtd) || 1,
        restrito: a.restrito ? "humanoides" : null };
  const efeitos = {};
  if (m.dano) efeitos.dano = { ...dados(m.dano.dados), tipo: m.dano.tipo || "fogo" };
  if (m.cura) efeitos.cura = dados(m.cura.dados);
  // Infligir Ferimentos e cia: dano OU cura são modos alternativos, conta o maior
  if (efeitos.dano && efeitos.cura) delete efeitos[(efeitos.dano.n * efeitos.dano.faces) >= (efeitos.cura.n * efeitos.cura.faces) ? "cura" : "dano"];
  if (m.condicoes?.length) efeitos.condicoes = m.condicoes;
  if (m.modificador) efeitos[m.modificador.valor < 0 ? "penalidade" : "bonus"] =
    [{ valor: Math.abs(m.modificador.valor), em: m.modificador.em, escopo: "especifico" }];
  const teste = m.resistencia?.teste;
  return {
    nome: m.nome, circulo: m.circulo, escola: m.escola, aprimoramentos: [],
    eixos: {
      execucao: cat("execucao", m.execucao?.cat, "padrao"),
      alcance: cat("alcance", m.alcance?.cat, "curto"),
      duracao: cat("duracao", m.duracao?.cat, "instantanea"),
      resistencia: m.resistencia?.modo === "especial" ? "nenhuma" : (m.resistencia?.modo || "nenhuma"),
      teste: teste ? teste[0].toUpperCase() + teste.slice(1) : "Vontade",
      alvo,
    },
    efeitos,
  };
}

let bloqueadas = 0, estouram = 0;
const porCirculo = {};
const listaEstouro = [];
for (const bruta of ds.magias) {
  const m = paraMagia(bruta);
  const r = calcular(m, tabela);
  const c = m.circulo;
  (porCirculo[c] ||= { n: 0, dentro: 0, estoura: 0, bloq: 0, totais: [] });
  const p = porCirculo[c];
  p.n++; p.totais.push(r.total);
  if (r.bloqueada) { p.bloq++; bloqueadas++; console.log(`  BLOQUEADA ${c}º ${m.nome}: ${r.avisos.filter((a) => /não|nunca|só/.test(a)).join(" | ")}`); }
  else if (r.total > r.limiteAval) { p.estoura++; estouram++; listaEstouro.push([r.total, r.orcamento, c, m.nome]); }
  else p.dentro++;
}
for (const [c, p] of Object.entries(porCirculo)) {
  const ord = [...p.totais].sort((a, b) => a - b);
  const med = ord[Math.floor(ord.length / 2)];
  console.log(`${c}º n=${String(p.n).padStart(3)}  mediana=${String(med).padStart(5)}/${tabela.orcamento[c]}  dentro=${p.dentro}  estoura=${p.estoura}  BLOQUEADA=${p.bloq}`);
}
if (process.argv.includes("-v")) {
  console.log("-- estouram --");
  for (const [t, o, c, n] of listaEstouro.sort((a, b) => b[0] / b[1] - a[0] / a[1]).slice(0, 20)) console.log(`  ${t}/${o} ${c}º ${n}`);
}
console.log(`total: ${ds.magias.length} oficiais · ${bloqueadas} bloqueadas · ${estouram} acima da margem de aval`);
// uma oficial bloqueada = regra do app proibindo o que o jogo faz
if (bloqueadas) { console.error("FALHA: oficial bloqueada pelo motor"); process.exitCode = 1; }
else console.log("test-corpus OK");
