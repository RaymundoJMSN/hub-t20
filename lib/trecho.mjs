// lib/trecho.mjs — o trecho "entre aspas" da busca: texto cru, com VARIÁVEIS.
//
//   #        qualquer número (3, 12, 1,5, 12.000)            "+#m"   "#d# de dano"   "custa # PM"   "T$ #"
//   %        de uma a quatro palavras, na mesma frase         "+# em %"   "imune a %"   "+#m % deslocamento"
//   (a|b)    uma das alternativas                             "+#m % (deslocamento|movimento)"
//   \#  \%   o próprio sinal. Também são o sinal: % colado num número ("25%", "#% de chance") e # colado num dígito ("DB #219")
//
// O resto casa como está escrito, com borda de palavra dos dois lados ("1/4" não acha "11/40"; "#m" não acha o "3m"
// de "13m" nem o "5m" de "1,5m"). Casa sobre texto normalizado (minúsculas, sem acento).
//
// Não trava o servidor (medido no self-test com textos maldosos): vários # ou % colados valem um só — é de onde vinha o
// retrocesso polinomial —, % anda de palavra em palavra (no máximo quatro) e não atravessa fim de frase, alternativas
// são texto escapado, sem repetição, e no máximo quatro grupos; o padrão tem tamanho e número de variáveis limitados.

const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"); // acentos soltos depois do NFD
export const norm = (x) => (x || "").toLowerCase().normalize("NFD").replace(MARCAS, "");
const ESC = /[.*+?^${}()|[\]\\]/g;
const lit = (s) => s.replace(ESC, "\\$&").replace(/\s+/g, "\\s+");
// número como os livros escrevem: ponto separa milhar ("T$ 12.000"), vírgula é o decimal ("1,5m"); o ponto final da frase não entra
const NUM = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)";
/** "12.000" → 12000 · "1,5" → 1.5 */
export const valorDe = (s) => parseFloat(String(s).replace(/\./g, "").replace(",", "."));
// palavra do %: qualquer sequência sem espaço que NÃO termina em pontuação de fim de frase — assim o % não emenda
// "…de dano." com "Deslocamento…" da frase seguinte. De uma a quatro, começando depois de um espaço.
const PAL = "\\S*[^\\s.;:!?]", PALAVRAS = `(?<!\\S)${PAL}(?:\\s+${PAL}){0,3}?(?![a-z0-9])`;
const MAX_TAM = 300, MAX_NUM = 8, MAX_PAL = 5, MAX_GRUPOS = 4;
// O que a mesa fala × o que o livro escreve. No trecho, a palavra da esquerda casa também com as da direita:
// "+#m de movimento" acha "+3m de deslocamento" (o livro nunca escreve "movimento" pra isso). A palavra digitada continua valendo.
const EQUIV = { movimento: ["deslocamento"], movimentacao: ["deslocamento"], vida: ["pv", "pontos de vida"], hp: ["pv", "pontos de vida"],
  mana: ["pm", "pontos de mana"], ca: ["defesa"] };
const NUNCA = { re: /(?!)/, reG: /(?!)/g, numeros: 0, variavel: false, vazio: true }; // trecho que não dá pra procurar: não casa com nada

