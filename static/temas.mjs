// temas.mjs — o vocabulário de TEMAS do hub: o que um poder, magia ou raça FAZ em jogo.
// Cada item do acervo foi revisado um a um e recebeu de 1 a 6 temas desta lista (dados/revisao.json).
// Serve à busca (palavra digitada → tema), aos chips de filtro e ao Arauto (ferramenta `buscar`).
// [id, rótulo do chip, radicais que alguém digitaria pra falar disso (sem acento, minúsculas)]
export const TEMAS = [
  ["deslocamento", "🏃 deslocamento", ["veloz", "velocidade", "rapid", "correr", "corrida", "ligeir", "mais deslocamento", "andar mais"]],
  ["movimento-extra", "⏩ movimento extra", ["movimento extra", "acao de movimento", "mover", "movimentac", "mobilidade"]],
  ["investida", "🐗 investida", ["investida", "atropel"]],
  ["voo", "🪽 voo", ["voar", "voo", "voador", "asas", "pairar", "levit", "planar"]],
  ["natacao-escalada", "🧗 natação e escalada", ["nadar", "natac", "escalar", "escalada", "escavar", "mergulh", "respirar na agua", "aquatic"]],
  ["teleporte", "✨ teleporte", ["teleport", "teletransport", "atravessar parede"]],
  ["terreno", "⛰️ terreno", ["terreno dificil", "equilibrio", "saltar", "salto", "pular", "queda"]],
  ["montaria", "🐎 montaria", ["montaria", "montado", "cavalgar", "cavalo", "pilot", "veiculo"]],
  ["iniciativa", "⚡ iniciativa", ["iniciativa", "agir primeiro", "surpreend", "desprevenido"]],
  ["furtividade", "🥷 furtividade", ["furtiv", "invisi", "esconder", "camufl", "disfarce", "stealth"]],
  ["ataque", "🎯 acerto", ["acerto", "acertar", "teste de ataque", "bonus de ataque"]],
  ["dano", "💥 dano", ["dano", "causar mais dano", "dano extra"]],
  ["critico", "‼️ crítico", ["critico", "margem de ameaca", "multiplicador"]],
  ["ataque-extra", "⚔️ ataque extra", ["ataque extra", "ataque adicional", "mais ataques", "atacar duas vezes", "ataque de oportunidade", "contra-ataque"]],
  ["corpo-a-corpo", "🗡️ corpo a corpo", ["corpo a corpo", "melee", "espada", "machado"]],
  ["distancia", "🏹 à distância", ["a distancia", "arco", "besta", "tiro", "disparo", "arremess", "arma de fogo", "pistola", "mosquete"]],
  ["desarmado-natural", "👊 desarmado e armas naturais", ["desarmado", "soco", "arma natural", "garras", "mordida", "chifre", "briga"]],
  ["duas-armas", "⚔️ duas armas", ["duas armas", "ambidestr", "arma dupla", "mao inabil"]],
  ["manobra", "🤼 manobras", ["manobra", "agarrar", "derrubar", "desarmar", "empurrar", "quebrar", "fintar", "finta"]],
  ["area", "💫 área", ["em area", "cone", "explosao", "sopro", "varios alvos"]],
  ["ataque-furtivo", "🗡️ ataque furtivo", ["ataque furtivo", "flanque", "desprevenid"]],
  ["defesa", "🛡️ defesa", ["defesa", "esquiva", "bloque", "aparar", "tanque"]],
  ["rd", "🪨 redução de dano", ["reducao de dano", "resistencia a dano", "imunidade a dano", " rd "]],
  ["resistencia", "💪 resistências", ["fortitude", "reflexos", "vontade", "teste de resistencia", "imune", "imunidade"]],
  ["pv", "❤️ pontos de vida", ["pontos de vida", "pv", "vida extra", "nao morrer", "aguentar"]],
  ["cura", "➕ cura", ["cura", "curar", "recuperar pv", "regenera", "descanso"]],
  ["protecao-aliado", "🫂 proteger aliados", ["proteger aliad", "defender aliad", "guarda-costas", "provocar", "atrair inimigo"]],
  ["pm", "🔷 pontos de mana", ["mana", " pm", "recuperar pm", "custo em pm"]],
  ["acao", "⏱️ economia de ação", ["acao extra", "acao padrao extra", "acao livre", "reacao", "economia de acao"]],
  ["rerrolagem", "🎲 rerrolar e sorte", ["rerrol", "rolar de novo", "rolar novamente", "sorte", "refazer o teste"]],
  ["conjuracao", "📖 conjuração", ["lancar magia", "aprender magia", "conjurador", "magias conhecidas", "circulo de magia"]],
  ["magia-reforco", "🔮 reforço de magia", ["aprimoramento", "metamagia", "cd da magia", "magia mais forte", "magia acelerada"]],
  ["anti-magia", "🚫 anti-magia", ["resistencia a magia", "contramagi", "dissipar", "anti-magia", "detectar magia"]],
  ["invocacao", "👻 invocação", ["invoca", "convoca", "conjurar criatura", "criatura invocada"]],
  ["pericia", "📚 perícias", ["pericia", "treinado", "treinamento em"]],
  ["social", "🗣️ social", ["diplomacia", "enganacao", "intimid", "atuacao", "carism", "convencer", "persua", "mentir", "contatos"]],
  ["conhecimento", "🧠 conhecimento", ["conhecimento", "investigac", "misticismo", "religiao", "nobreza", "identificar", "idioma"]],
  ["exploracao", "🧭 exploração", ["sobrevivencia", "percepcao", "rastrear", "viagem", "armadilha", "ladinagem", "fechadura", "explorac"]],
  ["sentidos", "👁️ sentidos", ["visao no escuro", "penumbra", "faro", "percepcao as cegas", "enxergar"]],
  ["fabricacao", "🔨 fabricação", ["fabricar", "oficio", "forjar", "pocao", "pergaminho", "engenhoca", "alquimi", "artesanato", "craft"]],
  ["riqueza", "💰 riqueza", ["dinheiro", "tibar", "riqueza", "desconto", "renda", "comercio"]],
  ["arma", "🪓 armas", ["proficiencia com arma", "arma favorita", "especializacao em arma", "foco em arma"]],
  ["armadura-escudo", "🛡️ armadura e escudo", ["armadura", "escudo", "penalidade de armadura"]],
  ["item-magico", "💍 itens mágicos", ["item magico", "itens magicos", "varinha", "esoterico", "encanto"]],
  ["parceiro", "🐕 parceiros", ["parceiro", "familiar", "companheiro animal", "mascote", "capanga", "seguidor", "aliado animal", "pet"]],
  ["suporte", "📣 suporte", ["suporte", "buff", "inspirar", "bonus para aliados", "ajudar aliados", "lider", "comandar"]],
  ["controle", "🕸️ controle", ["controle", "atordo", "paralis", "enredar", "imobiliz", "fascin", "cegar", "lento"]],
  ["medo", "😱 medo", ["medo", "amedront", "apavor", "abalado", "assust"]],
  ["debuff", "📉 enfraquecer inimigo", ["debuff", "penalidade no inimigo", "enfraquec", "vulneravel", "marcar alvo"]],
  ["fogo", "🔥 fogo", ["fogo", "chama", "queima", "incendi", "igne"]],
  ["frio", "❄️ frio", ["frio", "gelo", "congel", "gelid"]],
  ["eletricidade", "⚡ eletricidade", ["eletric", "relampago", "raio", "choque", "trovao"]],
  ["acido", "🧪 ácido", ["acido", "corros"]],
  ["luz", "☀️ luz", ["luz", "sagrado", "radiante", "brilh"]],
  ["trevas", "🌑 trevas", ["trevas", "escuridao", "sombra", "profano"]],
  ["veneno", "☠️ veneno", ["veneno", "envenen", "toxic", "peconh"]],
  ["psiquico", "🌀 psíquico e mental", ["psiquic", "mental", "mente", "telepat"]],
  ["tamanho", "📏 tamanho", ["tamanho", "minusculo", "alcance natural", "gigante"]],
  ["transformacao", "🐺 transformação", ["transforma", "metamorf", "forma selvagem", "mudar de forma", "licantrop"]],
  ["atributo", "📈 atributos", ["aumento de atributo", "aumentar atributo", "+1 em forca", "atributo-chave"]],
  ["tipo-criatura", "🤖 tipo de criatura", ["construto", "morto-vivo", "espirito", "nao respira", "nao dorme"]],
  ["tormenta", "🩸 Tormenta", ["tormenta", "lefeu", "aberrante"]],
  ["devocao", "🙏 devoção", ["devoto", "devocao", "divindade", "deus", "simbolo sagrado", "canalizar"]],
  ["morto-vivo", "💀 mortos-vivos", ["morto-vivo", "mortos-vivos", "necro", "zumbi", "esqueleto", "energia negativa"]],
  ["natureza", "🌿 natureza", ["natureza", "animal", "planta", "floresta", "clima", "selvagem"]],
  ["musica-arte", "🎵 música e arte", ["musica", "cancao", "instrumento", "bardo", "apresentac"]],
  ["furia", "😤 fúria", ["furia", "berserk", "enfurec"]],
  ["desvantagem", "⚠️ desvantagem", ["desvantagem", "fraqueza", "penalidade", "restricao", "limitacao", "aversao"]],
  ["narrativo", "📜 narrativo", ["interpretac", "titulo", "status social", "historia do personagem", "roleplay"]],
];
export const TEMA_IDS = TEMAS.map((t) => t[0]);
export const TEMA_ROTULO = Object.fromEntries(TEMAS.map((t) => [t[0], t[1]]));
// grupos pros chips (a lista inteira num bloco só seria uma parede)
export const TEMA_GRUPOS = [
  ["Movimento", ["deslocamento", "movimento-extra", "investida", "voo", "natacao-escalada", "teleporte", "terreno", "montaria", "iniciativa", "furtividade"]],
  ["Ataque", ["ataque", "dano", "critico", "ataque-extra", "corpo-a-corpo", "distancia", "desarmado-natural", "duas-armas", "manobra", "area", "ataque-furtivo"]],
  ["Defesa", ["defesa", "rd", "resistencia", "pv", "cura", "protecao-aliado"]],
  ["Recursos", ["pm", "acao", "rerrolagem", "atributo"]],
  ["Magia", ["conjuracao", "magia-reforco", "anti-magia", "invocacao", "item-magico"]],
  ["Fora de combate", ["pericia", "social", "conhecimento", "exploracao", "sentidos", "fabricacao", "riqueza", "narrativo"]],
  ["Grupo", ["parceiro", "suporte", "controle", "medo", "debuff"]],
  ["Equipamento", ["arma", "armadura-escudo"]],
  ["Energia", ["fogo", "frio", "eletricidade", "acido", "luz", "trevas", "veneno", "psiquico"]],
  ["Natureza do personagem", ["tamanho", "transformacao", "tipo-criatura", "tormenta", "devocao", "morto-vivo", "natureza", "musica-arte", "furia", "desvantagem"]],
];

