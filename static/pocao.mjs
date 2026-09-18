// "Itens de uso único" (LB p. 341): uma poção só pode conter magia que tenha
// como alvo uma criatura ou objeto, ou que tenha efeito em área. O nome muda
// com o alvo: objeto = óleo, área = granada, o resto é poção.
//
// As regex são as mesmas do módulo t20-fabricar (scripts/regras.mjs), que é
// quem faz a escolha valendo na mesa — a diferença é que lá alvo e área são
// campos separados do sistema e aqui vem tudo numa linha só ("Alvo/Área").
//
//   node static/pocao.mjs --check

// (dois ajustes sobre as de lá, por causa do texto das oficiais: "linha" sozinha
// — Raio de Plasma — e o plural "mortos-vivos" — Conjurar Mortos-Vivos)
const TEM_OBJETO = /objeto|arma|armadura|escudo|item/i;
const TEM_AREA = /[áa]rea|esfera|cone|cilindro|cubo|\blinha\b|quadrado|raio|nuvem/i;
const TEM_CRIATURA = /criatura|voc[êe]|aliad|alvo|humanoide|animal|mortos?-vivos?|esp[íi]rito|inimig|pessoa/i;

/** "esfera com 6m de raio" -> "granada"; "1 arma" -> "óleo"; "você" -> "poção"; "veja texto" -> null. */
export function tipoDePocao(alvoOuArea) {
  const t = String(alvoOuArea || "").trim();
  if (!t) return null;
  if (TEM_AREA.test(t)) return "granada";
  if (TEM_OBJETO.test(t)) return "óleo";
  if (TEM_CRIATURA.test(t)) return "poção";
  return null;                                  // sem alvo nem área: não vira item
}

/** Mesma pergunta a partir dos eixos de uma magia criada na mesa. */
export const tipoDePocaoDosEixos = (alvo) =>
  !alvo ? null : tipoDePocao(alvo.tipo === "area" ? "área" : alvo.tipo === "pessoal" ? "você" : (alvo.restrito || "criatura"));

/** "granada de Bola de Fogo" — é assim que o item se chama. */
export const nomeDoItem = (tipo, nomeMagia) => tipo ? `${tipo} de ${nomeMagia}` : "";

// só quando ESTE arquivo é o que foi chamado (o server.mjs --check também importa daqui)
if (typeof process !== "undefined" && process.argv?.includes("--check") && /pocao\.mjs$/.test(process.argv[1] || "")) {
  const eq = (o, e, q) => { if (o !== e) { console.error(`FALHOU ${q}: ${o} != ${e}`); process.exitCode = 1; } };
  eq(tipoDePocao("esfera com 6m de raio"), "granada", "área vira granada");
  eq(tipoDePocao("cone de 9m"), "granada", "cone vira granada");
  eq(tipoDePocao("1 objeto"), "óleo", "objeto vira óleo");
  eq(tipoDePocao("1 arma empunhada"), "óleo", "arma vira óleo");
  eq(tipoDePocao("1 criatura"), "poção", "criatura vira poção");
  eq(tipoDePocao("você"), "poção", "pessoal vira poção");
  eq(tipoDePocao("linha"), "granada", "linha sozinha é área (Raio de Plasma)");
  eq(tipoDePocao("6 mortos-vivos"), "poção", "plural de morto-vivo (Conjurar Mortos-Vivos)");
  eq(tipoDePocao("veja texto"), null, "sem alvo não vira item");
  eq(tipoDePocao(""), null, "vazio não vira item");
  eq(tipoDePocaoDosEixos({ tipo: "area", forma: "esfera" }), "granada", "eixo área");
  eq(tipoDePocaoDosEixos({ tipo: "alvos", restrito: "objetos" }), "óleo", "eixo objeto");
  eq(tipoDePocaoDosEixos({ tipo: "alvos", qtd: 1 }), "poção", "eixo criatura");
  eq(tipoDePocaoDosEixos({ tipo: "pessoal" }), "poção", "eixo pessoal");
  eq(nomeDoItem("granada", "Bola de Fogo"), "granada de Bola de Fogo", "nome do item");
  if (!process.exitCode) console.log("pocao.mjs --check OK");
}
