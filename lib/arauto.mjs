// lib/arauto.mjs — o cérebro do Arauto: a MESMA inteligência no site do hub e no Papinho (bot do Matrix).
// O modelo (API da Anthropic) não responde de memória: ele dirige ferramentas sobre a base revisada do hub
// (poderes, magias, raças, classes, itens… com "como se obtém") e sobre os trechos dos livros (com página), e escreve a resposta.
// Este arquivo cuida do laço modelo ⇄ ferramentas, de escolher o modo (direto ou profundo), da cota por pessoa e do registro;
// as ferramentas em si chegam do server.mjs.
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const API = "https://api.anthropic.com/v1/messages", VERSAO = "2026-10-21";
// Dois modos. DIRETO (o que faz X? como funciona a regra Y?): modelo rápido e barato, poucas rodadas.
// PROFUNDO (o que pego para ser veloz? como monto um arqueiro?): modelo forte, esforço alto, mais rodadas — é onde o conselho
// precisa de visão do sistema inteiro. Quem decide é um classificador de uma chamada (no modelo barato). Tudo ajustável em dados/arauto.json.
// Medido em 12/11/2026 na pergunta "quero um personagem veloz" (gabarito de 10 opções que não podem faltar; node tools/avaliar-arauto.mjs --construcao):
//   Opus 5.5 → 10/10, 89 s, US$ 0,64 · Sonnet 5.5 → 10/10, 41 s, US$ 0,27 · Haiku 5.5 → 9/10, 51 s, US$ 0,013 (e inventou um id de item).
// Por isso: no site (onde a pessoa espera e quer o melhor) Opus; no bot (150 s de espera) Sonnet. Para gastar menos, modeloProfundo = "claude-sonnet-5-5".
const PADRAO = { modelo: "claude-haiku-5-5", esforco: "medium", rodadas: 10, maxTokens: 12000,
  modeloProfundo: "claude-opus-5-5", modeloProfundoBot: "claude-sonnet-5-5", esforcoProfundo: "high", rodadasProfundo: 14, maxTokensProfundo: 24000, classificar: true,
  limiteDia: 80, limiteDiaBot: 300, limiteDiaProfundo: 20, limiteDiaBotProfundo: 60,
  tempoSiteMs: 280_000, tempoBotMs: 125_000 }; // o bot do Papinho espera 150 s pela resposta (arauto-config.toml → [hub] timeout)

