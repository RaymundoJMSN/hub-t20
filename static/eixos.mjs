// Linha técnica de uma magia oficial -> as chaves canônicas do criador.
// O dataset das oficiais é texto livre ("ação padrão", "curtoAlvo ou", "Vontade
// parcial.", "Reflexos (veja texto)."), então a normalização é por palavra.
// A magia da mesa já nasce canônica: ela passa pelos ROTULOS de carta.mjs e cai
// no MESMO parser — um caminho só pros dois lados.
//
//   node static/eixos.mjs --check

export const EXECUCOES = ["padrão", "movimento", "livre", "reação", "completa", "ritual"];
export const ALCANCES = ["pessoal", "toque", "curto", "médio", "longo", "ilimitado"];
export const TESTES = ["nenhuma", "Fortitude", "Reflexos", "Vontade"];
export const EFEITOS = ["anula", "parcial", "reduz à metade", "desacredita"];

const acha = (txt, mapa) => {
  const t = String(txt || "").toLowerCase();
  for (const [re, valor] of mapa) if (re.test(t)) return valor;
  return null;
};

// "1 hora", "duas rodadas", "1d3+1 rodadas" — o livro chama de ritual
const EXEC = [[/rea[çc][ãa]o/, "reação"], [/movimento/, "movimento"], [/livre/, "livre"],
  [/completa/, "completa"], [/padr[ãa]o/, "padrão"], [/rodada|hora|minuto|ritual/, "ritual"]];
const ALC = [[/pessoal/, "pessoal"], [/toque/, "toque"], [/curto/, "curto"],
  [/m[ée]dio/, "médio"], [/longo/, "longo"], [/ilimitado/, "ilimitado"]];
const TESTE = [[/nenhuma/, "nenhuma"], [/fortitude/, "Fortitude"], [/reflexos/, "Reflexos"], [/vontade/, "Vontade"]];
const EFEITO = [[/desacredita/, "desacredita"], [/metade/, "reduz à metade"],
  [/parcial/, "parcial"], [/anula|evita/, "anula"]];

/** Devolve só o que dá pra afirmar; "veja texto" vira null e fica de fora dos filtros. */
export function eixosDe(execucao, alcance, resistencia) {
  return {
    exec: acha(execucao, EXEC),
    alc: acha(alcance, ALC),
    res: acha(resistencia, TESTE),
    resEf: acha(resistencia, EFEITO),
  };
}

if (typeof process !== "undefined" && process.argv?.includes("--check") && /eixos\.mjs$/.test(process.argv[1] || "")) {
  const eq = (o, e, q) => { if (o !== e) { console.error(`FALHOU ${q}: ${JSON.stringify(o)} != ${JSON.stringify(e)}`); process.exitCode = 1; } };
  eq(eixosDe("ação padrão").exec, "padrão", "ação padrão");
  eq(eixosDe("1d3+1 rodadas").exec, "ritual", "rodadas = ritual");
  eq(eixosDe("ritual (2+ rodadas)").exec, "ritual", "rótulo da mesa");
  eq(eixosDe("reação").exec, "reação", "reação");
  eq(eixosDe(null, "curtoAlvo ou").alc, "curto", "alcance grudado");
  eq(eixosDe(null, "curto (9m)").alc, "curto", "rótulo da mesa");
  eq(eixosDe(null, "pessoal ou toque").alc, "pessoal", "pessoal ganha de toque");
  eq(eixosDe(null, "veja texto").alc, null, "veja texto não filtra");
  eq(eixosDe(null, null, "Vontade parcial.").res, "Vontade", "teste");
  eq(eixosDe(null, null, "Vontade parcial.").resEf, "parcial", "efeito");
  eq(eixosDe(null, null, "Reflexos reduz à metade").resEf, "reduz à metade", "metade");
  eq(eixosDe(null, null, "Vontade Evita").resEf, "anula", "evita = anula");
  eq(eixosDe(null, null, "nenhuma").res, "nenhuma", "sem resistência");
  eq(eixosDe(null, null, "nenhuma").resEf, null, "sem resistência não tem efeito");
  if (!process.exitCode) console.log("eixos.mjs --check OK");
}
