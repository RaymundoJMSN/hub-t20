/**
 * tools/avaliar-arauto.mjs — prova do Arauto: faz perguntas de verdade ao cérebro (pela rota do bot) e confere se a
 * resposta traz o que tem que trazer. É o laço de "treino": mudou o prompt, o mapa do sistema (dados/arauto-primer.md)
 * ou as ferramentas → roda de novo e compara. Cada pergunta gasta uma chamada de verdade à API (centavos no Haiku).
 *
 *   node tools/avaliar-arauto.mjs                       contra http://127.0.0.1:8100 (hub local)
 *   node tools/avaliar-arauto.mjs https://rpg.raynathus.com.br
 *   node tools/avaliar-arauto.mjs <url> 3 7             só as perguntas 3 e 7
 *   node tools/avaliar-arauto.mjs <url> --ver           mostra as respostas inteiras
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
  { q: "O que faz o poder Ataque Poderoso e qual o pré-requisito?", espera: [/for(ca|ça)? 1/, /(–|-) ?2/, /\+ ?5/, /livro basico/], nota: "pergunta direta: –2 no ataque, +5 no dano, For 1" },
  { q: "Sou anão. Tem como eu pegar a habilidade Graça do elfo?", espera: [/n[aã]o/, /(ra[cç]a|elfo)/], proibe: [/pode pegar gra[cç]a como poder geral/], nota: "habilidade de raça é exclusiva" },
  { q: "Qual a diferença entre habilidade de raça e poder de raça?", espera: [/autom/, /(poder geral|no lugar de um poder|escolh)/, /herois de arton/], nota: "taxonomia" },
  { q: "Como funciona a ação de investida?", espera: [/acao completa/, /dobro/, /\+ ?2/, /(–|-) ?2 na defesa/], nota: "regra: completa, dobro do deslocamento, +2 ataque, –2 Defesa" },
  { q: "Quais poderes concedidos Marah dá e quem pode ser devoto dela?", espera: [/aura de paz/, /dom da esperanca/, /(bardo|elfo|hynne|qareen|aggelus)/], nota: "divindade: concedidos + devotos" },
  { q: "Que poderes de guerreiro não têm pré-requisito?", espera: [/guerreiro/, /\(d:[\w-]+\)/], nota: "lista por classe com filtro" },
  { q: "Quero jogar com um duende. Como a raça é montada?", espera: [/natureza/, /tamanho/, /(presente|dons)/, /herois de arton/], nota: "raça montada por escolhas" },
  { q: "Quem é Thwor Ironfist?", espera: [/(goblinoide|bugbear|duyshidakk|alianca negra|deus)/], nota: "ambientação pelos livros" },
  { q: "Tem alguma magia que me deixa mais rápido ou me dá ações extras?", espera: [/velocidade/, /\(o:[\w-]+\)/], nota: "magias por tema" },
  { q: "Quais poderes dão os maiores bônus de deslocamento em metros? Liste do maior para o menor.", espera: [/\+ ?9 ?m/, /\+ ?6 ?m/, /\(d:[\w-]+\)/], nota: "trecho com número variável: \"+#m\" (Truques de Capa +9m no topo)" },
];

const args = process.argv.slice(2), ver = args.includes("--ver");
const url = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:8100").replace(/\/$/, "");
const quais = args.filter((a) => /^\d+$/.test(a)).map(Number);
const token = JSON.parse(readFileSync(join(DADOS, "arauto.json"), "utf-8")).botToken;
const plano = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let certas = 0, total = 0, ms = 0;
for (const [i, p] of PERGUNTAS.entries()) {
  if (quais.length && !quais.includes(i + 1)) continue;
  total++;
  const r = await fetch(url + "/api/arauto/bot", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ pergunta: p.q, autor: "avaliacao" }) })
    .then((x) => x.json()).catch((e) => ({ erro: "rede", resposta: String(e) }));
  const t = plano(r.resposta || "");
  const faltou = (p.espera || []).filter((re) => !re.test(t)), sobrou = (p.proibe || []).filter((re) => re.test(t));
  const ok = !r.erro && !faltou.length && !sobrou.length;
  certas += ok; ms += r.ms || 0;
  console.log(`${ok ? "✔" : "✘"} ${i + 1}. ${p.q.slice(0, 90)}  (${((r.ms || 0) / 1000).toFixed(0)} s)${r.erro ? "  ERRO " + r.erro : ""}`
    + (faltou.length ? `\n     faltou: ${faltou.join("  ")}` : "") + (sobrou.length ? `\n     não podia: ${sobrou.join("  ")}` : ""));
  if (ver || !ok) console.log("     " + String(r.resposta || "").replace(/\n/g, "\n     ").slice(0, ver ? 6000 : 1500) + "\n");
}
console.log(`\n${certas}/${total} certas · ${(ms / 1000 / Math.max(1, total)).toFixed(0)} s por pergunta em média`);
process.exitCode = certas === total ? 0 : 1;