export const SISTEMA = `Você é o Arauto, o sábio da mesa de Tormenta 20 do RayNathus. Você responde a jogadores e ao mestre sobre regras, construção de personagem e o mundo de Arton — no site do hub e no chat Papinho.

## Como trabalhar
- Tudo o que você afirma sobre o jogo vem das ferramentas. Sua memória de Tormenta 20 não é confiável: nomes, números e páginas saem do que as ferramentas devolveram nesta conversa. Se não achou, diga que não achou — nunca complete de cabeça.
- Pergunta direta ("o que faz Ataque Poderoso?") pede uma busca e um \`ver\`.
- Sobre uma raça, classe, divindade, origem ou distinção inteira, \`ficha\` devolve tudo de uma vez (o que ela dá e em que nível).
- Regra geral, ambientação, deuses, lugares e NPCs: \`livros\` devolve trechos dos livros com a página.
- Leve em conta o que a pessoa já contou (raça, classe, nível, devoção). Se faltar um detalhe que muda a resposta, responda para o caso geral e diga o que mudaria.

## Perguntas de construção
"Quero um personagem veloz", "o que pego para dar mais dano à distância?", "como monto um tanque?", "vale a pena tal poder?". Aqui a pessoa quer o conselho de quem conhece o sistema inteiro, e o erro a evitar é responder com as primeiras coisas que aparecem. Faça assim:
1. Traduza o conceito em MECÂNICAS, pensando no que o personagem quer fazer na mesa. "Veloz" não é só deslocamento em metros: é também ganhar ações de movimento extras, mover-se sem gastar ação, investida, ignorar terreno difícil, voar, teleportar, agir primeiro. Escolha de 2 a 4 temas que cubram isso.
2. Chame \`panorama\` com esses temas. Ele devolve TUDO o que o acervo tem sobre eles — raças e linhagens, origens, poderes de todo tipo, magias, itens, parceiros —, sem corte. Leia a lista inteira: a melhor opção costuma estar onde não se espera (uma origem, uma linhagem de raça, um item, uma magia de 2º círculo, um poder de combate).
3. Separe o forte do situacional. Vale mais: efeito permanente e sem custo; o que soma com os outros; ação extra (uma ação de movimento a mais por turno costuma valer mais que alguns metros); o que funciona desde nível baixo e em qualquer cena. Vale menos: o que só funciona num terreno ou numa condição rara, o que custa muito PM para pouco, o que dura uma rodada.
4. Leia com \`ver\` o texto completo de tudo o que vai recomendar (até 20 ids por chamada) e confira pré-requisito, custo, duração e ação. Quando a resposta depende de uma regra (como funciona a investida, o que conta como ação de movimento, se dois bônus se acumulam), confirme em \`livros\` antes de afirmar.
5. Não deixe de fora, se existirem na lista: magias (quem não conjura pode usar por poção, pergaminho ou item que lança a magia — o panorama marca "pode virar poção"), itens mágicos e comuns, origens, parceiros e montarias, linhagens e variantes de raça.
6. Se a pessoa já disse raça, classe ou nível, a resposta é para AQUELE personagem: o que ele pode pegar já e em que ordem. O que exigiria outra raça, outra classe ou devoção fica numa linha à parte, sem entrar como opção.

## Como responder
- Português do Brasil, direto, no tom de um mestre experiente ajudando um jogador. Comece pela resposta.
- Seja explícito sobre exclusividade. Habilidade de raça só existe para aquela raça ou linhagem e não se pega de outro jeito; poder de classe exige níveis na classe; concedido exige ser devoto; distinção exige admissão em jogo. Não ofereça como opção o que o personagem descrito não pode pegar — diga o que ele precisaria ser.
- Cite a fonte de cada item como (Livro, p. N) quando a ferramenta trouxer a página. Material fora do Livro Básico depende de o mestre aceitar.
- Ao citar um item do acervo, escreva o nome como link usando o id que a ferramenta devolveu: [Atlético](d:atletico), [Velocidade](o:velocidade), [Botas Velozes](c:itens/itens-magicos-botas-velozes). Nunca invente um id.
- Listas curtas, uma linha por opção, com o número que importa, o pré-requisito e o custo em PM quando houver. Markdown simples: títulos com ##, listas e negrito; sem tabelas.
- Pergunta direta: resposta que caiba numa tela.
- Pergunta de construção, em camadas:
  1. **O essencial** em 3 a 6 linhas: as escolhas que mais mudam o jogo e por quê.
  2. **As opções por como se obtém**: raça e linhagem; origem; poderes gerais; habilidades e poderes de classe; concedidos; distinções; magias; itens; parceiros. Só as que valem a pena, das melhores para as situacionais.
  3. **Combinação sugerida**, com a conta feita (ex.: 12m da raça + 3m + 3m = 18m, e +6m por 1 PM na rodada) e a ordem de pegar por nível quando fizer sentido.
  4. **Cuidado**: o que parece bom e não é, o que não se acumula, o que depende do mestre.
  Pode ser longa; o que não pode é ser rasa nem deixar de fora uma opção forte para caber numa tela. Feche oferecendo aprofundar num caminho.`;

