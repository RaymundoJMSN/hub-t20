// lib/arauto.mjs — o cérebro do Arauto: a MESMA inteligência no site do hub e no Papinho (bot do Matrix).
// O modelo (API da Anthropic) não responde de memória: ele dirige ferramentas sobre a base revisada do hub
// (poderes, magias, raças, classes… com "como se obtém") e sobre os trechos dos livros (com página), e escreve a resposta.
// Este arquivo cuida do laço modelo ⇄ ferramentas, da cota por pessoa e do registro; as ferramentas em si chegam do server.mjs.
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const API = "https://api.anthropic.com/v1/messages", VERSAO = "2026-10-21";
// claude-haiku-5-5: a geração atual da linha que o Arauto já usava (Haiku), mais barata e melhor com ferramentas.
// Trocar por "claude-sonnet-5-5" ou "claude-opus-5-5" em dados/arauto.json dá respostas melhores e custa mais.
const PADRAO = { modelo: "claude-haiku-5-5", esforco: "medium", limiteDia: 80, limiteDiaBot: 300, rodadas: 8, maxTokens: 8000 };

export const SISTEMA = `Você é o Arauto, o sábio da mesa de Tormenta 20 do RayNathus. Você responde a jogadores e ao mestre sobre regras, construção de personagem e o mundo de Arton — no site do hub e no chat Papinho.

## Como trabalhar
- Tudo o que você afirma sobre o jogo vem das ferramentas. Sua memória de Tormenta 20 não é confiável: nomes, números e páginas saem do que as ferramentas devolveram nesta conversa. Se não achou, diga que não achou — nunca complete de cabeça.
- Pergunta ampla ("o que me deixa mais veloz?", "como monto um arqueiro?") pede várias buscas: pelo tema, com palavras diferentes, em poderes, raças, magias, classes e distinções. Dispare as buscas em paralelo, na mesma rodada. Depois leia com \`ver\` o texto dos candidatos que vai recomendar: o resumo da busca serve para escolher, o texto completo para afirmar.
- Pergunta direta ("o que faz Ataque Poderoso?") pede uma busca e um \`ver\`.
- Sobre uma raça, classe, divindade, origem ou distinção inteira, \`ficha\` devolve tudo de uma vez (o que ela dá e em que nível).
- Regra geral, ambientação, deuses, lugares e NPCs: \`livros\` devolve trechos dos livros com a página.
- Leve em conta o que a pessoa já contou (raça, classe, nível, devoção). Se faltar um detalhe que muda a resposta, responda para o caso geral e diga o que mudaria.

## Como responder
- Português do Brasil, direto, no tom de um mestre experiente ajudando um jogador. Comece pela resposta.
- Em recomendações, organize por COMO SE OBTÉM: o que já vem com a raça; poderes gerais (qualquer personagem); habilidades e poderes de classe (só daquela classe); poderes concedidos (só devotos); distinções (5º nível e admissão em jogo); magias. Em cada opção: o que dá, o pré-requisito e o custo em PM quando houver.
- Seja explícito sobre exclusividade. Habilidade de raça só existe para aquela raça e não se pega de outro jeito; poder de classe exige níveis na classe; concedido exige ser devoto. Não ofereça como opção o que o personagem descrito não pode pegar — diga o que ele precisaria ser.
- Cite a fonte de cada item como (Livro, p. N) quando a ferramenta trouxer a página. Material fora do Livro Básico depende de o mestre aceitar.
- Ao citar um item do acervo, escreva o nome como link usando o id que a ferramenta devolveu: [Atlético](d:atletico). Nunca invente um id.
- Listas curtas, uma linha por opção. Markdown simples: títulos com ##, listas e negrito; sem tabelas.
- Em pergunta de construção, feche com uma combinação sugerida (2 a 4 escolhas que funcionam juntas) e o motivo.
- Prefira uma resposta que caiba numa tela. Se o assunto é enorme, dê as melhores opções e ofereça aprofundar em uma delas.`;

