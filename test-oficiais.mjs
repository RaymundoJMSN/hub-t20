// Recriação manual de magias oficiais em TODOS os círculos — node test-oficiais.mjs
// Cada magia é montada como um jogador montaria no wizard; o teste confere em qual
// faixa ela cai: VÁLIDA (≤ orçamento), AVAL (margem do mestre) ou ESTOUROU.
// É o teste de regressão do balanceamento por círculo.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { calcular } from "./static/custo.mjs";

const tabela = JSON.parse(readFileSync(new URL("./data/tabela-custos.json", import.meta.url)));

const M = (circulo, eixos, efeitos, escola) => ({ circulo, escola, eixos, efeitos, aprimoramentos: [] });
const alvo1 = { tipo: "alvos", qtd: 1 };

// esperado: "valida" | "aval" | "estoura" | "folgada" (vale, mas bem abaixo — gap documentado)
const CASOS = [
  // ---- 1º círculo (10 pts) ----
  ["1º", "Toque Chocante", "valida", M(1,
    { execucao: "padrao", alcance: "toque", duracao: "instantanea", resistencia: "reduz-metade", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 2, faces: 8, fixo: 2, tipo: "eletricidade" } })],
  ["1º", "Curar Ferimentos", "valida", M(1,
    { execucao: "padrao", alcance: "toque", duracao: "instantanea", resistencia: "nenhuma", alvo: alvo1 },
    { cura: { n: 2, faces: 8, fixo: 2 } })],
  ["1º", "Sono", "valida", M(1,
    { execucao: "padrao", alcance: "curto", duracao: "cena", resistencia: "anula", teste: "Vontade", alvo: alvo1 },
    { condicoes: ["inconsciente"] })],
  ["1º", "Explosão de Chamas", "valida", M(1,
    { execucao: "padrao", alcance: "pessoal", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "p", forma: "cone", metros: 6 } },
    { dano: { n: 2, faces: 6, fixo: 0, tipo: "fogo" } })],
  ["1º", "Adaga Mental", "aval", M(1,  // psíquico paga +2 (v9)
    { execucao: "padrao", alcance: "curto", duracao: "instantanea", resistencia: "parcial", teste: "Vontade", alvo: alvo1 },
    { dano: { n: 2, faces: 6, fixo: 0, tipo: "psíquico" }, condicoes: ["atordoado"] })],
  ["1º", "Amedrontar (só humanoide/animal)", "valida", M(1,
    { execucao: "padrao", alcance: "curto", duracao: "cena", resistencia: "parcial", teste: "Vontade", alvo: { ...alvo1, restrito: "animais" } },
    { condicoes: ["apavorado"] })],

  // ---- 2º círculo (18 pts) ----
  ["2º", "Bola de Fogo", "valida", M(2,
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "m", forma: "esfera", metros: 6 } },
    { dano: { n: 6, faces: 6, fixo: 0, tipo: "fogo" } })],
  ["2º", "Relâmpago", "valida", M(2,
    { execucao: "padrao", alcance: "pessoal", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "m", forma: "linha", metros: 30 } },
    { dano: { n: 6, faces: 6, fixo: 0, tipo: "eletricidade" } })],
  ["2º", "Punição do Profano", "valida", M(2,
    { execucao: "padrao", alcance: "curto", duracao: "instantanea", resistencia: "reduz-metade", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 6, faces: 8, fixo: 0, tipo: "trevas" } })],
  ["2º", "Miasma Mefítico", "valida", M(2,
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "reduz-metade", teste: "Fortitude", alvo: { tipo: "area", tamanho: "m", forma: "nuvem", metros: 6 } },
    { dano: { n: 5, faces: 6, fixo: 0, tipo: "veneno" } })],
  ["2º", "Toque Vampírico (rouba vida = custom)", "aval", M(2,
    { execucao: "padrao", alcance: "toque", duracao: "instantanea", resistencia: "reduz-metade", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 6, faces: 6, fixo: 0, tipo: "trevas" }, custom: { texto: "você recupera PV iguais à metade do dano causado", pontos: 2 } })],
  ["2º", "Sussurros Insanos", "folgada", M(2,
    { execucao: "padrao", alcance: "curto", duracao: "cena", resistencia: "anula", teste: "Vontade", alvo: alvo1 },
    { condicoes: ["confuso"] })],

  // ---- 3º círculo (25 pts) ----
  ["3º", "Coluna de Chamas", "valida", M(3,
    { execucao: "padrao", alcance: "longo", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "p", forma: "cilindro", metros: 3 } },
    { dano: { n: 6, faces: 6, fixo: 0, tipo: "fogo" } })],
  ["3º", "Hálito Peçonhento", "valida", M(3,
    { execucao: "padrao", alcance: "pessoal", duracao: "instantanea", resistencia: "parcial", teste: "Fortitude", alvo: { tipo: "area", tamanho: "m", forma: "cone", metros: 9 } },
    { dano: { n: 4, faces: 8, fixo: 0, tipo: "veneno" } })],
  ["3º", "Erupção Glacial", "valida", M(3,
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "parcial", teste: "Reflexos", alvo: { tipo: "area", tamanho: "m", forma: "quadrado", metros: 6 } },
    { dano: { n: 4, faces: 6, fixo: 0, tipo: "frio" } })],
  ["3º", "Ferver Sangue", "aval", M(3,
    { execucao: "padrao", alcance: "curto", duracao: "sustentada", resistencia: "parcial", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 4, faces: 8, fixo: 0, tipo: "fogo" }, condicoes: ["enjoado"] })],
  ["3º", "Imobilizar", "folgada", M(3,
    { execucao: "padrao", alcance: "curto", duracao: "cena", resistencia: "parcial", teste: "Vontade", alvo: alvo1 },
    { condicoes: ["paralisado", "lento"] })],
  ["3º", "Toque Álgido", "estoura", M(3,
    { execucao: "padrao", alcance: "toque", duracao: "instantanea", resistencia: "parcial", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 6, faces: 8, fixo: 0, tipo: "frio" }, condicoes: ["paralisado", "enredado"] })],

  // ---- 4º círculo (34 pts) ----
  ["4º", "Raio de Plasma", "aval", M(4,  // essência paga +2 (v9)
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "m", forma: "linha", metros: 30 } },
    { dano: { n: 10, faces: 8, fixo: 0, tipo: "essência" } })],
  ["4º", "Cólera de Azgher", "aval", M(4,
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "parcial", teste: "Reflexos", alvo: { tipo: "area", tamanho: "m", forma: "esfera", metros: 6 } },
    { dano: { n: 10, faces: 6, fixo: 0, tipo: "fogo" }, condicoes: ["em chamas"] })],
  ["4º", "Muralha de Ossos (parte numérica)", "valida", M(4,
    { execucao: "padrao", alcance: "medio", duracao: "cena", resistencia: "nenhuma", alvo: alvo1 },
    { dano: { n: 4, faces: 8, fixo: 0, tipo: "corte" } })],
  ["4º", "Assassino Fantasmagórico", "folgada", M(4,
    { execucao: "padrao", alcance: "longo", duracao: "cena", resistencia: "anula", teste: "Vontade", alvo: alvo1 },
    { condicoes: ["inconsciente", "sangrando"] })],
  ["4º", "Desintegrar", "estoura", M(4,
    { execucao: "padrao", alcance: "medio", duracao: "instantanea", resistencia: "parcial", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 10, faces: 12, fixo: 0, tipo: "essência" } })],

  // ---- 5º círculo (45 pts) ----
  ["5º", "Chuva de Meteoros", "valida", M(5,
    { execucao: "completa", alcance: "longo", duracao: "instantanea", resistencia: "parcial", teste: "Reflexos", alvo: { tipo: "area", tamanho: "g", forma: "quadrado", metros: 18 } },
    { dano: { n: 15, faces: 6, fixo: 0, tipo: "fogo" } })],
  ["5º", "Katana Celestial", "valida", M(5,
    { execucao: "padrao", alcance: "pessoal", duracao: "instantanea", resistencia: "parcial", teste: "Reflexos", alvo: { tipo: "area", tamanho: "g", forma: "linha", metros: 30 } },
    { dano: { n: 12, faces: 8, fixo: 0, tipo: "luz" } })],
  ["5º", "Toque da Morte", "valida", M(5,
    { execucao: "padrao", alcance: "toque", duracao: "instantanea", resistencia: "parcial", teste: "Fortitude", alvo: alvo1 },
    { dano: { n: 10, faces: 8, fixo: 10, tipo: "trevas" } })],
  ["5º", "Possessão", "folgada", M(5,
    { execucao: "padrao", alcance: "longo", duracao: "1dia", resistencia: "anula", teste: "Vontade", alvo: alvo1 },
    { condicoes: ["inconsciente"], custom: { texto: "você controla o corpo do alvo", pontos: 12 } })],
  ["5º", "Mata-Dragão", "estoura", M(5,
    { execucao: "longa", alcance: "pessoal", duracao: "instantanea", resistencia: "reduz-metade", teste: "Reflexos", alvo: { tipo: "area", tamanho: "g", forma: "cone", metros: 30 } },
    { dano: { n: 20, faces: 12, fixo: 0, tipo: "essência" } })],
];

let falhas = 0;
let circuloAtual = "";
for (const [circ, nome, esperado, magia] of CASOS) {
  if (circ !== circuloAtual) { circuloAtual = circ; console.log(`\n--- ${circ} círculo (orçamento ${tabela.orcamento[circ[0]]}) ---`); }
  const r = calcular(magia, tabela);
  const status = r.valido ? (r.total <= r.orcamento * 0.7 ? "folgada" : "valida")
    : r.precisaAval ? "aval" : "estoura";
  const ok = status === esperado ||
    (esperado === "valida" && status === "folgada") || (esperado === "folgada" && status === "valida");
  if (magia.escola && r.bloqueada) { falhas++; console.log(`  BLOQUEADA por escola?! ${nome}`); }
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome.padEnd(38)} ${String(r.total).padStart(5)}/${r.orcamento}  ${status}${ok ? "" : `  (esperado ${esperado})`}`);
}

console.log(falhas ? `\n${falhas} caso(s) fora do esperado` : "\ntest-oficiais OK");
assert.equal(falhas, 0);