const CLASSIFICADOR = `Você separa perguntas de jogadores de Tormenta 20 em dois tipos. Responda com UMA palavra: PROFUNDA ou DIRETA.
PROFUNDA: pede para montar, melhorar ou comparar opções de personagem (o que pegar para ser ou fazer algo; melhores raças, poderes, magias ou itens para um objetivo; combinações; plano por nível; "vale a pena?"; análise de uma ficha), ou exige cruzar várias regras e opções para concluir.
DIRETA: o que faz um poder, magia ou item específico; uma regra pontual; um fato do cenário; a ficha de uma raça ou classe; conversa.`;
// reserva do classificador (API fora do ar ou resposta estranha): palavras de quem está montando personagem
const PARECE_PROFUNDA = /personagem|build|ficha|focad|melhor|mais forte|otimiz|combo|combina|sugest|recomend|op[cç][oõ]es|vale a pena|quais|como (eu )?(fa[cç]o|fico|monto|aumento|consigo)|o que (eu )?(pego|devo)/i;

export function ferramentasDoModelo(temas, colecoes) {
  return [
    { name: "panorama",
      description: "TUDO o que o acervo tem sobre 1 a 4 temas mecânicos, de uma vez e sem corte, agrupado por como se obtém: raças, habilidades de raça e linhagem, origens, poderes gerais, de raça, de classe, concedidos, distinções, magias (marcando as que podem virar poção), itens e parceiros. É o ponto de partida de toda pergunta de construção de personagem ou de comparação de opções: `buscar` devolve só um pedaço da lista. Devolve uma linha por opção (id, nome, de quem é, página, pré-requisito, custo, resumo); leia inteiro e use `ver` no que for recomendar.",
      input_schema: { type: "object", properties: { temas: { type: "array", items: { type: "string", enum: temas }, minItems: 1, maxItems: 4, description: "os temas que cobrem o conceito (ex.: personagem veloz = deslocamento, movimento-extra, investida)" } }, required: ["temas"] } },
    { name: "buscar",
      description: "Procura no acervo estruturado do hub por palavras, por trecho exato ou por filtro. Use para achar um item pelo nome, para perguntas pontuais e para refinar depois do `panorama` (ex.: só os poderes de uma classe). Devolve uma lista curta (id, nome, como se obtém, pré-requisito, resumo); use `ver` para ler o texto completo. Em poderes, magias, raças, itens e parceiros o filtro `tema` acha o que FAZ aquilo mesmo que o texto use outras palavras; combine com `acesso` e `dono` para cortar. ATENÇÃO: sem `consulta`, a lista sai em ordem alfabética e cortada no `limite` — para ver tudo de um tema use `panorama`.",
      input_schema: { type: "object", properties: {
        onde: { type: "string", enum: ["poderes", "magias", "racas", "classes", "origens", "divindades", "distincoes", ...colecoes, "tudo"], description: "em que parte do acervo procurar" },
        consulta: { type: "string", description: "palavras ou frase curta em português; pode ficar vazio quando há filtros. Um trecho entre aspas é exato e aceita variáveis: # = qualquer número, % = uma a quatro palavras, (a|b) = alternativas. Ex.: \"+#m\" acha tudo que dá +3m, +6m… (vem do maior para o menor, com o trecho); \"+# na Defesa\"; \"+# em %\"; \"#d# de dano de fogo\". Use quando a pergunta é sobre um número ou uma frase de regra específica." },
        tema: { type: "string", enum: temas, description: "tema mecânico (poderes, magias, raças, itens e parceiros)" },
        acesso: { type: "string", enum: ["raca", "poder-raca", "classe-habilidade", "classe-poder", "geral", "concedido", "origem", "distincao", "complicacao"], description: "só poderes: como se obtém. raca = habilidade inata da raça; poder-raca = poder geral exclusivo de uma raça; geral = qualquer personagem" },
        dono: { type: "string", description: "só poderes: raça, classe, divindade, origem ou distinção dona (ex.: Elfo, Guerreiro, Marah, Aeronauta Goblin)" },
        circulo: { type: "integer", description: "só magias: círculo de 1 a 5" },
        limite: { type: "integer", description: "quantos resultados (padrão 20, máximo 60)" },
      }, required: ["onde"] } },
    { name: "ver",
      description: "Lê o texto completo de até 20 itens pelo id devolvido por `panorama`, `buscar` ou `ficha` (d:… poder, o:… magia, c:coleção/id item, parceiro, ameaça ou regra). Traz pré-requisitos, custo, livro e página, como se obtém e o que o item libera.",
      input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "ids exatamente como vieram das outras ferramentas" } }, required: ["ids"] } },
    { name: "ficha",
      description: "A ficha inteira de uma raça, classe, divindade, origem ou distinção: atributos, deslocamento e habilidades da raça (com linhagens e listas de opções); PV/PM, habilidades por nível e lista de poderes da classe; devotos e poderes concedidos da divindade; benefícios da origem; poderes da distinção.",
      input_schema: { type: "object", properties: {
        tipo: { type: "string", enum: ["raca", "classe", "divindade", "origem", "distincao"] },
        nome: { type: "string", description: "nome como no livro (ex.: Elfo, Bárbaro, Marah, Gladiador, Cavaleiro da Luz)" },
      }, required: ["tipo", "nome"] } },
    { name: "livros",
      description: "Trechos dos livros de Tormenta 20 (Livro Básico, Heróis, Deuses, Ameaças, Atlas, Deuses Menores, Guia de NPCs, Dragão Brasil, FAQ do Tribunal Regreiro) mais parecidos com a consulta, com livro e página. Use para regras gerais (ações, movimento, investida, acúmulo de bônus, condições), casos de mesa, ambientação, história, deuses, lugares e personagens. Escreva a consulta como uma pergunta ou frase completa.",
      input_schema: { type: "object", properties: {
        consulta: { type: "string" },
        livro: { type: "string", description: "opcional: restringe a um livro (ex.: Atlas de Arton)" },
      }, required: ["consulta"] } },
  ];
}