const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Temas que uma consulta evoca: "personagem veloz com investida" → ["deslocamento", "investida"]. */
export function temasDaConsulta(q) {
  const t = " " + semAcento(q).replace(/[^a-z0-9+ -]+/g, " ").replace(/\s+/g, " ") + " ";
  const out = [];
  for (const [id, , radicais] of TEMAS) {
    const nome = id.replace(/-/g, " ");
    if (t.includes(" " + nome) || radicais.some((r) => t.includes(r.startsWith(" ") ? r : " " + r))) out.push(id);
  }
  return out;
}

// self-test: node static/temas.mjs --check
if (typeof process !== "undefined" && process.argv?.[1]?.replace(/\\/g, "/").endsWith("static/temas.mjs") && process.argv.includes("--check")) {
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FALHOU:", m, JSON.stringify(a)); process.exitCode = 1; } };
  eq(temasDaConsulta("personagem focado em ser veloz"), ["deslocamento"], "veloz → deslocamento");
  eq(temasDaConsulta("poderes relacionados a investidas"), ["investida"], "investidas → investida");
  eq(temasDaConsulta("mais movimentação e Voar"), ["movimento-extra", "voo"], "movimentação e voo");
  eq(temasDaConsulta("espada longa"), ["corpo-a-corpo"], "espada → corpo a corpo");
  eq(temasDaConsulta("marah"), [], "nome próprio não vira tema");
  eq(temasDaConsulta("espada grande e limite de carga"), ["corpo-a-corpo"], "palavra genérica (grande, carga) não vira tema");
  eq(temasDaConsulta("redução de dano"), ["dano", "rd"], "frase de tema casa pelo radical composto");
  const ids = new Set(TEMA_IDS), nosGrupos = TEMA_GRUPOS.flatMap((g) => g[1]);
  eq(nosGrupos.filter((t) => !ids.has(t)), [], "grupo cita tema que não existe");
  eq(TEMA_IDS.filter((t) => !nosGrupos.includes(t)), [], "tema fora de todos os grupos");
  eq(nosGrupos.length, new Set(nosGrupos).size, "tema repetido nos grupos");
  if (!process.exitCode) console.log("temas.mjs --check OK");
}