export function ferramentasDoModelo(temas, colecoes) {
  return [
    { name: "buscar",
      description: "Procura no acervo estruturado do hub. Use antes de afirmar qualquer coisa sobre poderes, magias, raças, classes, origens, divindades, distinções, itens, ameaças ou regras. Devolve uma lista curta (id, nome, como se obtém, pré-requisito, resumo); use `ver` para ler o texto completo dos que importam. Em poderes, magias e raças, o filtro `tema` acha tudo o que FAZ aquilo (ex.: tema deslocamento = tudo que aumenta deslocamento), mesmo que o texto use outras palavras; combine com `acesso` e `dono` para cortar. Sem `consulta`, lista pelos filtros.",
      input_schema: { type: "object", properties: {
        onde: { type: "string", enum: ["poderes", "magias", "racas", "classes", "origens", "divindades", "distincoes", ...colecoes, "tudo"], description: "em que parte do acervo procurar" },
        consulta: { type: "string", description: "palavras ou frase curta em português; pode ficar vazio quando há filtros" },
        tema: { type: "string", enum: temas, description: "tema mecânico (poderes, magias e raças)" },
        acesso: { type: "string", enum: ["raca", "poder-raca", "classe-habilidade", "classe-poder", "geral", "concedido", "origem", "distincao", "complicacao"], description: "só poderes: como se obtém. raca = habilidade inata da raça; poder-raca = poder geral exclusivo de uma raça; geral = qualquer personagem" },
        dono: { type: "string", description: "só poderes: raça, classe, divindade, origem ou distinção dona (ex.: Elfo, Guerreiro, Marah, Aeronauta Goblin)" },
        circulo: { type: "integer", description: "só magias: círculo de 1 a 5" },
        limite: { type: "integer", description: "quantos resultados (padrão 15, máximo 40)" },
      }, required: ["onde"] } },
    { name: "ver",
      description: "Lê o texto completo de até 8 itens pelo id devolvido por `buscar` ou `ficha` (d:… poder, o:… magia, c:coleção/id item, ameaça ou regra). Traz pré-requisitos, custo, livro e página, como se obtém e o que o item libera.",
      input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "ids exatamente como vieram das outras ferramentas" } }, required: ["ids"] } },
    { name: "ficha",
      description: "A ficha inteira de uma raça, classe, divindade, origem ou distinção: atributos, deslocamento e habilidades da raça (com linhagens e listas de opções); PV/PM, habilidades por nível e lista de poderes da classe; devotos e poderes concedidos da divindade; benefícios da origem; poderes da distinção.",
      input_schema: { type: "object", properties: {
        tipo: { type: "string", enum: ["raca", "classe", "divindade", "origem", "distincao"] },
        nome: { type: "string", description: "nome como no livro (ex.: Elfo, Bárbaro, Marah, Gladiador, Cavaleiro da Luz)" },
      }, required: ["tipo", "nome"] } },
    { name: "livros",
      description: "Trechos dos livros de Tormenta 20 (Livro Básico, Heróis, Deuses, Ameaças, Atlas, Deuses Menores, Guia de NPCs, Dragão Brasil, FAQ do Tribunal Regreiro) mais parecidos com a consulta, com livro e página. Use para regras gerais, casos de mesa, ambientação, história, deuses, lugares e personagens. Escreva a consulta como uma pergunta ou frase completa.",
      input_schema: { type: "object", properties: {
        consulta: { type: "string" },
        livro: { type: "string", description: "opcional: restringe a um livro (ex.: Atlas de Arton)" },
      }, required: ["consulta"] } },
  ];
}

/** O que mostrar pra pessoa enquanto a ferramenta roda. */
export function statusDe(nome, input = {}) {
  const onde = { poderes: "poderes", magias: "magias", racas: "raças", classes: "classes", origens: "origens", divindades: "divindades", distincoes: "distinções", tudo: "o acervo" }[input.onde] || input.onde || "";
  if (nome === "buscar") return `🔎 procurando em ${onde}${input.tema ? ` · tema ${input.tema}` : ""}${input.dono ? ` · ${input.dono}` : ""}${input.consulta ? ` · “${String(input.consulta).slice(0, 60)}”` : ""}`;
  if (nome === "ver") return `📖 lendo ${(input.ids || []).length} ${(input.ids || []).length === 1 ? "texto" : "textos"}`;
  if (nome === "ficha") return `📜 abrindo a ficha de ${input.nome || "?"}`;
  if (nome === "livros") return `📚 consultando os livros · “${String(input.consulta || "").slice(0, 60)}”`;
  return "…";
}