/** O que mostrar pra pessoa enquanto a ferramenta roda. */
export function statusDe(nome, input = {}) {
  const onde = { poderes: "poderes", magias: "magias", racas: "raças", classes: "classes", origens: "origens", divindades: "divindades", distincoes: "distinções", tudo: "o acervo" }[input.onde] || input.onde || "";
  if (nome === "panorama") return `🧭 levantando tudo sobre ${[].concat(input.temas || []).join(", ") || "o tema"}`;
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
const aceitaEsforco = (modelo) => !/haiku-4-5|sonnet-4-5/.test(modelo); // os modelos 4.5 não aceitam o parâmetro de esforço
const TETO = { panorama: 90_000 }; // caracteres por resultado de ferramenta (o panorama de três temas passa de 70 mil)

const LINK = /\[([^\]]+)\]\(((?:d|o|c):[\w\-/.]+)\)/g; // [Atlético](d:atletico)

/** `existe(id)` (opcional) confere um id de carta: link para id que o modelo inventou vira texto simples, em vez de abrir "não existe". */
export function criarArauto({ dados, ferramentas, temas, colecoes = [], lerJson, gravarJson, existe = null, buscar = fetch, agora = () => Date.now(), silencioso = false }) {
  const arqCfg = join(dados, "arauto.json"), arqUso = join(dados, "arauto-uso.json"), arqLog = join(dados, "arauto-log.jsonl"), arqPrimer = join(dados, "arauto-primer.md");
  const cfg = () => ({ ...PADRAO, ...lerJson(arqCfg, {}) });
  const tools = ferramentasDoModelo(temas, colecoes);
  let sistema = null; // montado uma vez: mudar o texto invalida o cache de prompt
  const sistemaDe = () => (sistema ??= SISTEMA + (existsSync(arqPrimer) ? "\n\n" + readFileSync(arqPrimer, "utf-8").trim() : ""));
  let uso = null;

  /** Dentro da cota de hoje? Conta a pergunta. `fundo` = a cota (menor) das respostas do modo profundo. */
  function gastar(quem, canal, fundo = false) {
    const c = cfg(), hoje = dia(agora());
    uso ??= lerJson(arqUso, {});
    if (uso.dia !== hoje) uso = { dia: hoje, n: {}, p: {} };
    const k = `${canal}:${String(quem).toLowerCase()}`, conta = fundo ? (uso.p ??= {}) : uso.n;
    const limite = canal === "papinho" ? (fundo ? c.limiteDiaBotProfundo : c.limiteDiaBot) : (fundo ? c.limiteDiaProfundo : c.limiteDia);
    if ((conta[k] || 0) >= limite) return false;
    conta[k] = (conta[k] || 0) + 1;
    gravarJson(arqUso, uso);
    return true;
  }

  async function chamar(c, corpo, limiteMs = 120_000) {
    for (let tentativa = 0; ; tentativa++) {
      let r;
      try {
        // shortcut: pedido sem streaming, com espera de até 5 min por chamada; se as respostas longas começarem a estourar, trocar por streaming (SSE)
        r = await buscar(API, { method: "POST", signal: AbortSignal.timeout(limiteMs),
          headers: { "x-api-key": c.chave, "anthropic-version": VERSAO, "content-type": "application/json" }, body: JSON.stringify(corpo) });
      } catch (e) { if (tentativa >= 2) throw new Error("sem resposta da API (" + e.message + ")"); await new Promise((ok) => setTimeout(ok, 1500 * (tentativa + 1))); continue; }
      if (r.ok) return r.json();
      const texto = await r.text().catch(() => "");
      // sobrecarga, limite de taxa e erro do servidor valem outra tentativa; o resto (400, 401, 404) é erro nosso e não adianta repetir
      if ([408, 409, 429, 500, 502, 503, 504, 529].includes(r.status) && tentativa < 2) { await new Promise((ok) => setTimeout(ok, Math.min(20_000, (Number(r.headers.get("retry-after")) || 2 * (tentativa + 1)) * 1000))); continue; }
      throw Object.assign(new Error(`API ${r.status}: ${texto.slice(0, 300)}`), { status: r.status });
    }
  }

  /** A pergunta pede o modo profundo? Uma chamada curta no modelo barato; se ela falhar, decide pelas palavras. */
  async function ehProfunda(c, pergunta, historico) {
    if (!c.classificar || !c.modeloProfundo) return false;
    try {
      const contexto = (historico || []).slice(-2).map((h) => `${h.de === "arauto" ? "Arauto" : "Jogador"}: ${String(h.texto || "").slice(0, 300)}`).join("\n");
      const corpo = { model: c.modelo, max_tokens: 400, system: CLASSIFICADOR, messages: [{ role: "user", content: (contexto ? `Conversa até aqui:\n${contexto}\n\n` : "") + `Pergunta a classificar:\n${pergunta}` }] };
      if (aceitaEsforco(c.modelo)) corpo.output_config = { effort: "low" };
      const r = await chamar(c, corpo, 20_000);
      const t = (r.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").toUpperCase();
      if (/PROFUNDA/.test(t)) return true;
      if (/DIRETA/.test(t)) return false;
    } catch {}
    return pergunta.length > 50 && PARECE_PROFUNDA.test(pergunta);
  }

  /**
   * Responde uma pergunta. `avisar(texto)` recebe o andamento ("🔎 procurando…") pra mostrar enquanto espera.
   * Devolve { resposta, itens (ids citados), modo, ms, uso } ou { erro, resposta } — nunca lança.
   */
  async function responder({ pergunta, historico = [], quem = "?", canal = "site", avisar = () => {} }) {
    const t0 = agora(), c = cfg();
    pergunta = String(pergunta || "").trim().slice(0, 4000);
    const reg = { t: new Date(t0).toISOString(), quem, canal, modelo: c.modelo, pergunta, ferramentas: [] };
    const fim = (r) => {
      Object.assign(reg, { ms: agora() - t0, resposta: String(r.resposta || "").slice(0, 12_000), erro: r.erro, uso: r.uso });
      if (!silencioso) try { appendFileSync(arqLog, JSON.stringify(reg) + "\n"); } catch {}
      return { ...r, ms: reg.ms };
    };
    if (!pergunta) return { erro: "vazio", resposta: "Pergunte alguma coisa. 🙂" };
    if (!c.chave) return fim({ erro: "sem-chave", resposta: "O Arauto ainda não tem a chave da API configurada no servidor." });
    if (!gastar(quem, canal)) return fim({ erro: "cota", resposta: "Você chegou ao limite de perguntas ao Arauto por hoje. Amanhã tem mais." });

    const total = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0, chamadas: 0 };
    try {
      // modo profundo tem cota própria: quem estourou continua sendo atendido, no modo direto
      const fundo = (await ehProfunda(c, pergunta, historico)) && gastar(quem, canal, true);
      const modelo = !fundo ? c.modelo : (canal === "papinho" && c.modeloProfundoBot) || c.modeloProfundo, rodadas = fundo ? c.rodadasProfundo : c.rodadas, orcamento = canal === "papinho" ? c.tempoBotMs : c.tempoSiteMs;
      Object.assign(reg, { modelo, modo: fundo ? "profundo" : "direto" });
      if (fundo) avisar("🧠 pergunta de construção: vou levantar tudo o que existe e pensar com calma (pode levar um ou dois minutos)");

      const messages = mensagensDe(historico, pergunta);
      const corpoBase = { model: modelo, max_tokens: fundo ? c.maxTokensProfundo : c.maxTokens, tools, cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: sistemaDe(), cache_control: { type: "ephemeral" } }] };
      if (aceitaEsforco(modelo)) corpoBase.output_config = { effort: fundo ? c.esforcoProfundo : c.esforco };
      let avisado = false; // já mandamos responder (sem rodadas ou sem tempo): se ainda assim vier pedido de ferramenta, encerra com o que há
      for (let rodada = 0; rodada <= rodadas; rodada++) {
        const r = await chamar(c, { ...corpoBase, messages }, Math.max(30_000, Math.min(300_000, orcamento - (agora() - t0) + 30_000)));
        total.chamadas++; total.entrada += r.usage?.input_tokens || 0; total.saida += r.usage?.output_tokens || 0;
        total.cacheLido += r.usage?.cache_read_input_tokens || 0; total.cacheEscrito += r.usage?.cache_creation_input_tokens || 0;
        if (r.stop_reason === "refusal") return fim({ erro: "recusa", resposta: "Não posso ajudar com esse pedido. Se era uma dúvida de Tormenta 20, tente reformular.", uso: total });
        const texto = (r.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        const usos = (r.content || []).filter((b) => b.type === "tool_use");
        if (r.stop_reason !== "tool_use" || !usos.length || rodada === rodadas || avisado) {
          const bruta = texto || "Procurei e não consegui montar uma resposta. Tente perguntar de outro jeito.";
          const resposta = existe ? bruta.replace(LINK, (m, rotulo, id) => (existe(id) ? m : rotulo)) : bruta;
          return fim({ resposta: r.stop_reason === "max_tokens" ? resposta + "\n\n*(a resposta foi cortada por tamanho — peça para continuar)*" : resposta,
            itens: [...new Set([...resposta.matchAll(LINK)].map((m) => m[2]))], modo: reg.modo, modelo: reg.modelo, uso: total });
        }
        // o turno do modelo volta inteiro e sem mexer (blocos de raciocínio incluídos): a API confere isso
        messages.push({ role: "assistant", content: r.content });
        const resultados = await Promise.all(usos.map(async (u) => {
          avisar(statusDe(u.name, u.input));
          reg.ferramentas.push({ nome: u.name, ...u.input });
          try {
            if (!ferramentas[u.name]) throw new Error("ferramenta desconhecida");
            const saida = await ferramentas[u.name](u.input || {});
            return { type: "tool_result", tool_use_id: u.id, content: String(saida || "(nada encontrado)").slice(0, TETO[u.name] || 30_000) };
          } catch (e) { return { type: "tool_result", tool_use_id: u.id, content: "erro: " + e.message, is_error: true }; }
        }));
        // todos os resultados numa mensagem só; na penúltima rodada, ou passada a metade do tempo, o aviso vai junto (depois dos resultados)
        avisado = rodada === rodadas - 1 || agora() - t0 > orcamento / 2;
        messages.push({ role: "user", content: avisado ? [...resultados, { type: "text", text: "Você já buscou o suficiente. Responda agora com o que encontrou, sem novas buscas." }] : resultados });
      }
    } catch (e) {
      if (!silencioso) console.error("arauto:", e.message);
      return fim({ erro: "api", detalhe: e.message, resposta: e.status === 401 ? "A chave da API do Arauto foi recusada. Avise o mestre." : "O Arauto não conseguiu falar com o modelo agora. Tente de novo em instantes.", uso: total });
    }
  }

  /** Token do bot do Papinho (dados/arauto.json → botToken), comparado em tempo constante. */
  const botAutorizado = (cabecalho) => { const t = cfg().botToken, m = /^Bearer (.+)$/.exec(cabecalho || ""); return !!(t && m && iguais(m[1], t)); };
  return { responder, botAutorizado, pronto: () => !!cfg().chave, modelo: () => cfg().modelo, modeloProfundo: () => (cfg().classificar ? cfg().modeloProfundo : "") };
}

