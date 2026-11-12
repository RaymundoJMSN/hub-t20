/**
 * tools/avaliar-arauto.mjs — prova do Arauto: faz perguntas de verdade ao cérebro (pela rota do bot) e confere se a
 * resposta traz o que tem que trazer. É o laço de "treino": mudou o prompt, o mapa do sistema (dados/arauto-primer.md),
 * as ferramentas ou o modelo → roda de novo e compara. Cada pergunta gasta uma chamada de verdade à API.
 *
 *   node tools/avaliar-arauto.mjs                       contra http://127.0.0.1:8100 (hub local)
 *   node tools/avaliar-arauto.mjs https://rpg.raynathus.com.br
 *   node tools/avaliar-arauto.mjs <url> 3 7             só as perguntas 3 e 7
 *   node tools/avaliar-arauto.mjs <url> --ver           mostra as respostas inteiras
 *   node tools/avaliar-arauto.mjs <url> --construcao    as perguntas de CONSTRUÇÃO de personagem (modo profundo): mede quantas das
 *                                                       opções que não podem faltar a resposta traz, o tempo e o custo de cada uma
 *
 * `espera` = trechos que a resposta precisa conter (regex, sem diferenciar maiúscula/acento); `proibe` = o que não pode.
 * Os gabaritos vêm dos livros (conferidos no primer verificado), não de memória.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = join(dirname(fileURLToPath(import.meta.url)), "..", "dados");
const PERGUNTAS = [
  { q: "to tentando fazer um personagem focado em ser veloz, me fale poderes ou raças que me dariam mais movimentação, ou poderes relacionados a investidas",
    espera: [/atletico/, /elfo/, /12 ?m/, /investida/, /\(d:[\w-]+\)/, /p\. ?\d+/], nota: "a pergunta do Ray: raças 12m, Atlético (+3m), poderes de investida, com fonte e links" },
  { q: "O que faz o poder Ataque Poderoso e qual o pré-requisito?", espera: [/for(ca|ça)? 1/, /[–−-] ?2/, /\+ ?5/, /livro basico/], nota: "pergunta direta: –2 no ataque, +5 no dano, For 1" },
  { q: "Sou anão. Tem como eu pegar a habilidade Graça do elfo?", espera: [/n[aã]o/, /(ra[cç]a|elfo)/], proibe: [/pode pegar gra[cç]a como poder geral/], nota: "habilidade de raça é exclusiva" },
  { q: "Qual a diferença entre habilidade de raça e poder de raça?", espera: [/autom/, /(poder geral|no lugar de um poder|escolh)/, /herois de arton/], nota: "taxonomia" },
  { q: "Como funciona a ação de investida?", espera: [/acao completa/, /dobro/, /\+ ?2/, /[–−-] ?2 na defesa/], nota: "regra: completa, dobro do deslocamento, +2 ataque, –2 Defesa" },
  { q: "Quais poderes concedidos Marah dá e quem pode ser devoto dela?", espera: [/aura de paz/, /dom da esperanca/, /(bardo|elfo|hynne|qareen|aggelus)/], nota: "divindade: concedidos + devotos" },
  { q: "Que poderes de guerreiro não têm pré-requisito?", espera: [/guerreiro/, /\(d:[\w-]+\)/], nota: "lista por classe com filtro" },
  { q: "Quero jogar com um duende. Como a raça é montada?", espera: [/natureza/, /tamanho/, /(presente|dons)/, /herois de arton/], nota: "raça montada por escolhas" },
  { q: "Quem é Thwor Ironfist?", espera: [/(goblinoide|bugbear|duyshidakk|alianca negra|deus)/], nota: "ambientação pelos livros" },
  { q: "Tem alguma magia que me deixa mais rápido ou me dá ações extras?", espera: [/velocidade/, /\(o:[\w-]+\)/], nota: "magias por tema" },
  { q: "Quais poderes dão os maiores bônus de deslocamento em metros? Liste do maior para o menor.", espera: [/\+ ?9 ?m/, /\+ ?6 ?m/, /\(d:[\w-]+\)/], nota: "trecho com número variável: \"+#m\" (Truques de Capa +9m no topo)" },
];

// Perguntas de construção: `essenciais` = o que uma boa resposta NÃO pode deixar de fora; `boas` = o que soma. Os gabaritos saem do
// panorama do tema no próprio acervo (node server.mjs --ferramenta panorama temas=…); o do "veloz" é a ficha do Velocista do Ray.
const CONSTRUCAO = [
  { q: "Quero um personagem focado em ser veloz: que raças e poderes me dão mais movimentação?", minimo: 0.8,
    essenciais: [["Moreau (Coelho) / Patas Ligeiras", /coelho|patas ligeiras/], ["Reflexos de Combate", /reflexos de combate/], ["Acrobático", /acrobatico/], ["Ímpeto", /impeto/],
      ["Criado pelas Voracis", /criad[oa] p\w+ voracis/], ["Atlético", /atletico/], ["magia Velocidade", /o:velocidade\)/], ["poção ou item de Velocidade", /pocao|botas velozes/],
      ["Primor Atlético", /primor atletico/], ["raça de 12m", /elfo|velocis|satiro|centauro/]],
    boas: [["Velocidade Ladina", /velocidade ladina/], ["Botas Velozes", /botas velozes/], ["Truques de Capa", /truques de capa/], ["Caminhos da Natureza", /caminhos da natureza/], ["montaria", /montaria|cavalo/], ["conta feita em metros", /= ?\**\d+ ?m/]],
    proibe: [["dizer que Caminhos da Natureza não serve para o próprio conjurador", /caminhos da natureza[^.\n]{0,120}nao (e|serve) para voce/]] },
  { q: "Meu caçador de 5º nível quer ser o mais rápido possível em combate. O que eu pego nos próximos níveis?", minimo: 0.75,
    essenciais: [["Ímpeto", /impeto/], ["Reflexos de Combate", /reflexos de combate/], ["Atlético", /atletico/], ["Acrobático", /acrobatico/], ["terreno difícil (Explorador)", /explorador|terreno dificil/], ["magia ou poção de Velocidade", /velocidade/]],
    boas: [["ordem por nível", /\b[6-9]º|1[0-9]º|nivel [6-9]/], ["Escaramuça", /escaramuca/], ["Botas Velozes", /botas velozes/]] },
  { q: "Quero um personagem que consiga voar. Quais são as opções?", minimo: 0.75,
    essenciais: [["Harpia", /harpia/], ["Sílfide", /silfide/], ["Moreau (Morcego)", /morcego/], ["Kallyanach", /kallyanach/], ["magia Voo", /o:voo\)/], ["Botas Aladas", /botas aladas/], ["Tapete Voador", /tapete voador/], ["montaria voadora", /pegaso|grifo/]],
    boas: [["Pteros", /pteros/], ["Tengu", /tengu/], ["Vassoura Voadora", /vassoura voadora/], ["Encanto Alado", /encanto alado/], ["poção de Voo", /pocao/]] },
];
// preço por milhão de tokens (entrada, saída, leitura de cache); escrita de cache = 1,25 × entrada. Fonte: catálogo de modelos da Anthropic.
// O do Haiku 5.5 vale para pedidos de até 100 mil tokens; a leitura de cache dele é estimada em 10% da entrada.
const PRECO = { "claude-haiku-5-5": [0.1, 0.5, 0.01], "claude-sonnet-5-5": [2, 10, 0.1], "claude-opus-5-5": [4, 20, 0.2], "claude-fable-5-2": [8, 40, 0.2] };
const custoDe = (modelo, u) => { const p = PRECO[modelo]; return p && u ? (u.entrada * p[0] + u.saida * p[1] + u.cacheLido * p[2] + u.cacheEscrito * p[0] * 1.25) / 1e6 : null; };

const args = process.argv.slice(2), ver = args.includes("--ver");
const url = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:8100").replace(/\/$/, "");
const quais = args.filter((a) => /^\d+$/.test(a)).map(Number);
const token = JSON.parse(readFileSync(join(DADOS, "arauto.json"), "utf-8")).botToken;
const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"); // acentos soltos depois do NFD
const plano = (s) => s.normalize("NFD").replace(MARCAS, "").toLowerCase();
const perguntar = (q) => fetch(url + "/api/arauto/bot", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ pergunta: q, autor: "avaliacao" }) })
  .then((x) => x.json()).catch((e) => ({ erro: "rede", resposta: String(e) }));

if (args.includes("--construcao")) {
  let passou = 0, n = 0, gasto = 0;
  for (const [i, p] of CONSTRUCAO.entries()) {
    if (quais.length && !quais.includes(i + 1)) continue;
    n++;
    const r = await perguntar(p.q), t = plano(r.resposta || "");
    const tem = (lista) => (lista || []).filter(([, re]) => re.test(t)).map(([rot]) => rot), falta = (lista) => (lista || []).filter(([, re]) => !re.test(t)).map(([rot]) => rot);
    const nota = tem(p.essenciais).length / p.essenciais.length, erros = tem(p.proibe), custo = custoDe(r.modelo, r.uso);
    const ok = !r.erro && nota >= p.minimo && !erros.length;
    passou += ok; gasto += custo || 0;
    console.log(`${ok ? "✔" : "✘"} ${i + 1}. ${p.q}\n     essenciais ${tem(p.essenciais).length}/${p.essenciais.length} · boas ${tem(p.boas).length}/${(p.boas || []).length} · ${r.modo || "?"} (${r.modelo || "?"}) · ${((r.ms || 0) / 1000).toFixed(0)} s · ${r.uso?.chamadas ?? "?"} chamadas · saída ${r.uso?.saida ?? "?"} tokens${custo != null ? ` · US$ ${custo.toFixed(3)}` : ""} · ${(r.resposta || "").length} caracteres${r.erro ? "  ERRO " + r.erro : ""}`
      + (falta(p.essenciais).length ? `\n     FALTOU: ${falta(p.essenciais).join(" · ")}` : "") + (falta(p.boas).length ? `\n     não citou (bom ter): ${falta(p.boas).join(" · ")}` : "") + (erros.length ? `\n     ERRO DE CONTEÚDO: ${erros.join(" · ")}` : ""));
    if (ver) console.log("\n" + String(r.resposta || "") + "\n");
  }
  console.log(`\n${passou}/${n} passaram · US$ ${gasto.toFixed(3)} no total`);
  process.exit(passou === n ? 0 : 1);
}

let certas = 0, total = 0, ms = 0;
for (const [i, p] of PERGUNTAS.entries()) {
  if (quais.length && !quais.includes(i + 1)) continue;
  total++;
  const r = await perguntar(p.q);
  const t = plano(r.resposta || "");
  const faltou = (p.espera || []).filter((re) => !re.test(t)), sobrou = (p.proibe || []).filter((re) => re.test(t));
  const ok = !r.erro && !faltou.length && !sobrou.length;
  certas += ok; ms += r.ms || 0;
  console.log(`${ok ? "✔" : "✘"} ${i + 1}. ${p.q.slice(0, 90)}  (${((r.ms || 0) / 1000).toFixed(0)} s · ${r.modo || "?"})${r.erro ? "  ERRO " + r.erro : ""}`
    + (faltou.length ? `\n     faltou: ${faltou.join("  ")}` : "") + (sobrou.length ? `\n     não podia: ${sobrou.join("  ")}` : ""));
  if (ver || !ok) console.log("     " + String(r.resposta || "").replace(/\n/g, "\n     ").slice(0, ver ? 6000 : 1500) + "\n");
}
console.log(`\n${certas}/${total} certas · ${(ms / 1000 / Math.max(1, total)).toFixed(0)} s por pergunta em média`);
process.exitCode = certas === total ? 0 : 1;