/** historico do cliente ([{de:"eu"|"arauto", texto}]) → mensagens alternadas começando por "user" (só texto: nada de bloco de raciocínio antigo). */
export function mensagensDe(historico, pergunta) {
  const msgs = [];
  for (const h of (historico || []).slice(-8)) {
    const role = h.de === "arauto" ? "assistant" : "user", texto = String(h.texto || "").trim().slice(0, 6000);
    if (!texto || (!msgs.length && role === "assistant")) continue;
    if (msgs.at(-1)?.role === role) msgs.at(-1).content += "\n\n" + texto; else msgs.push({ role, content: texto });
  }
  if (msgs.at(-1)?.role === "user") msgs.at(-1).content += "\n\n" + pergunta; else msgs.push({ role: "user", content: pergunta });
  return msgs;
}

const dia = (t) => new Date(t - 3 * 3600_000).toISOString().slice(0, 10); // dia de Brasília
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function criarArauto({ dados, ferramentas, temas, colecoes = [], lerJson, gravarJson, buscar = fetch, agora = () => Date.now(), silencioso = false }) {
  const arqCfg = join(dados, "arauto.json"), arqUso = join(dados, "arauto-uso.json"), arqLog = join(dados, "arauto-log.jsonl"), arqPrimer = join(dados, "arauto-primer.md");
  const cfg = () => ({ ...PADRAO, ...lerJson(arqCfg, {}) });
  const tools = ferramentasDoModelo(temas, colecoes);
  let sistema = null; // montado uma vez: mudar o texto invalida o cache de prompt
  const sistemaDe = () => (sistema ??= SISTEMA + (existsSync(arqPrimer) ? "\n\n" + readFileSync(arqPrimer, "utf-8").trim() : ""));
  let uso = null;

  /** Dentro da cota de hoje? Conta a pergunta. */
  function gastar(quem, canal) {
    const c = cfg(), hoje = dia(agora());
    uso ??= lerJson(arqUso, {});
    if (uso.dia !== hoje) uso = { dia: hoje, n: {} };
    const k = `${canal}:${String(quem).toLowerCase()}`, limite = canal === "papinho" ? c.limiteDiaBot : c.limiteDia;
    if ((uso.n[k] || 0) >= limite) return false;
    uso.n[k] = (uso.n[k] || 0) + 1;
    gravarJson(arqUso, uso);
    return true;
  }

  async function chamar(c, corpo) {
    for (let tentativa = 0; ; tentativa++) {
      let r;
      try {
        r = await buscar(API, { method: "POST", signal: AbortSignal.timeout(120_000),
          headers: { "x-api-key": c.chave, "anthropic-version": VERSAO, "content-type": "application/json" }, body: JSON.stringify(corpo) });
      } catch (e) { if (tentativa >= 2) throw new Error("sem resposta da API (" + e.message + ")"); await new Promise((ok) => setTimeout(ok, 1500 * (tentativa + 1))); continue; }
      if (r.ok) return r.json();
      const texto = await r.text().catch(() => "");
      // sobrecarga, limite de taxa e erro do servidor valem outra tentativa; o resto (400, 401, 404) é erro nosso e não adianta repetir
      if ([408, 409, 429, 500, 502, 503, 504, 529].includes(r.status) && tentativa < 2) { await new Promise((ok) => setTimeout(ok, Math.min(20_000, (Number(r.headers.get("retry-after")) || 2 * (tentativa + 1)) * 1000))); continue; }
      throw Object.assign(new Error(`API ${r.status}: ${texto.slice(0, 300)}`), { status: r.status });
    }
  }

  /**
   * Responde uma pergunta. `avisar(texto)` recebe o andamento ("🔎 procurando…") pra mostrar enquanto espera.
   * Devolve { resposta, itens (ids citados), ms, uso } ou { erro, resposta } — nunca lança.
   */
  async function responder({ pergunta, historico = [], quem = "?", canal = "site", avisar = () => {} }) {
    const t0 = agora(), c = cfg();
    pergunta = String(pergunta || "").trim().slice(0, 4000);
    const reg = { t: new Date(t0).toISOString(), quem, canal, modelo: c.modelo, pergunta, ferramentas: [] };
    const fim = (r) => {
      Object.assign(reg, { ms: agora() - t0, resposta: String(r.resposta || "").slice(0, 6000), erro: r.erro, uso: r.uso });
      if (!silencioso) try { appendFileSync(arqLog, JSON.stringify(reg) + "\n"); } catch {}
      return { ...r, ms: reg.ms };
    };
    if (!pergunta) return { erro: "vazio", resposta: "Pergunte alguma coisa. 🙂" };
    if (!c.chave) return fim({ erro: "sem-chave", resposta: "O Arauto ainda não tem a chave da API configurada no servidor." });
    if (!gastar(quem, canal)) return fim({ erro: "cota", resposta: "Você chegou ao limite de perguntas ao Arauto por hoje. Amanhã tem mais." });

    const messages = mensagensDe(historico, pergunta), total = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0, chamadas: 0 };
    const corpoBase = { model: c.modelo, max_tokens: c.maxTokens, tools, cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: sistemaDe(), cache_control: { type: "ephemeral" } }] };
    if (!/haiku-4-5|sonnet-4-5/.test(c.modelo)) corpoBase.output_config = { effort: c.esforco }; // os modelos 4.5 não aceitam esforço
    try {
      for (let rodada = 0; rodada <= c.rodadas; rodada++) {
        const r = await chamar(c, { ...corpoBase, messages });
        total.chamadas++; total.entrada += r.usage?.input_tokens || 0; total.saida += r.usage?.output_tokens || 0;
        total.cacheLido += r.usage?.cache_read_input_tokens || 0; total.cacheEscrito += r.usage?.cache_creation_input_tokens || 0;
        if (r.stop_reason === "refusal") return fim({ erro: "recusa", resposta: "Não posso ajudar com esse pedido. Se era uma dúvida de Tormenta 20, tente reformular.", uso: total });
        const texto = (r.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        const usos = (r.content || []).filter((b) => b.type === "tool_use");
        if (r.stop_reason !== "tool_use" || !usos.length || rodada === c.rodadas) {
          const resposta = texto || "Procurei e não consegui montar uma resposta. Tente perguntar de outro jeito.";
          return fim({ resposta: r.stop_reason === "max_tokens" ? resposta + "\n\n*(a resposta foi cortada por tamanho — peça para continuar)*" : resposta,
            itens: [...new Set([...resposta.matchAll(/\]\(((?:d|o|c):[\w\-/.]+)\)/g)].map((m) => m[1]))], uso: total });
        }
        // o turno do modelo volta inteiro e sem mexer (blocos de raciocínio incluídos): a API confere isso
        messages.push({ role: "assistant", content: r.content });
        const resultados = await Promise.all(usos.map(async (u) => {
          avisar(statusDe(u.name, u.input));
          reg.ferramentas.push({ nome: u.name, ...u.input });
          try {
            if (!ferramentas[u.name]) throw new Error("ferramenta desconhecida");
            const saida = await ferramentas[u.name](u.input || {});
            return { type: "tool_result", tool_use_id: u.id, content: String(saida || "(nada encontrado)").slice(0, 30_000) };
          } catch (e) { return { type: "tool_result", tool_use_id: u.id, content: "erro: " + e.message, is_error: true }; }
        }));
        // todos os resultados numa mensagem só; na penúltima rodada, o aviso vai junto (depois dos resultados)
        messages.push({ role: "user", content: rodada === c.rodadas - 1 ? [...resultados, { type: "text", text: "Você já buscou o suficiente. Responda agora com o que encontrou, sem novas buscas." }] : resultados });
      }
    } catch (e) {
      if (!silencioso) console.error("arauto:", e.message);
      return fim({ erro: "api", detalhe: e.message, resposta: e.status === 401 ? "A chave da API do Arauto foi recusada. Avise o mestre." : "O Arauto não conseguiu falar com o modelo agora. Tente de novo em instantes.", uso: total });
    }
  }

  /** Token do bot do Papinho (dados/arauto.json → botToken), comparado em tempo constante. */
  const botAutorizado = (cabecalho) => { const t = cfg().botToken, m = /^Bearer (.+)$/.exec(cabecalho || ""); return !!(t && m && iguais(m[1], t)); };
  return { responder, botAutorizado, pronto: () => !!cfg().chave, modelo: () => cfg().modelo };
}