// self-test: node lib/arauto.mjs --check  (API falsa: confere o laço de ferramentas, a escolha do modo, a cota e o formato das mensagens)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/arauto.mjs") && process.argv.includes("--check")) {
  const falha = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  const m1 = mensagensDe([{ de: "arauto", texto: "oi" }, { de: "eu", texto: "a" }, { de: "eu", texto: "b" }, { de: "arauto", texto: "c" }], "d");
  if (JSON.stringify(m1) !== JSON.stringify([{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }])) falha("mensagensDe: " + JSON.stringify(m1));
  const montar = (config, respostas) => {
    const pedidos = [], disco = { "arauto.json": config };
    const A = criarArauto({ dados: "/x", temas: ["deslocamento"], silencioso: true, agora: () => 1_800_000_000_000,
      lerJson: (a, p) => disco[a.replace(/\\/g, "/").split("/").pop()] ?? p, gravarJson: (a, o) => { disco[a.replace(/\\/g, "/").split("/").pop()] = o; },
      ferramentas: { buscar: async (i) => "d:atletico | Atlético | tema " + i.tema, panorama: async () => "x".repeat(95_000) },
      buscar: async (url, o) => { pedidos.push(JSON.parse(o.body)); const r = respostas[pedidos.length - 1]; return { ok: true, json: async () => r }; } });
    return { A, pedidos, disco };
  };
  const respostas = [
    { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "buscar", input: { onde: "poderes", tema: "deslocamento" } }, { type: "tool_use", id: "t2", name: "explodir", input: {} }] },
    { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 9 }, content: [{ type: "text", text: "Pegue [Atlético](d:atletico) e [Velocidade](o:velocidade)." }] },
  ];
  const { A, pedidos, disco } = montar({ chave: "k", botToken: "segredo", limiteDia: 2, rodadas: 2, classificar: false }, respostas);
  const avisos = [];
  const r = await A.responder({ pergunta: "como ficar veloz?", quem: "Ray", avisar: (t) => avisos.push(t) });
  if (r.erro || JSON.stringify(r.itens) !== '["d:atletico","o:velocidade"]' || r.uso.chamadas !== 2 || r.uso.cacheLido !== 9 || r.modo !== "direto") falha("responder: " + JSON.stringify(r));
  const segundo = pedidos[1].messages;
  if (segundo.length !== 3 || segundo[1].content[0].type !== "thinking" || segundo[2].content.length !== 2) falha("o turno do modelo e os dois resultados deviam voltar inteiros: " + JSON.stringify(segundo));
  if (segundo[2].content[0].content !== "d:atletico | Atlético | tema deslocamento" || !segundo[2].content[1].is_error) falha("resultado de ferramenta / erro de ferramenta desconhecida");
  if (pedidos[0].system[0].cache_control?.type !== "ephemeral" || pedidos[0].output_config.effort !== "medium" || pedidos[0].model !== "claude-haiku-5-5" || pedidos[0].thinking || pedidos[0].temperature != null) falha("corpo do pedido");
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
  if (statusDe("ver", { ids: ["a"] }) !== "📖 lendo 1 texto" || !statusDe("panorama", { temas: ["voo"] }).includes("voo")) falha("statusDe");

  // modo profundo: o classificador (modelo barato) diz PROFUNDA → modelo forte, esforço alto; panorama passa do teto comum; cota própria
  const fundo = montar({ chave: "k", modeloProfundo: "forte", modeloProfundoBot: "medio", esforcoProfundo: "high", limiteDiaProfundo: 1 }, [
    { stop_reason: "end_turn", content: [{ type: "text", text: "PROFUNDA" }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "panorama", input: { temas: ["deslocamento"] } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "resposta longa" }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Profunda." }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "resposta curta" }] },
  ]);
  const av = [];
  const f1 = await fundo.A.responder({ pergunta: "quero um personagem veloz", quem: "Ray", avisar: (t) => av.push(t) });
  const [pc, p1, p2] = fundo.pedidos;
  if (f1.modo !== "profundo" || pc.model !== "claude-haiku-5-5" || pc.max_tokens !== 400 || pc.tools || p1.model !== "forte" || p1.output_config.effort !== "high" || p1.max_tokens !== 24000) falha("modo profundo: " + JSON.stringify([f1.modo, pc.model, p1.model, p1.output_config]));
  if (p2.messages.at(-1).content[0].content.length !== 90_000 || !av[0].includes("🧠")) falha("panorama devia passar inteiro até 90 mil caracteres e o aviso de modo profundo vir primeiro");
  const f2 = await fundo.A.responder({ pergunta: "quero um personagem forte", quem: "Ray" });
  if (f2.modo !== "direto" || fundo.pedidos[4].model !== "claude-haiku-5-5") falha("cota do modo profundo esgotada devia cair no modo direto: " + JSON.stringify(f2));
  const noBot = montar({ chave: "k", modeloProfundo: "forte", modeloProfundoBot: "medio" }, [{ stop_reason: "end_turn", content: [{ type: "text", text: "PROFUNDA" }] }, { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  await noBot.A.responder({ pergunta: "quero um personagem veloz", quem: "a", canal: "papinho" });
  if (noBot.pedidos[1].model !== "medio") falha("no bot o modo profundo usa o modelo do bot: " + noBot.pedidos[1].model);
  // link para id que não existe vira texto simples (o modelo barato às vezes inventa um id parecido)
  const comLinks = criarArauto({ dados: "/x", temas: [], silencioso: true, lerJson: (a, p) => (a.endsWith("arauto.json") ? { chave: "k", classificar: false } : p), gravarJson: () => {}, ferramentas: {},
    existe: (id) => id === "d:atletico", buscar: async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Pegue [Atlético](d:atletico) e [Bota](c:itens/inventada)." }] }) }) });
  const rl = await comLinks.responder({ pergunta: "x", quem: "a" });
  if (rl.resposta !== "Pegue [Atlético](d:atletico) e Bota." || rl.itens.join() !== "d:atletico") falha("link inventado devia virar texto: " + JSON.stringify(rl));
  // classificador fora do ar: decide pelas palavras da pergunta
  const semClassificador = montar({ chave: "k", modeloProfundo: "forte" }, [{ stop_reason: "end_turn", content: [] }, { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }, { stop_reason: "end_turn", content: [] }, { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  if ((await semClassificador.A.responder({ pergunta: "quais os melhores poderes para um personagem focado em investida?", quem: "a" })).modo !== "profundo") falha("reserva por palavras devia dar profundo");
  if ((await semClassificador.A.responder({ pergunta: "o que faz Ataque Poderoso?", quem: "a" })).modo !== "direto") falha("pergunta pontual devia ser direta");
  if (!process.exitCode) console.log("arauto.mjs --check OK");
}