const cache = new Map();
/** Trecho (já normalizado, sem as aspas) → { re, reG, numeros, variavel, vazio? } ; o mesmo objeto a cada chamada. */
export function padrao(t) {
  t = String(t).trim();
  if (t.length > MAX_TAM) { const corte = t.lastIndexOf(" ", MAX_TAM); t = t.slice(0, corte > MAX_TAM / 2 ? corte : MAX_TAM).trim(); } // frase colada inteira: vale o começo, sem cortar palavra
  if (cache.has(t)) return cache.get(t);
  let corpo = "", numeros = 0, palavras = 0, grupos = 0, texto = 0, demais = false, ultimo = "", primeiro = "";
  const poe = (re, tipo) => { corpo += re; ultimo = tipo; primeiro ||= tipo; };
  const alfa = (c) => /[a-z0-9]/.test(c || "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && (t[i + 1] === "#" || t[i + 1] === "%")) { poe(lit(t[++i]), "lit"); texto++; continue; }
    if (c === "#" && !/\d/.test(t[i + 1] || "")) { // "#219" (DB #219) é o próprio sinal
      if (ultimo === "num") continue; // "##" = um número só: dois \d+ colados é o que fazia a busca travar em sequência longa de dígitos
      if (++numeros > MAX_NUM) { demais = true; break; }
      poe(NUM, "num"); continue;
    }
    // % colado num número ("25%", "#%") é o sinal de porcentagem; dois % seguidos valem um
    if (c === "%" && ultimo !== "num" && !/\d/.test(t[i - 1] || "")) {
      if (ultimo === "pal" || (ultimo === "esp" && corpo.endsWith(PALAVRAS + "\\s+"))) continue;
      if (++palavras > MAX_PAL) { demais = true; break; }
      if (ultimo === "lit" && alfa(t[i - 1])) corpo += "\\s+"; // "dano%" = "dano %": o % é sempre palavra inteira
      poe(PALAVRAS, "pal");
      if (alfa(t[i + 1])) poe("\\s+", "esp"); // "%dano" = "% dano"
      continue;
    }
    if (c === "(" && grupos < MAX_GRUPOS) { // (a|b|c): alternativas de texto simples, sem repetição; parêntese sem barra é só um parêntese
      const fim = t.indexOf(")", i), dentro = fim > i ? t.slice(i + 1, fim) : "";
      if (dentro.includes("|") && !/[()#%\\]/.test(dentro)) {
        const alts = [...new Set(dentro.split("|").map((a) => a.trim()).filter(Boolean))];
        if (alts.length > 1) { grupos++; texto++; poe(`(?:${alts.map(lit).join("|")})`, "lit"); i = fim; continue; }
      }
    }
    if (/\s/.test(c)) { if (ultimo !== "esp") poe("\\s+", "esp"); continue; }
    texto++;
    if (/[a-z]/.test(c) && !alfa(t[i - 1])) { // começo de palavra: tem equivalente no livro?
      const palavra = t.slice(i).match(/^[a-z]+/)[0], eq = !alfa(t[i + palavra.length]) && EQUIV[palavra];
      if (eq) { poe(`(?:${[palavra, ...eq].map(lit).join("|")})`, "lit"); i += palavra.length - 1; continue; }
    }
    poe(lit(c), "lit");
  }
  let p = NUNCA;
  // só variável ("#", "%", "# %"), vazio, ou variável demais: não há o que procurar
  if (texto > 0 && !demais) {
    // borda esquerda: não começa no meio de palavra; e, se começa por número, nem depois de "1," ou "1." (o "5m" de "1,5m")
    const esq = primeiro === "pal" ? "" : "(?<![a-z0-9])" + (primeiro === "num" || /^\d/.test(t) ? "(?<!\\d[.,])" : "");
    const fonte = esq + corpo.replace(/\\s\+$/, "") + (ultimo === "pal" ? "" : "(?![a-z0-9])");
    p = { re: new RegExp(fonte), reG: new RegExp(fonte, "g"), numeros, variavel: numeros + palavras > 0 };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(t, p);
  return p;
}

/**
 * Onde o trecho aparece nos textos de um item. `campos`: textos ORIGINAIS (com acento), na ordem de preferência.
 * Devolve { trecho: [antes, casou, depois], num } — a primeira ocorrência (ou, se o trecho tem #, a do MAIOR número
 * do primeiro #, que é por onde a página ordena) com um pouco de contexto — ou null se não aparece em nenhum.
 */
export function destacar(campos, p, contexto = 48) {
  let melhor = null, num = null; // melhor = { visivel, ini, fim }
  for (const original of campos) {
    if (!original) continue;
    const texto = String(original), n = norm(texto);
    let vistos = 0, m;
    p.reG.lastIndex = 0;
    while ((m = p.reG.exec(n))) {
      if (!m[0]) break;
      const v = p.numeros ? valorDe(m[1]) : NaN;
      if (!melhor || (!Number.isNaN(v) && (num === null || v > num))) {
        // norm troca cada letra acentuada por uma sem acento: mesmo tamanho, mesmos índices. Confere NESTE ponto (texto com
        // caractere raro pode empatar no tamanho total e desalinhar no meio); se não bater, mostra o texto normalizado.
        const alinhado = n.length === texto.length && norm(texto.slice(0, m.index)).length === m.index && norm(texto.slice(m.index, m.index + m[0].length)) === m[0];
        melhor = { visivel: alinhado ? texto : n, ini: m.index, fim: m.index + m[0].length };
      }
      if (!Number.isNaN(v) && (num === null || v > num)) num = v;
      if (!p.numeros || ++vistos >= 300) break; // sem número pra comparar, a primeira ocorrência basta
      p.reG.lastIndex = m.index + 1; // ocorrências podem se sobrepor ("1 ou 2 das rolagens": o maior é o 2)
    }
    if (melhor && !p.numeros) break;
  }
  if (!melhor) return null;
  const { visivel, ini, fim } = melhor;
  let a = Math.max(0, ini - contexto), b = Math.min(visivel.length, fim + contexto);
  if (a > 0) { const e = visivel.indexOf(" ", a); if (e >= 0 && e < ini) a = e + 1; }
  if (b < visivel.length) { const e = visivel.lastIndexOf(" ", b); if (e > fim) b = e; }
  const trecho = [(a > 0 ? "…" : "") + visivel.slice(a, ini), visivel.slice(ini, fim), visivel.slice(fim, b) + (b < visivel.length ? "…" : "")].map((s) => s.replace(/\s+/g, " "));
  return { trecho, num: num ?? undefined };
}

// self-test: node lib/trecho.mjs --check
if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/trecho.mjs") && process.argv.includes("--check")) {
  const falha = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  const casa = (pad, texto) => padrao(norm(pad)).re.test(norm(texto));
  const sim = [["+#m", "recebe +3m em seu deslocamento"], ["+#m", "deslocamento +1,5m por nível"], ["#d# de dano", "causa 2d6 de dano de fogo"], ["+# em %", "recebe +2 em Atletismo e +3m"],
    ["+#m % deslocamento", "+3m em seu deslocamento"], ["+#m % deslocamento", "+6m de deslocamento"], ["+#m % (deslocamento|movimento)", "+3m de movimento extra"],
    ["imune a %", "você é imune a efeitos de medo."], ["imune a %.", "você é imune a medo."], ["fortificação 25%", "recebe fortificação 25%."], ["#% de chance", "tem 50% de chance de falha"], ["#%", "vende 10% mais caro"],
    ["# PM", "gaste 2 PM para"], ["(1 pm)", "custa (1 PM) por rodada"], ["1/4", "nd 1/4 · animal"], ["db \\#219", "veja DB #219"], ["db #219", "veja a DB #219"], ["% de fogo", "causa dano de fogo extra"],
    ["+2 na Defesa", "Você recebe +2 na Defesa."], ["dano%fogo", "dano de fogo"], ["+# em %", "+2 em Atletismo, e mais"], ["t$ #", "custa T$ 12.000 cada"], ["+##m", "ganha +13m"]];
  for (const [p, t] of sim) if (!casa(p, t)) falha(`"${p}" devia casar com «${t}»`);
  const nao = [["#m", "alcance13m"], ["+#m", "+3 metros"], ["1/4", "nd 11/40"], ["+#m % deslocamento", "+3m. Seu deslocamento"], ["+#m % deslocamento", "+3m de dano. Deslocamento extra"], ["imune a % medo", "imune a fogo. Medo"],
    ["+# em %", "+2 em"], ["#d#", "2d"], ["+#m % deslocamento", "+3m um dois tres quatro cinco deslocamento"], ["5m", "alcance 1,5m"], ["db #219", "veja a DB 5219"],
    ["#", "qualquer 3 coisa"], ["%", "qualquer coisa"], ["# %", "3 coisas"], ["", "qualquer"], [" ", "a b"], ["(a|b", "a"], ["# pm", "2 pmx"], ["a % b % c % d % e % f % g", "a 1 b 2 c 3 d 4 e 5 f 6 g"]];
  for (const [p, t] of nao) if (casa(p, t)) falha(`"${p}" NÃO devia casar com «${t}»`);
  if (padrao("#m").re.exec("+13m")?.[1] !== "13") falha("o número é pego inteiro (13, não 3)");
  if (padrao("#m").re.exec("x 1,5m")?.[1] !== "1,5") falha("decimal inteiro (1,5), não o 5 depois da vírgula");
  if (padrao("% % deslocamento").re.source !== padrao("% deslocamento").re.source || padrao("+###m").re.source !== padrao("+#m").re.source) falha("variáveis repetidas coladas valem uma");
  if (!padrao("+#m").variavel || padrao("+2 na defesa").variavel || !padrao("#").vazio || !padrao("").vazio || !padrao(" ").vazio || padrao("#%").vazio || padrao("db #219").numeros !== 0) falha("variavel/vazio/sinal");
  if (padrao("(a|a|a|b)").re.source !== padrao("(a|b)").re.source) falha("alternativa repetida conta uma vez");
  for (const [p, t] of [["+#m de movimento", "ganha +3m de deslocamento"], ["+#m de movimento", "ganha +3m de movimento"], ["+# de vida", "recebe +5 de pontos de vida"], ["# de mana", "gasta 2 de pm"], ["acao de movimento", "gasta uma ação de movimento"]])
    if (!casa(p, t)) falha(`equivalência: "${p}" devia casar com «${t}»`);
  if (casa("movimentos", "deslocamentos") || casa("cavalo", "defesa")) falha("equivalência só vale pra palavra inteira");
  const longo = padrao("palavra ".repeat(60) + "(b|c) fim");
  if (longo.vazio || /\\\(b/.test(longo.re.source)) falha("padrão comprido é cortado em palavra inteira, sem partir grupo");
  // destaque: acento preservado, a ocorrência do MAIOR número, milhar com ponto, ocorrências sobrepostas, mais de 30 ocorrências
  const d = destacar(["", "Você recebe +3m em seu deslocamento. No 11º nível, o bônus vira +6m e você não é reduzido por armadura."], padrao("+#m"));
  if (JSON.stringify(d.trecho) !== JSON.stringify(["…seu deslocamento. No 11º nível, o bônus vira ", "+6m", " e você não é reduzido por armadura."]) || d.num !== 6) falha("destacar mostra a ocorrência do MAIOR número: " + JSON.stringify(d));
  if (destacar(["Você recebe +3m aqui e +2m ali."], padrao("recebe +#m")).trecho[1] !== "recebe +3m") falha("destaque do primeiro quando é o maior");
  if (destacar(["ação padrão"], padrao("acao padrao")).trecho[1] !== "ação padrão") falha("destaque devia sair com o acento do original");
  if (destacar(["nada aqui"], padrao("+#m")) !== null) falha("sem ocorrência devia ser null");
  if (destacar(["+1,5m e +3m"], padrao("+#m")).num !== 3 || destacar(["+1,5m"], padrao("+#m")).num !== 1.5) falha("número com vírgula");
  const preco = destacar(["Preço: T$ 1000. Outro: T$ 12.000, e T$ 300."], padrao("t$ #"));
  if (preco.num !== 12000 || preco.trecho[1] !== "T$ 12.000") falha("milhar com ponto: " + JSON.stringify(preco));
  if (padrao("t$ #").re.exec("custa t$ 100. depois")?.[1] !== "100") falha("o ponto final da frase não faz parte do número");
  if (destacar(["qualquer resultado 1 ou 2 das rolagens de dano"], padrao("# % de dano")).num !== 2) falha("ocorrências sobrepostas: vale o maior");
  if (destacar(["+1m ".repeat(40) + "e depois +9m"], padrao("+#m")).num !== 9) falha("o maior número depois de muitas ocorrências");
  const raro = destacar(["한 bonus +3m aqui éé fim"], padrao("+#m")); // tamanho total empata, índices não: mostra o normalizado em vez de cortar errado
  if (raro.trecho[1] !== "+3m") falha("texto com caractere que muda de tamanho ao normalizar: " + JSON.stringify(raro));
  // não trava com padrão maldoso sobre texto maldoso (o servidor testa o padrão contra milhares de textos, de forma síncrona)
  const textos = ["a ".repeat(4000) + "xyz ".repeat(2000), "1".repeat(3000) + " y", "a".repeat(40) + " z", "a-".repeat(6000), "x. ".repeat(5000), "a, b; c: ".repeat(2000)];
  const maldosos = ["% % % % z", "#######x", "+######", "######x", "%a%a%a%a", "(a|a|a)".repeat(16) + "y", "(a|ab|abc|a) % (a|a) % a % b", "% a % a % a % q", "#,#,#,#x", "# % # % # % z", "%#%#%#%z"];
  let pior = 0;
  for (const p of maldosos) for (const t of textos) { const t0 = Date.now(); padrao(p).re.test(t); destacar([t], padrao(p)); pior = Math.max(pior, Date.now() - t0); }
  if (pior > 250) falha(`padrão maldoso levou ${pior} ms`);
  if (!process.exitCode) console.log("trecho.mjs --check OK");
}