// self-test: node lib/arauto.mjs --check  (API falsa: confere o laço de ferramentas, a cota e o formato das mensagens)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/arauto.mjs") && process.argv.includes("--check")) {
  const falha = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  const m1 = mensagensDe([{ de: "arauto", texto: "oi" }, { de: "eu", texto: "a" }, { de: "eu", texto: "b" }, { de: "arauto", texto: "c" }], "d");
  if (JSON.stringify(m1) !== JSON.stringify([{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }])) falha("mensagensDe: " + JSON.stringify(m1));
  const pedidos = [], disco = { "arauto.json": { chave: "k", botToken: "segredo", limiteDia: 2, rodadas: 2 } };
  const respostas = [
    { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "buscar", input: { onde: "poderes", tema: "deslocamento" } }, { type: "tool_use", id: "t2", name: "explodir", input: {} }] },
    { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 9 }, content: [{ type: "text", text: "Pegue [Atlético](d:atletico) e [Velocidade](o:velocidade)." }] },
  ];
  const A = criarArauto({ dados: "/x", temas: ["deslocamento"], silencioso: true, agora: () => 1_800_000_000_000,
    lerJson: (a, p) => disco[a.replace(/\\/g, "/").split("/").pop()] ?? p, gravarJson: (a, o) => { disco[a.replace(/\\/g, "/").split("/").pop()] = o; },
    ferramentas: { buscar: async (i) => "d:atletico | Atlético | tema " + i.tema },
    buscar: async (url, o) => { pedidos.push(JSON.parse(o.body)); const r = respostas[pedidos.length - 1]; return { ok: true, json: async () => r }; } });
  const avisos = [];
  const r = await A.responder({ pergunta: "como ficar veloz?", quem: "Ray", avisar: (t) => avisos.push(t) });
  if (r.erro || JSON.stringify(r.itens) !== '["d:atletico","o:velocidade"]' || r.uso.chamadas !== 2 || r.uso.cacheLido !== 9) falha("responder: " + JSON.stringify(r));
  const segundo = pedidos[1].messages;
  if (segundo.length !== 3 || segundo[1].content[0].type !== "thinking" || segundo[2].content.length !== 2) falha("o turno do modelo e os dois resultados deviam voltar inteiros: " + JSON.stringify(segundo));
  if (segundo[2].content[0].content !== "d:atletico | Atlético | tema deslocamento" || !segundo[2].content[1].is_error) falha("resultado de ferramenta / erro de ferramenta desconhecida");
  if (pedidos[0].system[0].cache_control?.type !== "ephemeral" || pedidos[0].output_config.effort !== "medium" || pedidos[0].thinking || pedidos[0].temperature != null) falha("corpo do pedido");
  if (!avisos[0].includes("tema deslocamento")) falha("status: " + avisos[0]);
  // rodadas esgotadas: a penúltima leva o aviso e a última encerra mesmo se o modelo pedir ferramenta de novo
  pedidos.length = 0; respostas.length = 0;
  for (let i = 0; i < 3; i++) respostas.push({ stop_reason: "tool_use", content: [{ type: "text", text: i === 2 ? "parcial" : "" }, { type: "tool_use", id: "t" + i, name: "buscar", input: { onde: "magias" } }] });
  const r2 = await A.responder({ pergunta: "x", quem: "Ray" });
  if (r2.resposta !== "parcial" || pedidos.length !== 3 || pedidos[2].messages.at(-1).content.at(-1).type !== "text") falha("limite de rodadas: " + JSON.stringify(r2) + pedidos.length);
  const r3 = await A.responder({ pergunta: "x", quem: "ray" });
  if (r3.erro !== "cota") falha("cota (2 por dia, sem diferenciar maiúscula): " + JSON.stringify(r3));
  if (!A.botAutorizado("Bearer segredo") || A.botAutorizado("Bearer errado") || A.botAutorizado("")) falha("token do bot");
  delete disco["arauto.json"].chave;
  if ((await A.responder({ pergunta: "x", quem: "outro" })).erro !== "sem-chave") falha("sem chave devia avisar");
  if (statusDe("ver", { ids: ["a"] }) !== "📖 lendo 1 texto") falha("statusDe");
  if (!process.exitCode) console.log("arauto.mjs --check OK");
}
