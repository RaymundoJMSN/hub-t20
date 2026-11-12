// Hub T20 — um servidor só (Node puro, sem dependências) pra mesa inteira:
// grimório/criador de magias (herdado do criador-magias), bestiário, itens, regras (livros + STR),
// compêndio, missões, agenda, links — tudo atrás de login com senha.
// node server.mjs [--check] | PORT=8100
// node server.mjs --usuario "Nome" senha [jogador|mestre] ["Personagem"]   → cria/atualiza conta
import http from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { calcular } from "./static/custo.mjs";
import { esc, htmlParaTexto, ROTULOS } from "./static/carta.mjs";
import { tipoDePocao, tipoDePocaoDosEixos } from "./static/pocao.mjs";
import { eixosDe } from "./static/eixos.mjs";
import { paraFoundry, normalizar as normalizarAmeaca, ND_ORDEM, tipoLinha } from "./static/ameaca.mjs";
import { gzipSync } from "node:zlib";
import { TEMA_IDS, TEMA_ROTULO, temasDaConsulta } from "./static/temas.mjs";
import { criarVetores, fundir, LONGO } from "./lib/vetores.mjs";
import { criarArauto } from "./lib/arauto.mjs";
import { padrao, destacar } from "./lib/trecho.mjs";

// a magia da mesa vira a mesma linha técnica das oficiais, pra cair no mesmo parser
function eixosDaMesa(e = {}) {
  const r = e.resistencia;
  return eixosDe(ROTULOS.execucao[e.execucao], ROTULOS.alcance[e.alcance],
    !r || r === "nenhuma" ? "nenhuma" : `${e.teste || ""} ${ROTULOS.resistencia[r] || ""}`);
}

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DADOS = join(RAIZ, "dados");
const ARQ = join(DADOS, "estado.json");
const TABELA = JSON.parse(readFileSync(join(RAIZ, "data", "tabela-custos.json")));
const PORT = Number(process.env.PORT || 8100);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".hbs": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };
const MAX_MAGIAS = 200, MAX_BODY = 512 * 1024, MAX_NOME = 40;
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------- arquivos json (escrita atômica, backup diário do estado)
function lerJson(arq, padrao) { try { return JSON.parse(readFileSync(arq, "utf-8")); } catch { return padrao; } }
function gravarJson(arq, obj) {
  if (CHECK) return; // self-test não toca disco
  mkdirSync(dirname(arq), { recursive: true });
  const tmp = arq + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, arq);
}

function carregar() { return normalizarEstado(lerJson(ARQ, { usuarios: {}, publicadas: {} })); }
function normalizarEstado(d) {
  // migração: "Amanda" e "amanda" eram contas separadas -> mesclar por nome normalizado
  const u = {};
  for (const [k, magias] of Object.entries(d.usuarios || {})) {
    const nk = normNome(k);
    u[nk] = u[nk] || [];
    for (const m of magias) if (!m.id || !u[nk].some((x) => x.id === m.id)) u[nk].push(m);
  }
  d.usuarios = u;
  d.publicadas = d.publicadas || {};
  return d;
}
let estado = CHECK ? { usuarios: {}, publicadas: {} } : carregar();

function salvar() {
  if (CHECK) return;
  mkdirSync(DADOS, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const bk = join(DADOS, `backup-${hoje}.json`);
  if (existsSync(ARQ) && !existsSync(bk)) {
    copyFileSync(ARQ, bk);
    const bks = readdirSync(DADOS).filter((f) => f.startsWith("backup-")).sort();
    for (const velho of bks.slice(0, -7)) unlinkSync(join(DADOS, velho));
  }
  gravarJson(ARQ, estado);
}

function nomeOk(n) {
  return typeof n === "string" && n.trim().length >= 1 && n.length <= MAX_NOME && !/[\\/<>"]/.test(n);
}
// identidade: uma conta só, independente de maiúsculas ("Amanda" = "amanda" = "AMANDA")
// (function, não const: carregar() roda no topo do módulo antes desta linha)
function normNome(n) { return (n || "").trim().normalize("NFC").toLowerCase(); }
function mesmoDono(a, b) { return normNome(a) === normNome(b); }

// ---------------------------------------------------------------- contas e sessão
// dados/usuarios.json = { chave: { nome, papel: "jogador"|"mestre", personagem, sal, hash } }
// senha: scrypt; sessão: cookie "hub" = base64url({n: chave, e: expira}) + "." + HMAC(segredo) — sem tabela de sessões
const ARQ_USU = join(DADOS, "usuarios.json");
let usuarios = CHECK ? {} : lerJson(ARQ_USU, {});
const ARQ_SEG = join(DADOS, "segredo");
let segredo = CHECK ? "segredo-de-teste" : lerTexto(ARQ_SEG);
function lerTexto(arq) { try { return readFileSync(arq, "utf-8").trim(); } catch { return ""; } }
if (!segredo) { segredo = randomBytes(32).toString("hex"); if (!CHECK) { mkdirSync(DADOS, { recursive: true }); writeFileSync(ARQ_SEG, segredo); } }

const hashSenha = (senha, sal) => scryptSync(String(senha), sal, 32).toString("hex");
// conta pode ser achada pelo nome OU pelo apelido (login aceita os dois)
function buscarConta(nome) {
  const n = normNome(nome);
  if (usuarios[n]) return [n, usuarios[n]];
  const par = Object.entries(usuarios).find(([, u]) => u.apelido && normNome(u.apelido) === n);
  return par || [null, null];
}
function apelidoLivre(apelido, chave) {
  const n = normNome(apelido);
  if (!n) return true;
  return !Object.entries(usuarios).some(([k, u]) => k !== chave && (k === n || normNome(u.apelido) === n));
}
function definirUsuario({ nome, senha, papel, personagem, apelido }) {
  const chave = normNome(nome);
  const u = usuarios[chave] || { nome: nome.trim(), criadoEm: new Date().toISOString() };
  if (apelido != null) u.apelido = String(apelido).trim().slice(0, 40);
  if (senha) { u.sal = randomBytes(16).toString("hex"); u.hash = hashSenha(senha, u.sal); }
  if (papel) u.papel = papel === "mestre" ? "mestre" : "jogador";
  if (!u.papel) u.papel = "jogador";
  if (personagem != null) u.personagem = String(personagem).trim().slice(0, 60);
  usuarios[chave] = u;
  gravarJson(ARQ_USU, usuarios);
  return u;
}
// muda o nome de exibição (e a chave) e/ou o personagem de uma conta, arrastando tudo que aponta pra ela:
// magias (estado.usuarios), autor das publicadas, dias da agenda e votos das missões (votante = personagem || nome).
// Devolve { chave } nova ou uma string de erro. Maiúsculas: a chave é minúscula, o `nome` guarda como foi escrito.
function renomearConta(chave, { novoNome, personagem, apelido }) {
  const u = usuarios[chave];
  if (!u) return "conta não existe";
  if (apelido != null) {
    if (String(apelido).trim() && !nomeOk(apelido)) return "apelido inválido";
    if (!apelidoLivre(apelido, chave)) return "esse apelido já é de outra conta";
    u.apelido = String(apelido).trim().slice(0, 40);
  }
  const votanteAntigo = u.personagem || u.nome;
  if (novoNome != null && String(novoNome).trim() && String(novoNome).trim() !== u.nome) {
    if (!nomeOk(novoNome)) return "nome inválido";
    const nova = normNome(novoNome), antigoNome = u.nome;
    if (nova !== chave && (usuarios[nova] || !apelidoLivre(novoNome, chave))) return "já existe conta com esse nome";
    u.nome = String(novoNome).trim();
    if (nova !== chave) {
      delete usuarios[chave]; usuarios[nova] = u;
      if (estado.usuarios[chave]) { estado.usuarios[nova] = estado.usuarios[chave]; delete estado.usuarios[chave]; }
      for (const [loja, arq] of [[ameacasCriadas, ARQ_AME], [personagens, ARQ_PERS]]) if (loja[chave]) { loja[nova] = loja[chave]; delete loja[chave]; gravarJson(arq, loja); }
      chave = nova;
    }
    for (const m of Object.values(estado.publicadas)) if (mesmoDono(m.autor, antigoNome)) m.autor = u.nome;
    if (antigoNome !== u.nome && agenda.users[antigoNome]) { agenda.users[u.nome] = agenda.users[antigoNome]; delete agenda.users[antigoNome]; }
  }
  if (personagem != null) u.personagem = String(personagem).trim().slice(0, 60);
  const votanteNovo = u.personagem || u.nome;
  if (votanteNovo !== votanteAntigo) for (const v of Object.values(missoes.votos)) if (v[votanteAntigo]) { v[votanteNovo] = true; delete v[votanteAntigo]; }
  gravarJson(ARQ_USU, usuarios); salvar(); gravarJson(ARQ_AGE, agenda); gravarJson(ARQ_MIS, missoes);
  return { chave };
}
function conferirSenha(u, senha) {
  if (!u?.hash) return false;
  const a = Buffer.from(hashSenha(senha, u.sal), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const assinar = (s) => createHmac("sha256", segredo).update(s).digest("base64url");
function tokenDe(chave) { const corpo = b64(JSON.stringify({ n: chave, e: Date.now() + 365 * 864e5 })); return `${corpo}.${assinar(corpo)}`; }
function sessaoDe(req) {
  const m = /(?:^|;\s*)hub=([\w-]+)\.([\w-]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const a = Buffer.from(assinar(m[1])), b = Buffer.from(m[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(m[1], "base64url").toString());
    return e > Date.now() && usuarios[n] ? { chave: n, ...usuarios[n] } : null;
  } catch { return null; }
}
const cookieSessao = (req, valor, maxAge) =>
  `hub=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${/^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || "") ? "" : "; Secure"}`;
const publico = (u) => u && { nome: u.nome, apelido: u.apelido || "", papel: u.papel, personagem: u.personagem || "", criadoEm: u.criadoEm, atalhos: u.atalhos || [] };
// atalhos do topo: rotas internas do menu ("/", "/poderes", "/compendio?aba=classes"), sem repetir, até 16
const limparAtalhos = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(String).filter((h) => /^\/(?!\/)[\w\-/?=&.]{0,80}$/.test(h)))].slice(0, 16);
// freio de força bruta por IP: 8 erros → 60 s de espera
const erros = new Map();
function bloqueado(ip) { const e = erros.get(ip); return e && e.n >= 8 && Date.now() - e.em < 60_000; }
function errou(ip) { const e = erros.get(ip) || { n: 0 }; erros.set(ip, { n: (Date.now() - (e.em || 0) < 60_000 ? e.n : 0) + 1, em: Date.now() }); }
const ipDe = (req) => req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

// ---------------------------------------------------------------- coleções (dados/colecoes/<nome>.json, geradas por tools/importar.mjs)
const colecoes = { cache: {} };
function carregarColecao(nome) {
  nome = String(nome).replace(/[^\w-]/g, "");
  if (!(nome in colecoes.cache)) {
    const c = lerJson(join(DADOS, "colecoes", `${nome}.json`), null);
    if (c) c.porId = new Map(c.itens.map((i) => [i.id, i]));
    colecoes.cache[nome] = c;
  }
  return colecoes.cache[nome];
}
const resumo = ({ id, nome, linha, grupo, f }) => ({ id, nome, linha, grupo, f });

// ---------------------------------------------------------------- missões, agenda, links (json simples em dados/)
const ARQ_MIS = join(DADOS, "missoes.json"), ARQ_AGE = join(DADOS, "agenda.json"), ARQ_LINKS = join(DADOS, "links.json");
let missoes = CHECK ? { missoes: [], votos: {} } : lerJson(ARQ_MIS, { missoes: [], votos: {} });
let agenda = CHECK ? { users: {} } : lerJson(ARQ_AGE, { users: {} });
const LINKS_PADRAO = {
  grupos: [
    { titulo: "Jogar", links: [
      { nome: "Foundry VTT", url: "https://foundry.raynathus.com.br", desc: "a mesa: onde o jogo acontece", icone: "🎲" },
      { nome: "Call (Papinho)", url: "https://chat.raynathus.com.br", desc: "voz e chat da mesa", icone: "🎧" },
      { nome: "Agenda", url: "/agenda", desc: "marque os dias em que pode jogar", icone: "📅" },
      { nome: "Missões", url: "/missoes", desc: "quadro da guilda: vote no que quer fazer", icone: "📜" }] },
    { titulo: "Ferramentas", links: [
      { nome: "Arena Imperial", url: "https://arena.raynathus.com.br", desc: "montar e balancear encontros por ND", icone: "⚔️" },
      { nome: "Cenas", url: "https://cenas.raynathus.com.br", desc: "mapas e cenas do acervo", icone: "🗺️" },
      { nome: "Caseiro", url: "https://caseiro.raynathus.com.br", desc: "documentos com cara de livro de T20", icone: "📖" },
      { nome: "Criador de ficha", url: "https://ficha.raynathus.com.br", desc: "ficha passo a passo (antigo)", icone: "🧾" },
      { nome: "Draw", url: "https://draw.raynathus.com.br", desc: "quadro branco (Excalidraw)", icone: "✏️" }] },
    { titulo: "Baixar", links: [
      { nome: "FLC (Foundry Lightweight Client)", url: "https://tools.ruleplaying.com/flc", desc: "cliente leve do Foundry pra PC", icone: "💻" },
      { nome: "FLC Mobile (Android)", url: "https://github.com/RaymundoJMSN/flc-mobile/releases/latest", desc: "APK do Foundry pra celular, feito pela mesa", icone: "📱" },
      { nome: "App da call", url: "https://chat.raynathus.com.br", desc: "abre no navegador; instale como app pelo menu do navegador", icone: "🎙️" }] },
  ],
};
let links = CHECK ? LINKS_PADRAO : lerJson(ARQ_LINKS, LINKS_PADRAO);
// personagens do criador de ficha: { chave da conta: { id: { nome, resumo, estado, passo, ficha, criadoEm, atualizadoEm } } }
const ARQ_PERS = join(DADOS, "personagens.json");
let personagens = CHECK ? {} : lerJson(ARQ_PERS, {});
const FICHA_DIR = join(DADOS, "ficha-site"); // build do criador-ficha-foundry (site, base /ficha/), sobe por scp
// ameaças do criador de ameaças: { chave da conta: { id: { ameaca, criadoEm, atualizadoEm } } }
const ARQ_AME = join(DADOS, "ameacas-criadas.json");
let ameacasCriadas = CHECK ? {} : lerJson(ARQ_AME, {});
// Tabela 2-3, 2-2, 2-4 e passos de dano (tools/importar.mjs lê do compilado-ameacas-t20; conteúdo da Jambo, fora do git)
function carregarRegrasAmeacas() {
  if (carregarRegrasAmeacas.cache === undefined) carregarRegrasAmeacas.cache = lerJson(join(DADOS, "ameacas-regras.json"), null);
  return carregarRegrasAmeacas.cache;
}
// biblioteca de habilidades = as das 620 fichas do bestiário, agrupadas pelo nome (exemplo de texto + quem tem)
function bibliotecaHabilidades() {
  const col = carregarColecao("ameacas");
  if (!col) return [];
  if (col.biblioteca) return col.biblioteca;
  const grupos = new Map();
  for (const it of col.itens) for (const h of it.dados?.habilidades || []) {
    const k = norm(h.nome);
    if (!k) continue;
    let g = grupos.get(k);
    if (!g) grupos.set(k, (g = { nome: h.nome, acao: h.acao, custo: h.custo, magica: h.magica, extra: h.extra, desc: "", de: "", n: 0, quem: [] }));
    g.n++;
    if (g.quem.length < 6) g.quem.push(`${it.nome} (ND ${it.dados.nd})`);
    // exemplo = a descrição de tamanho mais "típico" (~220 letras), como no gerar.py do compilado
    const d = h.desc || "";
    if (!g.desc || (d.length > 40 && Math.abs(d.length - 220) < Math.abs(g.desc.length - 220)))
      Object.assign(g, { acao: h.acao, custo: h.custo, magica: h.magica, extra: h.extra, desc: d, de: `${it.nome} (ND ${it.dados.nd})` });
  }
  return (col.biblioteca = [...grupos.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome)));
}

// fichas do bestiário mais parecidas com a ameaça (tipo, subtipo, tamanho, ND): a referência de atributos do criador
function parecidas({ tipo, subtipo, tamanho, nd }, n = 6) {
  const col = carregarColecao("ameacas");
  if (!col) return [];
  const i0 = Math.max(0, ND_ORDEM.indexOf(nd)), palavras = (s) => norm(s).split(/[^a-z]+/).filter((w) => w.length > 2), subs = new Set(palavras(subtipo));
  return col.itens.filter((it) => it.dados).map((it) => {
    const d = it.dados;
    return [(d.tipo === tipo ? 10 : 0) + palavras(d.subtipo).filter((w) => subs.has(w)).length * 4 + (d.tamanho === tamanho ? 2 : 0) - Math.abs(ND_ORDEM.indexOf(d.nd) - i0), it];
  }).sort((x, y) => y[0] - x[0]).slice(0, n)
    .map(([, it]) => ({ id: it.id, nome: it.nome, nd: it.dados.nd, linha: tipoLinha(it.dados), atributos: it.dados.atributos, sentidos: it.dados.sentidos, defesas: it.dados.defesas }));
}

function validarMagia(m) {
  if (typeof m !== "object" || !m) return "magia inválida";
  if (!nomeOk(m.nome || "x")) return "nome inválido";
  if (JSON.stringify(m).length > 20_000) return "magia grande demais";
  if (![1, 2, 3, 4, 5].includes(m.circulo || 1)) return "círculo deve ser 1 a 5";
  try { m.pontos = { gasto: calcular(m, TABELA).total, orcamento: TABELA.orcamento[String(m.circulo || 1)] }; }
  catch { return "estrutura de eixos/efeitos inválida"; }
  return null;
}

function json(res, code, obj, extra = {}) {
  let b = JSON.stringify(obj);
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra };
  // lista grande (os 2.600 poderes com resumo passam de 1 MB) vai comprimida: no celular é a diferença entre abrir e esperar
  if (b.length > 16_384 && /\bgzip\b/.test(res.req?.headers["accept-encoding"] || "")) { b = gzipSync(b); h["content-encoding"] = "gzip"; h.vary = "accept-encoding"; }
  res.writeHead(code, h);
  res.end(b);
}

function corpo(req, limite = MAX_BODY) {
  return new Promise((ok, err) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > limite) { err(new Error("grande")); req.destroy(); } });
    req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { err(new Error("json")); } });
  });
}

function estatico(res, caminho) {
  try {
    const c = readFileSync(caminho);
    const ext = extname(caminho);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": /\.(ttf|otf|woff2|png)$/.test(ext) ? "public, max-age=604800" : "no-cache" });
    res.end(c);
  } catch { res.writeHead(404); res.end("404"); }
}
const pagina = (nome) => join(RAIZ, "static", nome);
// título/descrição pro link ficar bonito no WhatsApp/Discord (a carta em si só abre depois do login)
function htmlComOg(arquivo, titulo, desc, site) {
  let html = readFileSync(pagina(arquivo), "utf-8");
  if (titulo) html = html.replace(/<title>.*<\/title>/, `<title>${esc(titulo)} — ${site}</title>`)
    .replace('<meta name="description"', `<meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:site_name" content="${site}"><meta name="description"`);
  return html;
}
function responderHtml(res, html, code = 200) { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }); res.end(html); }
const redirecionar = (res, para) => { res.writeHead(302, { location: para }); res.end(); };

// o que cada link compartilhável abre (pra montar o Open Graph sem exigir login)
function alvoDaRota(p) {
  const r = p.match(/^\/([mod])\/([\w-]+)/);
  if (r) {
    const id = r[2];
    if (r[1] === "m") { const m = estado.publicadas[id.replace(/[^a-f0-9]/g, "")]; return m && [m.nome, `${m.escola} (${m.tipo}) — ${m.circulo || 1}º círculo. ${htmlParaTexto(m.descricao || "")}`, "Grimório T20"]; }
    const t = (r[1] === "d" ? carregarPoderes() : carregarTextos())[id.replace(/[^\w-]/g, "")];
    return t && [t.nome, `${t.linha}. ${t.descricao || ""}`, "Grimório T20"];
  }
  const c = p.match(/^\/c\/([\w-]+)\/([\w-]+)/);
  if (c) { const it = carregarColecao(c[1])?.porId.get(c[2]); return it && [it.nome, it.linha, "Hub T20"]; }
  return null;
}
const PAGINAS = { "/": "grimorio.html", "/poderes": "grimorio.html", "/criar": "index.html", "/criar-ameaca": "ameacas.html", "/bestiario": "colecao.html", "/itens": "colecao.html", "/regras": "colecao.html", "/compendio": "colecao.html",
  "/missoes": "missoes.html", "/agenda": "agenda.html", "/links": "links.html", "/mestre": "mestre.html", "/arauto": "arauto.html" };
// sem sessão só passa: login, a API de login e arquivos estáticos (css/js/fontes/ícones/manifest/sw — código e enfeite, não dados)
// /api/arauto/bot é do bot do Papinho: sem sessão de site, mas com token próprio (conferido na rota)
const livre = (p) => p === "/login" || p === "/api/login" || p === "/api/arauto/bot" || /\.(css|js|mjs|png|svg|ico|ttf|otf|woff2|webmanifest)$/.test(p);

async function tratar(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const eu = sessaoDe(req);

  if (p === "/api/login" && req.method === "POST") {
    const ip = ipDe(req);
    if (bloqueado(ip)) return json(res, 429, { erro: "muitas tentativas — espere um minuto" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const [chaveLogin, u] = buscarConta(b.nome);
    if (!u || !conferirSenha(u, String(b.senha ?? ""))) { errou(ip); return json(res, 401, { erro: "nome ou senha errados" }); }
    return json(res, 200, { ok: true, eu: publico(u) }, { "set-cookie": cookieSessao(req, tokenDe(chaveLogin), 365 * 86400) });
  }
  if (p === "/login") {
    if (eu) return redirecionar(res, url.searchParams.get("voltar") || "/");
    return estatico(res, pagina("login.html"));
  }
  if (!eu && !livre(p)) {
    if (p.startsWith("/api/")) return json(res, 401, { erro: "entre primeiro" });
    // página → tela de login já com o destino guardado (e Open Graph do link, se for carta)
    const og = alvoDaRota(p);
    let html = htmlComOg("login.html", og?.[0], og?.[1], og?.[2] || "Hub T20");
    html = html.replace("</head>", `<script>window.VOLTAR=${JSON.stringify(p + url.search)}</script></head>`);
    return responderHtml(res, html, 200);
  }
  // ---- Arauto no Papinho: o bot do Matrix pergunta aqui (token próprio em dados/arauto.json) e recebe a resposta pronta
  if (p === "/api/arauto/bot") {
    const ip = ipDe(req);
    if (req.method !== "POST") return json(res, 405, { erro: "use POST" });
    if (bloqueado(ip)) return json(res, 429, { erro: "muitas tentativas — espere um minuto" });
    if (!arauto.botAutorizado(req.headers.authorization)) { errou(ip); return json(res, 401, { erro: "token do bot inválido" }); }
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    // a resposta pode levar mais que o minuto que o nginx espera calado: um espaço a cada 10 s segura a conexão
    // (espaço antes do JSON não muda o JSON)
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
    const pulso = setInterval(() => res.write(" "), 10_000);
    const r = await arauto.responder({ pergunta: b.pergunta, historico: b.historico, quem: String(b.autor || "papinho").slice(0, 80), canal: "papinho" });
    clearInterval(pulso);
    return res.end(JSON.stringify({ resposta: r.resposta, itens: r.itens || [], erro: r.erro, ms: r.ms }));
  }
  if (p === "/api/sair" && req.method === "POST") return json(res, 200, { ok: true }, { "set-cookie": cookieSessao(req, "x", 0) });
  if (p === "/api/eu") return json(res, 200, { ...publico(eu), mestre: eu.papel === "mestre" });
  if (p === "/api/senha" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!conferirSenha(usuarios[eu.chave], String(b.atual ?? ""))) return json(res, 403, { erro: "senha atual errada" });
    if (String(b.nova || "").length < 4) return json(res, 400, { erro: "senha nova curta demais (mínimo 4)" });
    definirUsuario({ nome: eu.nome, senha: String(b.nova) });
    return json(res, 200, { ok: true });
  }
  // ---- minha conta: nome de exibição e personagem (a senha é /api/senha)
  if (p === "/api/conta" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const r = renomearConta(eu.chave, { novoNome: b.nome, personagem: b.personagem, apelido: b.apelido });
    if (typeof r === "string") return json(res, 400, { erro: r });
    // a chave mudou → cookie novo (o antigo aponta pra uma conta que não existe mais)
    return json(res, 200, { ok: true, eu: publico(usuarios[r.chave]) }, r.chave !== eu.chave ? { "set-cookie": cookieSessao(req, tokenDe(r.chave), 365 * 86400) } : {});
  }
  if (p === "/api/atalhos" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    usuarios[eu.chave].atalhos = limparAtalhos(b.atalhos);
    gravarJson(ARQ_USU, usuarios);
    return json(res, 200, { ok: true, atalhos: usuarios[eu.chave].atalhos });
  }
  // ---- painel do mestre: contas (criar, senha, papel, personagem, renomear, apagar)
  if (p.startsWith("/api/usuarios")) {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre" });
    if (req.method === "GET") return json(res, 200, { usuarios: Object.values(usuarios).map(publico) });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (p === "/api/usuarios/apagar") {
      const chave = normNome(b.nome);
      if (chave === eu.chave) return json(res, 400, { erro: "não dá pra apagar a si mesmo" });
      delete usuarios[chave]; gravarJson(ARQ_USU, usuarios);
      return json(res, 200, { ok: true });
    }
    if (!nomeOk(b.nome)) return json(res, 400, { erro: "nome inválido" });
    let chave = normNome(b.nome);
    const eraEu = chave === eu.chave;
    if (!usuarios[chave] && String(b.senha || "").length < 4) return json(res, 400, { erro: "conta nova precisa de senha (mínimo 4)" });
    if (chave === eu.chave && b.papel && b.papel !== "mestre") return json(res, 400, { erro: "você não pode se rebaixar" });
    if (!usuarios[chave]) {
      if (!apelidoLivre(b.nome, chave) || (b.apelido && !apelidoLivre(b.apelido, chave))) return json(res, 400, { erro: "nome ou apelido já usado" });
      definirUsuario({ nome: b.nome, senha: b.senha, papel: b.papel, personagem: b.personagem, apelido: b.apelido });
    } else {
      const r = renomearConta(chave, { novoNome: b.novoNome, personagem: b.personagem, apelido: b.apelido });
      if (typeof r === "string") return json(res, 400, { erro: r });
      chave = r.chave;
      definirUsuario({ nome: usuarios[chave].nome, senha: b.senha || "", papel: b.papel });
    }
    // o mestre renomeou a própria conta → a chave do cookie dele mudou, manda um novo
    const extra = eraEu && chave !== eu.chave ? { "set-cookie": cookieSessao(req, tokenDe(chave), 365 * 86400) } : {};
    return json(res, 200, { ok: true, usuario: publico(usuarios[chave]) }, extra);
  }

  // ---- grimório / criador (dono = quem está logado; o nome no caminho/corpo é ignorado)
  if (p === "/api/state" && req.method === "GET") {
    return json(res, 200, {
      minhas: estado.usuarios[eu.chave] || [],
      publicadas: Object.entries(estado.publicadas).map(([id, m]) => ({ ...m, id })),
    });
  }
  if (p.startsWith("/api/user/") && req.method === "PUT") {
    const nome = eu.nome, chave = eu.chave;
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const magias = Array.isArray(b.magias) ? b.magias.slice(0, MAX_MAGIAS) : null;
    if (!magias) return json(res, 400, { erro: "esperado {magias:[...]}" });
    for (const m of magias) {
      const e = validarMagia(m);
      if (e) return json(res, 400, { erro: `${m?.nome || "?"}: ${e}` });
    }
    estado.usuarios[chave] = magias;
    // magia publicada É a mesma magia: editar a sua atualiza a publicada, apagar despublica
    const idsAgora = new Set(magias.map((m) => m.id).filter(Boolean));
    for (const [id, pub] of Object.entries(estado.publicadas)) {
      if (!mesmoDono(pub.autor, nome)) continue;
      if (!idsAgora.has(id)) delete estado.publicadas[id];
    }
    for (const m of magias) {
      const pub = m.id && estado.publicadas[m.id];
      if (pub && mesmoDono(pub.autor, nome)) estado.publicadas[m.id] = { ...m, autor: pub.autor, publicadaEm: pub.publicadaEm };
    }
    salvar();
    return json(res, 200, { ok: true, n: magias.length });
  }
  if (p === "/api/publicar" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const autor = eu.nome, { magia } = b;
    const e = validarMagia(magia);
    if (e) return json(res, 400, { erro: e });
    const limiteAval = magia.pontos.orcamento + Math.max(1, Math.round(magia.pontos.orcamento * (TABELA.aval_mestre_pct ?? 0.15)));
    if (magia.pontos.gasto > limiteAval) return json(res, 400, { erro: "estourou além da margem do mestre — só rascunho" });
    const id = typeof magia.id === "string" && /^[a-f0-9]{6,16}$/.test(magia.id) ? magia.id : randomBytes(4).toString("hex");
    const jaTem = estado.publicadas[id];
    if (jaTem && !mesmoDono(jaTem.autor, autor)) return json(res, 403, { erro: "essa magia é de outra pessoa" });
    estado.publicadas[id] = { ...magia, id, autor, publicadaEm: jaTem?.publicadaEm || new Date().toISOString() };
    salvar();
    return json(res, 200, { ok: true, id });
  }
  if (p === "/api/despublicar" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const m = estado.publicadas[b.id];
    if (!m) return json(res, 404, { erro: "não existe" });
    if (!mesmoDono(m.autor, eu.nome) && eu.papel !== "mestre") return json(res, 403, { erro: "só o autor (ou o mestre) despublica" });
    delete estado.publicadas[b.id];
    salvar();
    return json(res, 200, { ok: true });
  }
  if (p.startsWith("/api/magia/") && req.method === "GET") {
    const m = estado.publicadas[p.slice("/api/magia/".length)];
    return m ? json(res, 200, m) : json(res, 404, { erro: "não existe" });
  }
  if (p.startsWith("/api/texto/") && req.method === "GET") {
    const t = carregarTextos()[p.slice("/api/texto/".length).replace(/[^\w-]/g, "")];
    return t ? json(res, 200, t) : json(res, 404, { erro: "sem texto no servidor" });
  }
  // grimório: lista leve (oficiais + publicadas). As oficiais passam pela busca v2 (palavra + tema + sentido);
  // as publicadas da mesa, só por palavra (não têm vetor)
  if (p === "/api/grimorio" && req.method === "GET") {
    const textos = carregarTextos();
    const q = norm(url.searchParams.get("q")).trim();
    const oficiais = (await procurarMagias(q)).map(({ id, t, rel, sem, trecho, num }) => ({ ...itemMagia(id, t), rel, sem, trecho, num }));
    const termos = await comIA(termosBusca(q, vocabDe(textos, () => Object.values(textos).map(blobDe))));
    const publicadasPartes = Object.entries(estado.publicadas)
      .map(([id, m]) => [id, m, m.nome, [m.escola, m.tipo, htmlParaTexto(m.descricao), JSON.stringify(m.eixos || {})].join(" "), aprsDe(m)]);
    const pTrecho = padraoDaConsulta(termos);
    const publicadas = filtrar(publicadasPartes, ([, , ...partes]) => norm(partes.join(" ")), termos)
      .map(([id, m, ...partes]) => ({ id, nome: m.nome, escola: m.escola, grupo: m.tipo, circulo: m.circulo || 1, autor: m.autor, pontos: m.pontos, pocao: tipoDePocaoDosEixos(m.eixos?.alvo),
        rel: relevancia(partes, termos, q), ...eixosDaMesa(m.eixos), ...(pTrecho && destacar([htmlParaTexto(m.descricao), aprsDe(m), m.nome], pTrecho)) }));
    return json(res, 200, { oficiais, publicadas });
  }
  if (p === "/api/poderes" && req.method === "GET") {
    let q = norm(url.searchParams.get("q")).trim(), soPre = url.searchParams.get("em") === "pre";
    const prefixo = q.match(/^(?:pre[\s-]*)?requisitos?\b[\s:]*/); // "pré-requisito: esgrima" = buscar só no pré-requisito
    if (prefixo && q.length > prefixo[0].length) { soPre = true; q = q.slice(prefixo[0].length); }
    const poderes = (await procurarPoderes(q, { soPre })).map(({ id, t, rel, sem, trecho, num }) => ({ ...itemPoder(id, t), rel, sem, trecho, num }));
    // variante → classe base: quem filtra por "Duelista" também quer ver os poderes de bucaneiro (a variante usa a lista da base)
    const variantes = Object.fromEntries(carregarBase().classes.filter((c) => c.varianteDe).map((c) => [c.nome, c.varianteDe]));
    return json(res, 200, { poderes, variantes });
  }
  if (p.startsWith("/api/poder/") && req.method === "GET") {
    const [slug, t] = poderPorSlug(p.slice("/api/poder/".length).replace(/[^\w-]/g, ""));
    return t ? json(res, 200, poderCompleto(slug, t)) : json(res, 404, { erro: "sem texto no servidor" });
  }
  if (p === "/api/sugestoes-apr" && req.method === "POST") {
    if (!tratar.aprs) tratar.aprs = lerJson(join(DADOS, "aprimoramentos.json"), []);
    let f;
    try { f = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    return json(res, 200, { sugestoes: sugerirAprimoramentos(f, tratar.aprs) });
  }

  // ---- busca em tudo (caixa do topo): as 5 melhores de cada fonte, fontes ordenadas pela melhor nota.
  // Usa as mesmas funções das páginas (palavra + tema + sentido); o vetor da consulta é calculado uma vez e vale pra todas.
  if (p === "/api/busca" && req.method === "GET") {
    const q = norm(url.searchParams.get("q")).trim();
    if (q.length < 2) return json(res, 200, { grupos: [] });
    const grupos = [];
    const junta = (cab, achados, info) => {
      achados.sort(porRel).sort(porNum); // trecho com # ("+# na Defesa"): o maior número de cada fonte vem primeiro
      if (achados.length) grupos.push({ ...cab, total: achados.length, itens: achados.slice(0, 5).map((a) => ({ ...info(a), rel: a.rel, sem: a.sem, trecho: a.trecho })) });
    };
    junta({ titulo: "Magias", pagina: "/" }, await procurarMagias(q), ({ id, t }) => ({ nome: t.nome, linha: t.linha, href: "/o/" + id }));
    junta({ titulo: "Poderes", pagina: "/poderes" }, await procurarPoderes(q), ({ id, t }) => ({ nome: t.nome, linha: t.linha, href: "/d/" + id }));
    for (const nome of new Set([...Object.keys(lerJson(join(DADOS, "colecoes", "INDEX.json"), { contagem: {} }).contagem), ...Object.keys(colecoes.cache)])) {
      const col = carregarColecao(nome);
      if (col) junta({ titulo: col.meta.titulo || nome, col: nome }, await procurarColecao(nome, q), ({ t }) => ({ nome: t.nome, linha: t.linha, href: `/c/${nome}/${t.id}` }));
    }
    grupos.sort((a, b) => b.itens[0].rel - a.itens[0].rel);
    return json(res, 200, { grupos });
  }

  // ---- coleções: /api/c/<nome>?q=  (lista leve)  |  /api/c/<nome>/<id>  (ficha completa)
  const c = p.match(/^\/api\/c\/([\w-]+)(?:\/([\w-]+))?$/);
  if (c && req.method === "GET") {
    const col = carregarColecao(c[1]);
    if (!col) return json(res, 404, { erro: "coleção não existe no servidor" });
    if (c[2]) { const it = col.porId.get(c[2]); return it ? json(res, 200, it) : json(res, 404, { erro: "não existe" }); }
    const q = norm(url.searchParams.get("q")).trim();
    const itens = q ? (await procurarColecao(c[1], q)).map(({ t, rel, sem, trecho, num }) => ({ ...resumo(t), rel, sem, trecho, num })) : col.itens.map(resumo);
    return json(res, 200, { meta: col.meta, itens });
  }
  if (p === "/api/colecoes") return json(res, 200, lerJson(join(DADOS, "colecoes", "INDEX.json"), { contagem: {} }));

  // ---- Arauto no site: a resposta vem em eventos (text/event-stream) — o andamento das buscas chega antes do texto
  if (p === "/api/arauto" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
    const evento = (tipo, dado) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(dado)}\n\n`);
    evento("status", "🪶 o Arauto está pensando…");
    const pulso = setInterval(() => res.write(": pulso\n\n"), 15_000); // comentário de SSE: mantém a conexão viva no proxy enquanto o modelo escreve
    const r = await arauto.responder({ pergunta: b.pergunta, historico: b.historico, quem: eu.nome, canal: "site", avisar: (t) => evento("status", t) });
    clearInterval(pulso);
    evento("fim", { resposta: r.resposta, itens: r.itens || [], erro: r.erro, ms: r.ms });
    return res.end();
  }
  if (p === "/api/arauto" && req.method === "GET") return json(res, 200, { pronto: arauto.pronto(), modelo: arauto.modelo() });
  // ---- missões (quadro da guilda): voto = personagem de quem está logado (ou o nome)
  if (p === "/api/missoes" && req.method === "GET") return json(res, 200, { ...missoes, eu: eu.personagem || eu.nome });
  if (p === "/api/missoes" && req.method === "PUT") {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre edita o quadro" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!Array.isArray(b.missoes) || b.missoes.length > 200) return json(res, 400, { erro: "esperado {missoes:[...]}" });
    const lista = [];
    for (const m of b.missoes) {
      if (!m || !nomeOk(String(m.titulo || "").slice(0, MAX_NOME) || "x") || !String(m.titulo || "").trim()) return json(res, 400, { erro: "missão sem título" });
      const id = /^[\w-]{1,80}$/.test(m.id || "") ? m.id : slug(m.titulo);
      lista.push({ id, titulo: String(m.titulo).slice(0, 120), solicitante: String(m.solicitante || "").slice(0, 120), local: String(m.local || "").slice(0, 120),
        descricao: String(m.descricao || "").slice(0, 2000), perigo: Math.min(5, Math.max(1, Number(m.perigo) || 1)), recompensa: String(m.recompensa || "").slice(0, 120), concluida: !!m.concluida });
    }
    const ids = new Set(lista.map((m) => m.id));
    for (const id of Object.keys(missoes.votos)) if (!ids.has(id)) delete missoes.votos[id];
    missoes.missoes = lista;
    gravarJson(ARQ_MIS, missoes);
    return json(res, 200, { ok: true, n: lista.length });
  }
  if ((p === "/api/missoes/votar" || p === "/api/missoes/concluir") && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const m = missoes.missoes.find((x) => x.id === b.id);
    if (!m) return json(res, 404, { erro: "missão não existe" });
    if (p.endsWith("concluir")) {
      if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre conclui" });
      m.concluida = !!b.ligar;
      if (m.concluida) delete missoes.votos[m.id];
    } else {
      if (m.concluida) return json(res, 400, { erro: "missão já cumprida" });
      const quem = eu.personagem || eu.nome;
      missoes.votos[m.id] = missoes.votos[m.id] || {};
      if (b.ligar) missoes.votos[m.id][quem] = true; else delete missoes.votos[m.id][quem];
      if (!Object.keys(missoes.votos[m.id]).length) delete missoes.votos[m.id];
    }
    gravarJson(ARQ_MIS, missoes);
    return json(res, 200, { ok: true, ...missoes });
  }

  // ---- agenda (herdada do data-rpg): cada um só grava os próprios dias; a lista de nomes vem das contas
  if (p === "/api/agenda/state" && req.method === "GET") {
    const contas = Object.values(usuarios);
    return json(res, 200, { users: agenda.users, nomes: contas.map((u) => u.nome), mestre: contas.find((u) => u.papel === "mestre")?.nome || "", eu: eu.nome });
  }
  const ag = p.match(/^\/api\/agenda\/user\/([^/]+)$/);
  if (ag && (req.method === "PUT" || req.method === "POST")) { // POST = sendBeacon
    const nome = decodeURIComponent(ag[1]);
    if (!mesmoDono(nome, eu.nome) && eu.papel !== "mestre") return json(res, 403, { erro: "só os próprios dias" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const dias = b?.days;
    if (!dias || typeof dias !== "object" || !Object.entries(dias).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && (v === "yes" || v === "no"))) return json(res, 400, { erro: "dias inválidos" });
    const dono = usuarios[normNome(nome)]?.nome || eu.nome;
    agenda.users[dono] = { days: dias, updatedAt: Number(b.updatedAt) || Date.now() };
    gravarJson(ARQ_AGE, agenda);
    return json(res, 200, { ok: true });
  }

  // ---- links (cards da página Mesa); o mestre edita
  if (p === "/api/links" && req.method === "GET") return json(res, 200, links);
  if (p === "/api/links" && req.method === "PUT") {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!Array.isArray(b.grupos)) return json(res, 400, { erro: "esperado {grupos:[{titulo, links:[{nome,url,desc,icone}]}]}" });
    links = { grupos: b.grupos.slice(0, 20).map((g) => ({ titulo: String(g.titulo || "").slice(0, 60),
      links: (g.links || []).slice(0, 40).map((l) => ({ nome: String(l.nome || "").slice(0, 80), url: String(l.url || "").slice(0, 500), desc: String(l.desc || "").slice(0, 200), icone: String(l.icone || "").slice(0, 8) })) })) };
    gravarJson(ARQ_LINKS, links);
    return json(res, 200, { ok: true });
  }

  // ---- criador de ameaças: regras do livro, biblioteca de habilidades, ameaças salvas POR CONTA (o dono é a sessão)
  if (p === "/api/criador/ameacas-regras" && req.method === "GET") {
    const r = carregarRegrasAmeacas();
    return r ? json(res, 200, r) : json(res, 404, { erro: "regras de criação não instaladas no servidor (rode tools/importar.mjs e suba dados/ameacas-regras.json)" });
  }
  if (p === "/api/criador/ameacas-habilidades" && req.method === "GET") {
    const lista = bibliotecaHabilidades(), q = norm(url.searchParams.get("q")).trim();
    const blob = (g) => norm(`${g.nome} ${g.desc}`);
    const termos = termosBusca(q, vocabDe(lista, () => lista.map(blob)));
    const achadas = termos.length
      ? filtrar(lista, blob, termos).map((g) => [g, relevancia([g.nome, "", g.desc], termos, q)]).sort((x, y) => y[1] - x[1] || y[0].n - x[0].n).map(([g]) => g)
      : lista;
    return json(res, 200, achadas.slice(0, 40));
  }
  if (p === "/api/criador/ameacas-parecidas" && req.method === "GET") {
    const q = Object.fromEntries(["tipo", "subtipo", "tamanho", "nd"].map((k) => [k, String(url.searchParams.get(k) || "").slice(0, 60)]));
    return json(res, 200, parecidas(q));
  }
  const am = p.match(/^\/api\/criador\/ameacas(?:\/([a-z0-9]{6,16}))?$/);
  if (am) {
    const minhas = (ameacasCriadas[eu.chave] ||= {});
    if (!am[1] && req.method === "GET") return json(res, 200, Object.entries(minhas).map(([id, x]) => ({ id, nome: x.ameaca.nome, nd: x.ameaca.nd, papel: x.ameaca.papel,
      tipo: x.ameaca.tipo, tamanho: x.ameaca.tamanho, atualizadoEm: x.atualizadoEm })).sort((a, b) => b.atualizadoEm - a.atualizadoEm));
    if (!am[1]) return json(res, 405, { erro: "método" });
    const id = am[1];
    if (req.method === "GET") return minhas[id] ? json(res, 200, { id, ...minhas[id] }) : json(res, 404, { erro: "não encontrada" });
    if (req.method === "DELETE") { delete minhas[id]; gravarJson(ARQ_AME, ameacasCriadas); return json(res, 200, { ok: true }); }
    if (req.method === "PUT") {
      let b;
      try { b = await corpo(req, 256 * 1024); } catch { return json(res, 400, { erro: "corpo inválido ou grande demais" }); }
      if (!b?.ameaca || typeof b.ameaca !== "object" || Array.isArray(b.ameaca)) return json(res, 400, { erro: "esperado {ameaca:{...}}" });
      if (!minhas[id] && Object.keys(minhas).length >= 500) return json(res, 400, { erro: "limite de 500 ameaças por conta" });
      const ameaca = normalizarAmeaca(b.ameaca);
      minhas[id] = { ameaca, criadoEm: minhas[id]?.criadoEm || Date.now(), atualizadoEm: Date.now() };
      gravarJson(ARQ_AME, ameacasCriadas);
      return json(res, 200, { ok: true, id, ameaca });
    }
    return json(res, 405, { erro: "método" });
  }
  // ficha do bestiário como ator NPC do Foundry (sistema tormenta20): baixar e importar lá
  const fd = p.match(/^\/api\/c\/ameacas\/([\w-]+)\/foundry$/);
  if (fd && req.method === "GET") {
    const it = carregarColecao("ameacas")?.porId.get(fd[1]);
    if (!it?.dados) return json(res, 404, { erro: "ameaça sem ficha estruturada no servidor (reimporte o bestiário)" });
    return json(res, 200, paraFoundry(it.dados), { "content-disposition": `attachment; filename="${fd[1]}.json"` });
  }

  // ---- criador de ficha (site do t20-ficha-wizard buildado em dados/ficha-site, base /ficha/): personagens salvos POR CONTA
  // mesma API que o site já falava (/api/criador/personagens); o "jogador" do site é ignorado — a sessão manda
  const pc = p.match(/^\/api\/criador\/personagens(?:\/([A-Za-z0-9_-]{4,40}))?$/);
  if (pc) {
    const meus = (personagens[eu.chave] ||= {});
    if (!pc[1] && req.method === "GET") return json(res, 200, Object.entries(meus).map(([id, x]) => ({ id, nome: x.nome, resumo: x.resumo, passo: x.passo, temFicha: !!x.ficha, atualizadoEm: x.atualizadoEm })).sort((a, b) => b.atualizadoEm - a.atualizadoEm));
    if (!pc[1]) return json(res, 405, { error: "método" });
    const id = pc[1];
    if (req.method === "GET") return meus[id] ? json(res, 200, { id, jogador: eu.nome, ...meus[id] }) : json(res, 404, { error: "não encontrado" });
    if (req.method === "DELETE") { delete meus[id]; gravarJson(ARQ_PERS, personagens); return json(res, 200, { ok: true }); }
    if (req.method === "PUT") {
      let b;
      try { b = await corpo(req, 4 * 1024 * 1024); } catch { return json(res, 400, { error: "corpo inválido ou grande demais" }); }
      if (!b.estado) return json(res, 400, { error: "estado obrigatório" });
      const texto = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
      meus[id] = { nome: String(b.nome || "Sem nome").slice(0, 80), resumo: String(b.resumo ?? "").slice(0, 200), estado: texto(b.estado),
        passo: b.passo ? String(b.passo).slice(0, 40) : null, ficha: texto(b.ficha), criadoEm: meus[id]?.criadoEm || Date.now(), atualizadoEm: Date.now() };
      gravarJson(ARQ_PERS, personagens);
      return json(res, 200, { ok: true, id });
    }
    return json(res, 405, { error: "método" });
  }
  if (p === "/ficha") return redirecionar(res, "/ficha/");
  if (p.startsWith("/ficha/")) {
    const rel = decodeURIComponent(p.slice("/ficha/".length)).replace(/\.\./g, "");
    if (rel === "" || rel === "index.html") {
      // o site lê o nome do jogador do localStorage antes de subir: gravamos o da sessão e escondemos o campo
      let html;
      try { html = readFileSync(join(FICHA_DIR, "index.html"), "utf-8"); } catch { return responderHtml(res, "<h1>Criador de ficha ainda não instalado neste servidor</h1>", 404); }
      // fundo escuro antes de qualquer CSS (senão pisca branco na carga) + confirm do site no lugar do nativo
      html = html.replace("<head>", `<head><meta name="color-scheme" content="dark"><style>html,body{background:#120809 !important}</style><script src="/ficha-hub.js"></script>`);
      html = html.replace("</head>", `<script>try{localStorage.setItem("t20w-site.jogador",${JSON.stringify(eu.nome)})}catch{}</script>`
        + `<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">`
        + `<link rel="stylesheet" href="/ficha-tema.css"><script type="module" src="/hub.js"></script></head>`);
      return responderHtml(res, html);
    }
    return estatico(res, join(FICHA_DIR, rel));
  }

  // ---- páginas
  if (p.startsWith("/m/") || p.startsWith("/o/") || p.startsWith("/d/") || p.startsWith("/c/")) {
    const og = alvoDaRota(p);
    return responderHtml(res, htmlComOg(p.startsWith("/c/") ? "colecao.html" : "grimorio.html", og?.[0], og?.[1], og?.[2] || "Hub T20"), og ? 200 : 404);
  }
  if (p === "/mestre" && eu.papel !== "mestre") return redirecionar(res, "/");
  if (PAGINAS[p]) return estatico(res, pagina(PAGINAS[p]));
  if (p === "/grimorio") return redirecionar(res, "/");
  if (p.startsWith("/data/")) return estatico(res, join(RAIZ, "data", p.slice(6).replace(/[^\w.-]/g, "")));
  return estatico(res, join(RAIZ, "static", p.slice(1).replace(/[^\w./-]/g, "").replace(/\.\./g, "")));
}

// ---- textos oficiais + busca ----
const ELEMENTOS = { fogo: ["Reflexos", "em chamas"], frio: ["Fortitude", "arrefecida"], eletricidade: ["Reflexos", "eletrificada"] };
function carregarTextos() {
  if (!carregarTextos.cache) {
    const t = lerJson(join(DADOS, "textos.json"), {});
    for (const m of Object.values(t)) {
      const d = norm(m.descricao || "");
      const tem = Object.keys(ELEMENTOS).filter((e) => new RegExp("\\b" + (e === "eletricidade" ? "eletric" : e)).test(d));
      for (const a of m.aprimoramentos || []) {
        if (!/muda a resist[eê]ncia para Reflexos \(eletricidade, fogo\)/.test(a.texto) || tem.length !== 1) continue;
        const [teste, cond] = ELEMENTOS[tem[0]];
        a.texto = `muda a resistência para ${teste} parcial. Se falha, a criatura fica ${cond} (${tem[0]}). (DB #219)`;
      }
    }
    // livro e página (do compêndio) e o que a revisão 1 a 1 leu: resumo, temas e papel na mesa
    const extras = carregarBase().magias || {};
    for (const [slug, m] of Object.entries(t)) {
      const x = extras[slug];
      if (!x) continue;
      Object.assign(m, { livro: x.livro, pagina: x.pagina, tags: x.tags || [], resumo: x.resumo, papel: x.papel || [] });
      if (x.livro && !m.publicacao) m.publicacao = x.livro + (x.pagina ? `, p. ${x.pagina}` : "");
    }
    carregarTextos.cache = t;
  }
  return carregarTextos.cache;
}
// poderes.json e base.json saem de tools/construir-base.mjs: compêndios do Foundry + dados do criador de fichas +
// revisão 1 a 1 (resumo e temas). Cada poder diz COMO SE OBTÉM (acesso) e de quem é (donos); a base liga raças,
// classes, divindades, origens e distinções aos seus poderes.
function carregarPoderes() {
  if (!carregarPoderes.cache) {
    const p = lerJson(join(DADOS, "poderes.json"), {});
    for (const t of Object.values(p)) { t.donos ??= []; t.tags ??= []; t.acesso ??= "geral"; }
    carregarPoderes.cache = p;
  }
  return carregarPoderes.cache;
}
function carregarBase() {
  return (carregarBase.cache ??= { racas: [], classes: [], divindades: [], origens: [], distincoes: [], aliases: {}, magias: {}, ...lerJson(join(DADOS, "base.json"), {}) });
}
// link antigo (/d/<slug do hub velho>) abre o poder que ficou no lugar
const poderPorSlug = (s) => { const P = carregarPoderes(); return P[s] ? [s, P[s]] : P[carregarBase().aliases[s]] ? [carregarBase().aliases[s], P[carregarBase().aliases[s]]] : [s, null]; };

const ordinal = (n) => `${n}º`;
const emLista = (xs) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " e " + xs.at(-1);
/** Uma frase dizendo como aquele poder chega na ficha — a pergunta que a taxonomia inteira existe pra responder. */
function comoObter(p) {
  const donos = emLista(p.donos || []), lista = p.opcaoDe ? ` É uma das opções de “${p.opcaoDe}”.` : "";
  switch (p.acesso) {
    case "raca": return p.opcaoDe
      ? `Opção de “${p.opcaoDe}” da raça ${donos}: escolhida dentro da própria raça. Só ${donos} tem acesso.`
      : `Habilidade de raça: todo ${donos} recebe ao escolher a raça. Não pode ser obtida por outras raças.`;
    case "poder-raca": return `Poder de raça: só ${donos || "as raças indicadas no pré-requisito"}. É um poder geral — escolhido no lugar de um poder de classe, não vem de graça com a raça.`;
    case "classe-habilidade": {
      const niveis = Object.entries(p.niveis || {}).map(([c, ns]) => `${c} no ${emLista(ns.map(ordinal))} nível`);
      return `Habilidade de classe (${donos}): recebida automaticamente${niveis.length ? " — " + niveis.join("; ") : " no nível indicado na tabela da classe"}.${lista}`;
    }
    case "classe-poder": return `Poder de ${donos}: escolhido da lista da classe quando ela concede um poder (do 2º nível em diante). Variantes da classe usam a mesma lista.${lista}`;
    case "geral": return p.categoria === "Tormenta" ? "Poder da Tormenta: qualquer personagem que cumpra os pré-requisitos, no lugar de um poder de classe. Cada poder da Tormenta custa Carisma."
      : p.categoria === "Grupo" ? "Poder de grupo: qualquer personagem, no lugar de um poder de classe. Só funciona com outro personagem jogador com o mesmo poder na cena."
      : `Poder geral de ${p.categoria.toLowerCase()}: qualquer personagem que cumpra os pré-requisitos, no lugar de um poder de classe (algumas raças e origens também dão um poder geral).`;
    case "concedido": return `Poder concedido: só devotos de ${donos || "certa divindade"}. O devoto recebe um ao se devotar (clérigos e frades, dois) e pode pegar outros no lugar de poderes de classe.`;
    case "origem": return `Benefício de origem${donos ? ` (${donos})` : ""}: só para quem escolheu essa origem na criação do personagem.`;
    case "distincao": return `Poder da distinção ${donos}: exige a admissão (conquistada em jogo) e 5º nível; é escolhido como um poder geral.${lista}`;
    case "complicacao": return `Complicação (regra opcional do Heróis de Arton)${donos ? ` de ${donos}` : ""}: desvantagem pega na criação em troca de um poder geral.`;
    case "aventura": return `Recompensa de aventura (${p.livro}): concedida pela história, não se escolhe ao subir de nível.`;
  }
  return "";
}
/** O poder como a carta e o Arauto leem: o registro + como se obtém + nomes do que ele libera e do que ele exige. */
function poderCompleto(slug, p) {
  const P = carregarPoderes(), porNome = (carregarPoderes.porNome ??= new Map(Object.entries(P).map(([s, x]) => [norm(x.base || x.nome), s])));
  return { ...p, slug, comoObter: comoObter(p),
    libera: (p.libera || []).filter((s) => P[s]).map((s) => ({ slug: s, nome: P[s].nome })),
    exige: (p.pre?.poderes || []).map((n) => ({ nome: n, slug: porNome.get(norm(n)) })).filter((x) => x.slug && x.slug !== slug) };
}
const norm = (x) => (x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || randomBytes(3).toString("hex");
const blobs = new WeakMap();
function blobDe(t) {
  if (!blobs.has(t)) blobs.set(t, norm([t.nome, t.linha, t.escola, t.grupo, t.descricao,
    t.categoria, t.sub, t.livro, t.prereq, t.resumo, t.opcaoDe, (t.donos || []).join(" "), temasDoItem(t),
    Object.entries(t.stats || {}).map(([k, v]) => `${k} ${v}`).join(" "),
    (t.aprimoramentos || []).map((a) => a.texto || a).join(" ")].join(" ")));
  return blobs.get(t);
}
// temas do item como "#deslocamento #investida": a palavra digitada ("veloz") vira "#deslocamento" e só casa com quem
// foi REVISADO como tendo o tema — não com todo texto que cita a palavra de passagem
const temasDoItem = (t) => (t.tags || []).map((x) => "#" + x).join(" ");
// o meio da relevância (vale 2): o que o item É — tipo, dono, pré-requisito, temas
const meioDe = (t) => [t.linha, t.categoria, t.sub, t.livro, t.prereq, t.opcaoDe, temasDoItem(t), (t.tags || []).map((x) => TEMA_ROTULO[x]).join(" ")].join(" ");
// ---- busca (grimório, poderes e toda coleção): cada palavra vira um grupo de alternativas e o item passa
// se TODO grupo bate (AND). Alternativas FORTES = a palavra e seus sinônimos; FRACAS = palavras do próprio
// acervo parecidas por digitação (relampgo → relampago) e, com dados/ia.key, sinônimos pedidos à IA.
// Fraca só entra quando a palavra não acha nada como está, e vale metade na relevância.
const SINONIMOS = [
  ["fogo", "chama", "queima", "incendi", "ignea", "igneo"],
  ["frio", "gelo", "congel", "gelid"],
  ["eletricidade", "eletric", "eletrific", "relampago", "choque", "faisca"],
  ["acido", "corro"],
  ["cura", "curar", "recupera pv", "recupera pontos de vida", "regenera"],
  ["medo", "amedrontado", "apavorado", "assust", "aterroriz"],
  ["veneno", "envenenado", "toxic"],
  ["ilusao", "ilusor", "imagem", "invisi"],
  ["voar", "voo", "levit", "deslocamento de voo"],
  ["luz", "ilumin", "brilh", "ofuscado", "cego"],
  ["escuridao", "trevas", "sombra"],
  ["morto", "morto-vivo", "mortos-vivos", "necro", "zumbi", "esqueleto"],
  ["invocar", "convoca", "criatura convocada"],
  ["teleport", "teletransport", "deslocar", "viaj"],
  ["bonus", "+1", "+2", "+5", "recebe +"],
  ["dormir", "sono", "inconsciente", "adormec"],
  ["paralis", "imovel", "enredado", "agarrado"],
  ["escudo", "protecao", "proteg", "abjur"],
  ["voz", "som", "sonico", "silenc", "surdo"],
  ["mental", "mente", "fascinado", "enfeiticado"],
];
// Levenshtein com teto: para de contar quando passa de `max`
function distancia(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let menor = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); menor = Math.min(menor, cur[j]); }
    if (menor > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// vocabulário de cada fonte (palavras com 4+ letras dos blobs), montado uma vez por objeto-fonte
const vocabs = new WeakMap();
function vocabDe(chave, blobsDe) {
  if (!vocabs.has(chave)) { const v = new Map(); for (const b of blobsDe()) for (const w of b.split(/[^a-z0-9]+/)) if (w.length >= 3) v.set(w, (v.get(w) || 0) + 1); vocabs.set(chave, { palavras: v, parecidos: new Map() }); }
  return vocabs.get(chave);
}
function parecidos(w, vocab) {
  if (!vocab || w.length < 5) return [];
  if (!vocab.parecidos.has(w)) {
    let out = [];
    for (const v of vocab.palavras.keys()) if (v.includes(w)) { out = null; break; } // já casa como está: nada a corrigir
    if (out) {
      const max = w.length >= 8 ? 2 : 1;
      for (const [v, n] of vocab.palavras) if (v.length >= 4 && Math.abs(v.length - w.length) <= max) { const d = distancia(w, v, max); if (d <= max) out.push([v, d, n]); }
      const dMin = Math.min(...out.map((c) => c[1])), topo = Math.max(0, ...out.filter((c) => c[1] === dMin).map((c) => c[2]));
      out = out.filter((c) => c[1] === dMin && c[2] * 5 >= topo).sort((a, b) => b[2] - a[2]).map((c) => c[0]);
    }
    vocab.parecidos.set(w, (out || []).slice(0, 8));
  }
  return vocab.parecidos.get(w);
}
const VAZIAS = new Set(["de", "do", "da", "dos", "das", "em", "a", "o", "e", "um", "uma", "no", "na", "com"]);
// palavras de pergunta: numa frase ("poderes que me deixem mais veloz") elas não dizem o que procurar
const DE_FRASE = new Set(["que", "para", "pra", "por", "ser", "ter", "mais", "como", "quero", "queria", "preciso", "focado", "focada", "relacionado", "relacionados", "relacionada", "relacionadas", "sobre",
  "algum", "alguma", "alguns", "algumas", "tipo", "fazer", "faz", "me", "meu", "minha", "meus", "minhas", "seu", "sua", "personagem", "personagens", "poder", "poderes", "magia", "magias", "habilidade", "habilidades",
  "qual", "quais", "tem", "existe", "existem", "dar", "da", "dao", "deem", "deixa", "deixam", "deixe", "deixem", "ficar", "fica", "muito", "bem", "melhor", "melhores", "bom", "boa", "bons", "ou", "os", "as", "ao", "aos", "se", "eu", "isso", "esse", "essa"]);
// "magias"/"mágicas"/"dragões" → raiz que também casa o singular e o outro gênero
function raiz(w) {
  if (w.length < 5) return w;
  const r = w.replace(/oes$|aes$/, "ao").replace(/ais$/, "al").replace(/eis$/, "el").replace(/(?<=[^aeiou])es$/, "").replace(/s$/, "");
  return r.length >= 6 ? r.replace(/[ao]$/, "") : r;
}
// "espadalonga" → ["espada", "longa"] quando as duas metades são palavras do acervo e a junta não aparece
function separar(w, vocab) {
  if (!vocab || w.length < 7 || [...vocab.palavras.keys()].some((v) => v.includes(w))) return null;
  for (let i = 3; i <= w.length - 3; i++) if (vocab.palavras.has(w.slice(0, i)) && vocab.palavras.has(w.slice(i))) return [w.slice(0, i), w.slice(i)];
  return null;
}
// "entre aspas" = trecho cru: casa exatamente (com a pontuação, "1/4", "+2 na Defesa"), sem sinônimo, raiz,
// correção nem IA. Vira um termo que começa com aspa — palavra solta nunca tem aspa, então tem() sabe a diferença.
// O trecho aceita VARIÁVEIS (lib/trecho.mjs): # = qualquer número, % = uma a quatro palavras, (a|b) = alternativas —
// "+#m" acha +3m, +6m, +1,5m; "+# em %" acha "+2 em Atletismo". Trecho é obrigatório: quem não tem, não entra.
function termosBusca(q, vocab) {
  const literais = [];
  const guarda = (t) => { t = t.trim().replace(/\s+/g, " "); if (t) literais.push(Object.assign([`"${t}"`], { fortes: 1 })); return " "; };
  q = norm(q).replace(/"([^"]*)"?/g, (_, t) => guarda(t))
    // palavra solta com # ("+#m", "#d#") é trecho com variável mesmo sem aspas — desde que o # não esteja sozinho nem colado num número ("#219")
    .replace(/(^|\s)(\S*#(?!\d)\S*)(?=\s|$)/g, (_, antes, t) => /[^#\s]/.test(t) ? antes + guarda(t) : antes + " ");
  return [...literais, ...termosSoltos(q, vocab)];
}
function termosSoltos(q, vocab) {
  let ws = q.split(/[^a-z0-9+]+/).filter(Boolean); // hífen, dois-pontos, vírgula viram espaço
  ws = ws.filter((w) => ws.length === 1 || !VAZIAS.has(w));
  // frase de 3+ palavras: sem as palavras de pergunta, desde que sobre alguma coisa pra procurar
  const uteis = ws.length >= 3 ? ws.filter((w) => !DE_FRASE.has(w)) : ws;
  ws = (uteis.length ? uteis : ws).flatMap((w) => separar(w, vocab) || [w]);
  return ws.map((w) => {
    const grupo = SINONIMOS.find((g) => g.some((sin) => w.startsWith(sin) || sin.startsWith(w) && w.length >= 4));
    const alts = grupo ? [...new Set([w, ...grupo])] : [w];
    if (!alts.includes(raiz(w))) alts.push(raiz(w));
    for (const tema of temasDaConsulta(w)) alts.push("#" + tema); // "veloz" também casa com quem tem o tema deslocamento
    alts.fortes = alts.length;
    for (const p of parecidos(w, vocab)) if (!alts.includes(p)) alts.push(p);
    return alts;
  });
}
// palavra de até 3 letras ("for", "sab", "1") só casa inteira: "for 1" não pode achar "forma"
const fronteiras = new Map();
function tem(texto, x) {
  if (x[0] === '"') return padrao(x.slice(1, -1)).re.test(texto); // trecho cru (com # e % como variáveis): lib/trecho.mjs
  if (x.length > 3) return texto.includes(x);
  if (!fronteiras.has(x)) fronteiras.set(x, new RegExp(`(?:^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`));
  return fronteiras.get(x).test(texto);
}
const bate = (blob, termos) => termos.every((alts) => alts.some((t) => tem(blob, t)));
// todas as palavras (AND); se nada tem todas ("dragão vermelho" sem dragão vermelho), serve qualquer uma e a relevância ordena
function filtrar(lista, blob, termos) {
  if (!termos.length) return lista;
  const todas = lista.filter((x) => bate(blob(x), termos));
  if (todas.length || termos.length < 2) return todas;
  const fixos = termos.filter((alts) => alts[0][0] === '"'); // trecho entre aspas é obrigatório mesmo aqui
  return lista.filter((x) => { const b = blob(x); return fixos.every((alts) => tem(b, alts[0])) && termos.some((alts) => alts.some((t) => tem(b, t))); });
}
// relevância: nome ×3 > linha/escola/categoria ×2 > corpo ×1 por grupo (fraca vale metade); nome igual à consulta ou começando por ela sobe
function relevancia(partes, termos, q) {
  if (!termos.length) return 0;
  q = q.replace(/"/g, "").trim();
  const [nome, meio, corpo] = partes.map(norm), n = nome.trim(), frase = termos.map((a) => a[0].replace(/"/g, "")).join(" ");
  let r = n === q ? 6 : n.startsWith(q) ? 3 : q.length >= 6 && Math.abs(n.length - q.length) <= 2 && distancia(n, q, 2) <= 2 ? 4 : 0; // "encoracado" ≈ Encouraçado
  // a frase na ordem em que foi digitada ("treinado em luta", com o "em" que os termos descartam) pesa mais que as palavras soltas:
  // +4 no que o item É (pré-requisito, tipo), +2 no corpo; no nome ("Golpe de Raspão" em "golpe de raspão aprimorado"), +2
  if (termos.length > 1) {
    const frases = [...new Set([frase, q])].filter((f) => f.length > 5);
    r += frases.some((f) => meio.includes(f)) ? 4 : frases.some((f) => corpo.includes(f)) ? 2 : 0;
    if (r < 3 && n !== q && frases.some((f) => n.includes(f))) r += 2;
  }
  for (const alts of termos) {
    let melhor = 0;
    alts.forEach((x, i) => { const p = (tem(nome, x) ? 3 : tem(meio, x) ? 2 : tem(corpo, x) ? 1 : 0) * (i < alts.fortes ? 1 : 0.5); if (p > melhor) melhor = p; });
    r += melhor;
  }
  return r;
}
// IA opcional: com dados/ia.key (chave da Anthropic), cada palavra nova da consulta ganha até 6 radicais de T20
// pedidos ao modelo UMA vez (cache em dados/ia-busca.json); sem chave ou com erro, a busca segue sem ela
const ARQ_IA = join(DADOS, "ia-busca.json"), ARQ_IA_KEY = join(DADOS, "ia.key");
let iaCache = null;
async function sinonimosIA(w) {
  if (CHECK || w.length < 4 || !existsSync(ARQ_IA_KEY)) return [];
  iaCache ??= lerJson(ARQ_IA, {});
  if (w in iaCache) return iaCache[w];
  iaCache[w] = []; // marca antes: a mesma palavra digitada de novo enquanto a IA responde não dispara outra chamada
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(6000),
      headers: { "x-api-key": readFileSync(ARQ_IA_KEY, "utf8").trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content:
        `Busca num compêndio de Tormenta 20 (RPG, português). Termo digitado: "${w}". Responda SÓ um array JSON com até 6 radicais de palavras em português (minúsculas, sem acento, sem espaço; radical curto: "congel" cobre congelado/congelar) que o texto de uma magia, poder, monstro ou item usaria pra falar disso. Só termos específicos; nada genérico como "dano", "criatura", "teste". Se não houver, [].` }] }) });
    const texto = (await r.json()).content?.[0]?.text || "[]";
    iaCache[w] = JSON.parse(texto.match(/\[[\s\S]*\]/)?.[0] || "[]").map(norm).filter((s) => /^[a-z0-9-]{3,}$/.test(s) && s !== w).slice(0, 6);
    gravarJson(ARQ_IA, iaCache);
  } catch { delete iaCache[w]; return []; }
  return iaCache[w];
}
async function comIA(termos) {
  for (const alts of termos) if (alts[0][0] !== '"') for (const s of await sinonimosIA(alts[0])) if (!alts.includes(s)) alts.push(s);
  return termos;
}

// ---- busca v2: palavra + tema + SENTIDO. A mesma função serve a página, a busca em tudo e o Arauto. ----
// Sentido = vetores bge-m3 (lib/vetores.mjs): "ficar mais rápido" acha quem aumenta deslocamento sem usar essas palavras.
const vetores = criarVetores(join(DADOS, "vetores"), { desligado: CHECK });
const ehFrase = (q) => q.replace(/"[^"]*"?/g, " ").trim().split(/\s+/).filter(Boolean).length >= 3;
/** id → cosseno dos itens da fonte mais parecidos com a consulta; null se a consulta é curta, é só aspas, ou o Ollama não respondeu a tempo. */
async function sentidoDe(fonte, q, ms) {
  const livre = q.replace(/"[^"]*"?/g, " ").replace(/\S*#\S*/g, " ").trim();
  if (livre.length < 4 || !vetores.tem(fonte)) return null;
  const v = await vetores.embutir(livre, ms);
  return v ? new Map(vetores.vizinhos(fonte, v, 60, 0.46)) : null;
}

/**
 * O miolo da busca v2, igual pra toda fonte. `itens`: [[id, t]]; `blob(t)`: o texto inteiro normalizado; `partes(t)`: [nome, meio, corpo].
 *  1. palavra: quem tem TODAS as palavras (+3 na nota). Se forem poucos (< 6), entra também quem tem só parte delas;
 *  2. sentido: soma pontos em quem já casou e resgata quem só o sentido achou (lib/vetores.mjs);
 *  3. corte: o que entrou por ter só parte das palavras, ou só pelo sentido, sai se ficou muito abaixo do melhor
 *     (senão "arma que volta pra mão depois de arremessada" devolve 500 itens). Quem tem todas as palavras nunca é cortado.
 */
async function procurar({ fonte, chave, itens, blob, partes, campos, q, ms, limiares }) {
  const termos = await comIA(termosBusca(q, vocabDe(chave, () => itens.map(([, t]) => blob(t)))));
  if (!termos.length) return itens.map(([id, t]) => ({ id, t, rel: 0 }));
  // trecho entre aspas (ou com #) é OBRIGATÓRIO: quem não tem o trecho não entra nem por parte das palavras, nem pelo sentido.
  // E é procurado no texto CRU do item (o que a pessoa lê: `campos`), não no blob — o blob tem os temas ("#pericia") e
  // outros campos de apoio, e "perícia" entre aspas acharia 285 poderes que não têm a palavra. Assim todo resultado mostra onde casou.
  const padroes = termos.filter((alts) => alts[0][0] === '"').map((alts) => padrao(alts[0].slice(1, -1)));
  const n = termos.length, casados = [];
  for (const [id, t] of itens) {
    if (padroes.length) { const cru = cruDe(t, campos); if (!padroes.every((p) => p.re.test(cru))) continue; }
    const b = blob(t);
    let k = 0;
    for (const alts of termos) if (alts[0][0] === '"' || alts.some((x) => tem(b, x))) k++;
    if (k) casados.push([id, t, k]);
  }
  const cheios = casados.filter((c) => c[2] === n), parcial = n >= 2 && cheios.length < 6;
  const lexico = (parcial ? casados : cheios).map(([id, t, k]) => ({ id, t, cheio: k === n, rel: relevancia(partes(t), termos, q) + (k === n && n > 1 ? 3 : 0) }));
  const porId = new Map(itens);
  const sem = padroes.length ? null : await sentidoDe(fonte, q, ms);
  const out = fundir(lexico, sem, (id) => porId.has(id) && { id, t: porId.get(id) }, cheios.length < 12 || ehFrase(q), limiares);
  const corte = Math.max(1, 0.3 * Math.max(0, ...out.map((x) => x.rel)));
  const fica = out.filter((x) => x.cheio || x.rel >= corte);
  // mostra ONDE o trecho casou (com o texto original) e, se ele tem #, o maior número achado — a página ordena por ele
  if (padroes.length) {
    const p = padroes.find((x) => x.numeros) || padroes[0]; // com dois trechos, manda o primeiro que tem número
    for (const x of fica) Object.assign(x, destacar(campos(x.t), p) || {});
  }
  return fica;
}
// texto cru de cada item, normalizado e guardado (um por item, como o blob)
const crus = new WeakMap();
function cruDe(t, campos) {
  if (!crus.has(t)) crus.set(t, norm(campos(t).filter(Boolean).join("\n")));
  return crus.get(t);
}
/** O trecho da consulta que dita o destaque e o número: o primeiro com #, senão o primeiro; null se a consulta não tem trecho. */
function padraoDaConsulta(termos) {
  const ps = termos.filter((alts) => alts[0][0] === '"').map((alts) => padrao(alts[0].slice(1, -1)));
  return ps.find((x) => x.numeros) || ps[0] || null;
}

/** Poderes que casam com a consulta: [{ id, t, rel, sem? }] sem ordem. `soPre` procura só no pré-requisito (aí vale a palavra exata). */
async function procurarPoderes(q, { soPre = false, ms } = {}) {
  const todos = carregarPoderes();
  if (soPre) {
    const termos = await comIA(termosBusca(q, vocabDe(todos, () => Object.values(todos).map(blobDe))));
    const p = padraoDaConsulta(termos);
    return filtrar(Object.entries(todos).filter(([, t]) => t.prereq), ([, t]) => norm(t.prereq), termos)
      .map(([id, t]) => ({ id, t, rel: relevancia([t.nome, t.prereq, ""], termos, q), ...(p && destacar(["Pré-requisito: " + t.prereq], p)) }));
  }
  return procurar({ fonte: "poderes", chave: todos, itens: Object.entries(todos), blob: blobDe, partes: (t) => [t.nome, meioDe(t), [t.resumo, t.descricao].join(" ")], q, ms,
    campos: (t) => [t.descricao, t.prereq && "Pré-requisito: " + t.prereq, t.resumo, t.nome, t.linha] });
}
const aprsDe = (t) => (t.aprimoramentos || []).map((a) => a.texto || a).join(" ");
async function procurarMagias(q, { ms } = {}) {
  const textos = carregarTextos();
  return procurar({ fonte: "magias", chave: textos, itens: Object.entries(textos), blob: blobDe, q, ms,
    campos: (t) => [t.descricao, Object.entries(t.stats || {}).map(([k, v]) => `${k}: ${v}`).join("; "), ...(t.aprimoramentos || []).map((a) => `${a.custo}: ${a.texto || a}`), t.resumo, t.nome, t.linha, t.publicacao],
    partes: (t) => [t.nome, [meioDe(t), t.escola, t.grupo, t.resumo, t.descricao, Object.values(t.stats || {}).join(" ")].join(" "), aprsDe(t)] });
}
async function procurarColecao(nome, q, { ms } = {}) {
  const col = carregarColecao(nome);
  if (!col) return null;
  col.pares ??= col.itens.map((i) => [i.id, i]);
  return procurar({ fonte: "c-" + nome, chave: col, itens: col.pares, blob: (i) => i.t, q, ms, limiares: LONGO, campos: (i) => [semHtml(i.html), i.nome, i.linha],
    partes: (i) => [i.nome, [i.linha, ...Object.values(i.f || {})].join(" "), i.t] });
}
const porRel = (a, b) => b.rel - a.rel || a.t.nome.localeCompare(b.t.nome, "pt");

// item da lista de poderes: o que a página precisa pra filtrar e mostrar sem pedir a ficha (r = resumo de uma linha)
const itemPoder = (slug, t) => ({ slug, nome: t.nome, categoria: t.categoria, acesso: t.acesso, sub: t.sub || undefined, donos: t.donos.length ? t.donos : undefined, racas: t.racas,
  livro: t.livro, custo: t.custo || undefined, divindade: t.divindade, op: t.opcaoDe, tags: t.tags, r: t.resumo, pre: t.prereq || undefined });
const itemMagia = (slug, t) => ({ slug, nome: t.nome, escola: t.escola, grupo: t.grupo, circulo: t.circulo, livro: t.livro, tags: t.tags, papel: t.papel, r: t.resumo, pocao: tipoDePocao(t.stats?.["Alvo/Área"]),
  ...eixosDe(t.stats?.["Execução"], t.stats?.["Alcance"], t.stats?.["Resistência"]) });

// ---- o Arauto: as quatro ferramentas que o modelo usa (lib/arauto.mjs cuida do laço). Saída em texto enxuto, um item por linha. ----
const COLECOES_ARAUTO = ["itens", "ameacas", "regras", "str", "perigos", "parceiros"];
const pag = (t) => t.livro ? `${t.livro}${t.pagina ? ", p. " + t.pagina : ""}` : "";
const linhaPoder = (slug, t) => [`d:${slug}`, t.nome, `${t.linha.split(" · ").slice(0, -1).join(" · ") || t.linha}${t.opcaoDe ? ` (opção de ${t.opcaoDe})` : ""}`, pag(t), t.prereq ? "pré: " + t.prereq : "sem pré-requisito", t.custo, t.resumo].filter(Boolean).join(" | ");
const linhaMagia = (slug, t) => [`o:${slug}`, t.nome, t.linha, pag(t), t.resumo].filter(Boolean).join(" | ");
// consulta com trecho entre aspas: onde casou no texto; e, se o trecho tem # (número), quem tem o maior vem primeiro (sort é estável: o resto segue por relevância)
const citar = (trecho) => trecho ? ` | trecho: “${trecho.join("").trim()}”` : "";
const porNum = (a, b) => (b.num ?? -Infinity) - (a.num ?? -Infinity);
const acha = (lista, nome) => { const n = norm(nome).trim(); return lista.find((x) => norm(x.nome) === n) || lista.find((x) => norm(x.nome).startsWith(n)) || lista.find((x) => norm(x.nome).includes(n)); };
const semHtml = (h) => String(h || "").replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/th)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const ferramentasArauto = {
  async buscar({ onde, consulta = "", tema, acesso, dono, circulo, limite }) {
    const q = norm(consulta).trim(), n = Math.max(1, Math.min(40, Number(limite) || 15)), ms = 4000;
    const dn = dono ? norm(dono).trim() : "";
    const cab = (total, o) => `${total} em ${o}${total > n ? ` (os ${n} melhores)` : ""}:`;
    if (onde === "poderes") {
      const P = carregarPoderes();
      let lista = q ? (await procurarPoderes(q, { ms })).sort(porRel) : Object.entries(P).map(([id, t]) => ({ id, t })).sort((a, b) => a.t.nome.localeCompare(b.t.nome, "pt"));
      lista = lista.filter(({ t }) => (!tema || t.tags.includes(tema)) && (!acesso || t.acesso === acesso) && (!dn || t.donos.some((d) => norm(d).includes(dn)) || (t.racas || []).some((d) => norm(d) === dn)));
      if (!lista.length) return "Nenhum poder com esses critérios. Tente outras palavras, ou só o tema, ou tire o filtro de dono.";
      return [cab(lista.length, "poderes"), ...lista.sort(porNum).slice(0, n).map(({ id, t, trecho }) => linhaPoder(id, t) + citar(trecho))].join("\n");
    }
    if (onde === "magias") {
      const T = carregarTextos();
      let lista = q ? (await procurarMagias(q, { ms })).sort(porRel) : Object.entries(T).map(([id, t]) => ({ id, t })).sort((a, b) => a.t.circulo - b.t.circulo || a.t.nome.localeCompare(b.t.nome, "pt"));
      lista = lista.filter(({ t }) => (!tema || (t.tags || []).includes(tema)) && (!circulo || t.circulo === Number(circulo)));
      if (!lista.length) return "Nenhuma magia com esses critérios.";
      return [cab(lista.length, "magias"), ...lista.sort(porNum).slice(0, n).map(({ id, t, trecho }) => linhaMagia(id, t) + citar(trecho))].join("\n");
    }
    const B = carregarBase(), P = carregarPoderes();
    const casa = (texto) => !q || termosBusca(q).every((alts) => alts.some((x) => tem(norm(texto), x)));
    if (onde === "racas") {
      const lista = B.racas.filter((r) => (!tema || (r.ficha?.tags || []).includes(tema)) && casa([r.nome, r.ficha?.resumo, r.ficha?.deslocamento, r.ficha?.sentidos, r.ficha?.tipo, ...r.habilidades.map((s) => P[s]?.nome + " " + P[s]?.resumo)].join(" ")));
      if (!lista.length) return "Nenhuma raça com esses critérios (tente só o tema, ou `ficha` com o nome).";
      return [cab(lista.length, "raças"), ...lista.slice(0, n).map((r) => [`raça ${r.nome}`, r.livro, r.ficha?.atributos, "deslocamento " + (r.ficha?.deslocamento || "?"), r.ficha?.tamanho, r.ficha?.tipo, r.ficha?.resumo].filter(Boolean).join(" | ")), "(use `ficha` tipo=raca para as habilidades de cada uma)"].join("\n");
    }
    if (onde === "classes") {
      const lista = B.classes.filter((c) => casa([c.nome, c.varianteDe, ...c.habilidades.map((h) => h.nome)].join(" ")));
      return lista.length ? [cab(lista.length, "classes"), ...lista.slice(0, n).map((c) => [`classe ${c.nome}`, c.livro, c.varianteDe && `variante de ${c.varianteDe}`, c.pvPorNivel != null && `${c.pvPorNivel} PV e ${c.pmPorNivel} PM por nível`, `${c.poderes.length || c.poderesDaBase?.length || 0} poderes na lista`].filter(Boolean).join(" | ")), "(use `ficha` tipo=classe para habilidades por nível e poderes)"].join("\n") : "Nenhuma classe com esse nome.";
    }
    if (onde === "origens" || onde === "divindades" || onde === "distincoes") {
      const lista = B[onde].filter((o) => casa([o.nome, ...(o.pericias || []), ...o.poderes.map((s) => P[s]?.nome + " " + P[s]?.resumo)].join(" ")));
      const rot = { origens: "origem", divindades: "divindade", distincoes: "distinção" }[onde];
      return lista.length ? [cab(lista.length, onde), ...lista.slice(0, n).map((o) => [`${rot} ${o.nome}`, o.livro, o.pericias?.length && "perícias: " + o.pericias.join(", "), o.poderes.length && "poderes: " + o.poderes.slice(0, 8).map((s) => P[s]?.nome).join(", ")].filter(Boolean).join(" | ")), `(use \`ficha\` para os detalhes)`].join("\n") : `Nada em ${onde} com esses critérios.`;
    }
    if (COLECOES_ARAUTO.includes(onde)) {
      const lista = q ? ((await procurarColecao(onde, q, { ms })) || []).sort(porRel) : [];
      return lista.length ? [cab(lista.length, onde), ...lista.sort(porNum).slice(0, n).map(({ t, trecho }) => [`c:${onde}/${t.id}`, t.nome, t.linha].filter(Boolean).join(" | ") + citar(trecho))].join("\n") : `Nada em ${onde} para “${consulta}” (essa parte do acervo só aceita busca por palavras).`;
    }
    if (onde === "tudo") {
      const partes = [];
      for (const [o, k] of [["poderes", 8], ["magias", 5], ["racas", 4], ["regras", 4], ["itens", 4], ["ameacas", 3]]) partes.push(await ferramentasArauto.buscar({ onde: o, consulta, tema, limite: k }));
      return partes.filter((x) => !/^(Nenhum|Nada)/.test(x)).join("\n\n") || "Nada no acervo com essas palavras.";
    }
    return "Lugar desconhecido: " + onde;
  },

  async ver({ ids = [] }) {
    const out = [];
    for (const id of [].concat(ids).slice(0, 8)) {
      const [tipo, resto] = [String(id)[0], String(id).slice(2)];
      if (tipo === "d") {
        const [slug, t] = poderPorSlug(resto.replace(/[^\w-]/g, ""));
        if (!t) { out.push(`${id}: não existe.`); continue; }
        const c = poderCompleto(slug, t);
        out.push([`## ${t.nome} [d:${slug}]`, `${t.linha}${t.pagina ? ", p. " + t.pagina : ""}`, "Como se obtém: " + c.comoObter, t.prereq && "Pré-requisito: " + t.prereq, t.custo && "Custo: " + t.custo, t.magica && "Habilidade mágica.",
          t.descricao, c.libera.length && "É pré-requisito de: " + c.libera.map((x) => `${x.nome} [d:${x.slug}]`).join(", "), t.nota && "Nota: " + t.nota].filter(Boolean).join("\n"));
      } else if (tipo === "o") {
        const t = carregarTextos()[resto.replace(/[^\w-]/g, "")];
        if (!t) { out.push(`${id}: não existe.`); continue; }
        out.push([`## ${t.nome} [${id}]`, `${t.linha}${pag(t) ? " · " + pag(t) : ""}`, Object.entries(t.stats || {}).map(([k, v]) => `${k}: ${v}`).join("; "), t.descricao,
          ...(t.aprimoramentos || []).map((a) => `${a.custo}: ${a.texto}`)].filter(Boolean).join("\n"));
      } else if (tipo === "c") {
        const [col, cid] = resto.split("/");
        const it = carregarColecao(col)?.porId.get(cid);
        out.push(it ? [`## ${it.nome} [${id}]`, it.linha, semHtml(it.html).slice(0, 7000)].filter(Boolean).join("\n") : `${id}: não existe.`);
      } else out.push(`${id}: id desconhecido (use os ids que vieram de buscar ou ficha).`);
    }
    return out.join("\n\n") || "Nenhum id informado.";
  },

  async ficha({ tipo, nome }) {
    const B = carregarBase(), P = carregarPoderes();
    const l = (s) => P[s] ? `- ${P[s].nome} [d:${s}] (${pag(P[s])})${P[s].prereq ? ` (pré: ${P[s].prereq})` : ""}${P[s].custo ? ` (${P[s].custo})` : ""}: ${P[s].resumo || ""}` : null;
    const nomes = (lista) => `Não achei “${nome}”. Existem: ${lista.map((x) => x.nome).join(", ").slice(0, 1500)}`;
    if (tipo === "raca") {
      const r = acha(B.racas, nome);
      if (!r) return nomes(B.racas);
      const porLista = {};
      for (const s of r.opcoes) (porLista[P[s].opcaoDe] ??= []).push(s);
      return [`# Raça ${r.nome} (${r.livro})`, r.ficha && `Atributos: ${r.ficha.atributos}\nDeslocamento: ${r.ficha.deslocamento} · Tamanho: ${r.ficha.tamanho} · Tipo: ${r.ficha.tipo} · Sentidos: ${r.ficha.sentidos}\nEscolhas dentro da raça: ${r.ficha.escolhas}`,
        "Habilidades de raça (todo personagem da raça recebe; ninguém de outra raça pega):", ...r.habilidades.map(l),
        ...(r.linhagens || []).flatMap((x) => [`Linhagem ${x.nome} (escolhe uma linhagem):`, ...x.habilidades.map(l)]),
        ...Object.entries(porLista).flatMap(([lista, ss]) => [`Opções de “${lista}” (escolhidas dentro da raça):`, ...ss.map(l)]),
        r.poderesDeRaca.length ? "Poderes de raça (poderes gerais exclusivos; custam uma escolha de poder):" : "", ...r.poderesDeRaca.map(l)].filter(Boolean).join("\n");
    }
    if (tipo === "classe") {
      const c = acha(B.classes, nome);
      if (!c) return nomes(B.classes);
      const variantes = B.classes.filter((v) => norm(v.varianteDe) === norm(c.nome)).map((v) => v.nome);
      const lista = c.poderes.length ? c.poderes : c.poderesDaBase || [];
      return [`# Classe ${c.nome} (${c.livro})${c.varianteDe ? ` — variante de ${c.varianteDe}: troca habilidades, usa a lista de poderes de ${c.varianteDe}` : ""}`,
        c.pvPorNivel != null && `${c.pvPorNivel} PV e ${c.pmPorNivel} PM por nível.`, variantes.length && `Variantes: ${variantes.join(", ")}.`,
        "Habilidades de classe (automáticas, por nível):", ...c.habilidades.map((h) => `- ${ordinal(h.nivel)}: ${h.nome}${h.poder ? ` [d:${h.poder}]` : ""}`),
        c.habilidadesSoltas?.length ? "Outras habilidades e opções internas da classe:" : "", ...(c.habilidadesSoltas || []).map(l),
        `Poderes de ${c.varianteDe || c.nome} (um por nível a partir do 2º, à escolha; ${lista.length} na lista):`, ...lista.map(l)].filter(Boolean).join("\n");
    }
    if (tipo === "divindade") {
      const d = acha(B.divindades, nome);
      if (!d) return nomes(B.divindades);
      const dev = d.devotos === "qualquer um" ? "qualquer personagem" : d.devotos ? `raças: ${d.devotos.racas.join(", ") || "—"}; classes: ${d.devotos.classes.join(", ") || "—"} (humanos, clérigos e frades servem a qualquer deus)` : "veja `livros`";
      return [`# ${d.nome}${d.maior ? " (deus maior)" : " (deus menor)"}`, `Devotos aceitos: ${dev}`, "Poderes concedidos (só devotos):", ...d.poderes.map(l), "Obrigações e restrições, símbolo e arma preferida: consulte `livros`."].join("\n");
    }
    if (tipo === "origem") {
      const o = acha(B.origens, nome);
      if (!o) return nomes(B.origens);
      return [`# Origem ${o.nome}${o.livro ? ` (${o.livro})` : ""}`, o.itens?.length && "Itens: " + o.itens.join(", "), o.pericias?.length && "Perícias à escolha: " + o.pericias.join(", "),
        o.poderesAEscolha?.length ? "Poderes à escolha (no Livro Básico: dois benefícios entre perícias e poderes):" : "", ...(o.poderesAEscolha || []).map(l), o.poderes.length ? "Benefício/poder exclusivo da origem:" : "", ...o.poderes.map(l)].filter(Boolean).join("\n");
    }
    if (tipo === "distincao") {
      const d = acha(B.distincoes, nome);
      if (!d) return nomes(B.distincoes);
      return [`# Distinção ${d.nome} (${d.livro})`, "Exige admissão conquistada em jogo; os poderes são escolhidos como poderes gerais, do 5º nível em diante. A admissão está descrita no livro (`livros`).", "Poderes:", ...d.poderes.map(l)].join("\n");
    }
    return "Tipo de ficha desconhecido.";
  },

  async livros({ consulta, livro }) {
    const trechos = (ferramentasArauto.livros.trechos ??= lerJson(join(DADOS, "vetores", "livros-trechos.json"), []));
    if (!trechos.length) return "Os trechos dos livros não estão carregados neste servidor.";
    const lv = livro ? norm(livro) : "", doLivro = (i) => !lv || norm(trechos[i].l).includes(lv);
    const v = await vetores.embutir(String(consulta || ""), 6000);
    let achados = v ? vetores.vizinhos("livros", v, 40, 0.4).filter(([i]) => doLivro(i)).slice(0, 7) : [];
    if (!achados.length) { // sem o modelo de sentido: conta palavras da consulta em cada trecho
      const ws = norm(consulta).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !DE_FRASE.has(w));
      achados = trechos.map((t, i) => [i, doLivro(i) ? ws.filter((w) => norm(t.t).includes(w)).length : 0]).filter((x) => x[1] >= Math.min(2, ws.length) && x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
    }
    return achados.length ? achados.map(([i]) => `[${trechos[i].l}, p. ${trechos[i].p}]\n${trechos[i].t.replace(/\s+/g, " ").slice(0, 1300)}`).join("\n\n") : "Nenhum trecho dos livros parecido com isso.";
  },
};
// no self-test o Arauto não lê a configuração de verdade (não fala com a API nem gasta a cota de ninguém)
const arauto = criarArauto({ dados: DADOS, ferramentas: ferramentasArauto, temas: TEMA_IDS, colecoes: COLECOES_ARAUTO, lerJson: CHECK ? (a, p) => p : lerJson, gravarJson, silencioso: CHECK });

// ---- ranking de aprimoramentos oficiais contra a magia do usuário ----
const semAcento = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s) => new Set(semAcento(s).split(/[^a-z0-9d]+/).filter((t) => t.length > 3));
function pontuarApr(f, a) {
  const m = a.magia;
  let s = 0;
  const tem = (t) => a.deltas.includes(t);
  if (f.dano && tem("dano+")) { s += 3; if (m.dano_dados?.includes("d" + f.dano.faces)) s += 2; }
  if (f.cura && tem("cura+")) s += 4;
  if (f.alvoTipo === "alvos" && tem("alvos+")) s += 2;
  if (f.alvoTipo === "area" && tem("area->")) s += 2;
  if (f.alvoTipo === "alvos" && (f.dano || f.condicoes?.length) && tem("area->")) s += 1;
  if (f.alvoRestrito && /muda o alvo para/.test(semAcento(a.texto))) s += 3;
  if (tem("alcance->") && m.alcance === f.alcance) s += 3;
  if (tem("duracao->") && (f.duracao === "cena" || f.duracao === "1dia")) s += 1;
  if (tem("resistencia->") && f.resistencia && f.resistencia !== "nenhuma") s += 2;
  if (f.condicoes?.length && m.condicoes?.some((c) => f.condicoes.includes(c))) s += 3;
  if (f.escola === m.escola) s += 1;
  if (m.circulo === (f.circulo || 1)) s += 2;
  const tu = tokens(f.texto || "");
  const ta = tokens(a.texto + " " + m.nome);
  let overlap = 0;
  for (const t of tu) if (ta.has(t)) overlap += 0.5;
  s += Math.min(overlap, 3);
  return s;
}
function sugerirAprimoramentos(f, aprs) {
  const vistos = new Map();
  for (const a of aprs) {
    if (a.pm == null && !a.truque) continue;
    if (a.restrito) continue;
    const s = pontuarApr(f, a);
    if (s <= 2) continue;
    const chave = semAcento(a.texto).slice(0, 80);
    const v = vistos.get(chave);
    if (v) { v.n++; if (s > v.score) { v.score = s; v.pm = a.pm; v.fonte = a.magia.nome; } }
    else vistos.set(chave, { score: s, n: 1, pm: a.pm, truque: a.truque, texto: a.texto, fonte: a.magia.nome, circuloFonte: a.magia.circulo });
  }
  const lista = [...vistos.values()].sort((x, y) => y.score - x.score);
  const truques = lista.filter((x) => x.truque).slice(0, 2);
  const normais = lista.filter((x) => !x.truque).slice(0, 10);
  return [...normais, ...truques].map(({ score, ...resto }) => resto);
}

// ---------------------------------------------------------------- CLI: --usuario Nome senha [papel] [personagem]
const iRen = process.argv.indexOf("--renomear"); // node server.mjs --renomear "Nome atual" "Nome novo" ["Personagem"]
if (iRen > 0) {
  const [atual, novo, personagem] = process.argv.slice(iRen + 1);
  const r = renomearConta(normNome(atual), { novoNome: novo, personagem });
  if (typeof r === "string") { console.error(r); process.exit(1); }
  console.log(`conta "${atual}" agora é "${usuarios[r.chave].nome}"${usuarios[r.chave].personagem ? " (" + usuarios[r.chave].personagem + ")" : ""}`);
  process.exit(0);
}
const iUsu = process.argv.indexOf("--usuario");
if (iUsu > 0) {
  const [nome, senha, papel, personagem] = process.argv.slice(iUsu + 1);
  if (!nomeOk(nome || "") || !senha) { console.error('uso: node server.mjs --usuario "Nome" senha [jogador|mestre] ["Personagem"]'); process.exit(1); }
  const u = definirUsuario({ nome, senha, papel, personagem });
  console.log(`conta "${u.nome}" (${u.papel}${u.personagem ? ", " + u.personagem : ""}) gravada em ${ARQ_USU}`);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  tratar(req, res).catch((e) => { console.error(e); json(res, 500, { erro: "interno" }); });
});

if (CHECK) {
  server.listen(0, async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const falha = (msg) => { console.error("FALHOU:", msg); server.close(); process.exitCode = 1; };
    try {
      const mesclado = normalizarEstado({ usuarios: { Amanda: [{ id: "1" }], amanda: [{ id: "2" }, { id: "1" }] } });
      if (Object.keys(mesclado.usuarios).length !== 1 || mesclado.usuarios.amanda.length !== 2) return falha("normalizarEstado não mesclou: " + JSON.stringify(mesclado));
      definirUsuario({ nome: "Ray", senha: "1234", papel: "mestre", personagem: "" });
      definirUsuario({ nome: "Amanda", senha: "abcd", papel: "jogador", personagem: "Lydia Alnari" });
      // coleção falsa injetada no cache (o self-test não lê dados/)
      colecoes.cache.teste = { meta: { titulo: "Teste", filtros: [{ k: "nd", rotulo: "ND" }], ordem: { nd: ["1", "2"] } },
        itens: [{ id: "lobo", nome: "Lobo", linha: "Animal · ND 1", grupo: "x", f: { nd: "1" }, t: "lobo animal nd 1 mordida", html: "<b>PV</b> 10" },
          { id: "urso", nome: "Urso", linha: "Animal · ND 2", grupo: "x", f: { nd: "2" }, t: "urso animal nd 2 garra", html: "<b>PV</b> 30" }] };
      colecoes.cache.teste.porId = new Map(colecoes.cache.teste.itens.map((i) => [i.id, i]));
      colecoes.cache.ameacas = { meta: { titulo: "Bestiário", filtros: [], ordem: {} }, itens: [{ id: "lobo-cinzento", nome: "Lobo Cinzento", linha: "Animal Médio · ND 1", grupo: "x", f: {}, t: "lobo",
        html: "", dados: normalizarAmeaca({ nome: "Lobo Cinzento", nd: "1", tipo: "Animal", defesa: 15, pv: 20, atributos: { des: 2 },
          ataques: [{ nome: "Mordida", bonus: 9, dados: "1d6", bonusDano: 4, tipoDano: "perfuração" }], habilidades: [{ nome: "Faro", desc: "fareja quem não vê em alcance curto" }] }) }] };
      colecoes.cache.ameacas.porId = new Map(colecoes.cache.ameacas.itens.map((i) => [i.id, i]));
      carregarRegrasAmeacas.cache = { tabela: { solo: { "1": { atq: 1, dano: 2, defesa: 3, forte: 4, media: 5, fraca: 6, pv: 77, cd: 8 } } } }; // números inventados

      // sem sessão: API 401, página vira tela de login (com o destino guardado)
      if ((await fetch(`${base}/api/state`)).status !== 401) return falha("sem login devia dar 401");
      const semLogin = await fetch(`${base}/bestiario`);
      if (semLogin.status !== 200 || !(await semLogin.text()).includes('window.VOLTAR="/bestiario"')) return falha("página sem login devia virar login com VOLTAR");
      const errada = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "ray", senha: "nope" }) });
      if (errada.status !== 401) return falha("senha errada devia dar 401");
      const login = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "RAY", senha: "1234" }) });
      if (login.status !== 200) return falha("login: " + login.status);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const H = { cookie }, HJ = { cookie, "content-type": "application/json" };
      const eu = await (await fetch(`${base}/api/eu`, { headers: H })).json();
      if (eu.nome !== "Ray" || !eu.mestre) return falha("eu: " + JSON.stringify(eu));
      const cookieFalso = cookie.replace(/.$/, (c) => c === "a" ? "b" : "a");
      if ((await fetch(`${base}/api/eu`, { headers: { cookie: cookieFalso } })).status !== 401) return falha("cookie adulterado devia dar 401");

      // grimório: dono = sessão, não o nome do caminho
      const magia = { nome: "Teste", circulo: 1,
        eixos: { execucao: "padrao", alcance: "curto", duracao: "instantanea", resistencia: "reduz-metade", alvo: { tipo: "alvos", qtd: 1 } },
        efeitos: { dano: { n: 2, faces: 6 } } };
      const put = await fetch(`${base}/api/user/qualquer`, { method: "PUT", headers: HJ, body: JSON.stringify({ magias: [magia] }) });
      if (put.status !== 200) return falha("PUT " + put.status);
      const st = await (await fetch(`${base}/api/state?user=outro`, { headers: H })).json();
      if (st.minhas.length !== 1 || st.minhas[0].pontos.gasto !== 7) return falha("state: " + JSON.stringify(st.minhas[0]?.pontos));
      const pub = await (await fetch(`${base}/api/publicar`, { method: "POST", headers: HJ, body: JSON.stringify({ autor: "ladrao", magia }) })).json();
      if (!pub.ok || !pub.id) return falha("publicar: " + JSON.stringify(pub));
      if (estado.publicadas[pub.id].autor !== "Ray") return falha("autor devia ser o da sessão");
      const m = await (await fetch(`${base}/api/magia/${pub.id}`, { headers: H })).json();
      if (m.nome !== "Teste") return falha("magia publicada errada");
      const ruim = await fetch(`${base}/api/user/x`, { method: "PUT", headers: HJ, body: JSON.stringify({ magias: [{ nome: "x", circulo: 7 }] }) });
      if (ruim.status !== 400) return falha("devia recusar círculo 7");
      const gri = await (await fetch(`${base}/api/grimorio`, { headers: H })).json();
      if (gri.publicadas.find((x) => x.id === pub.id)?.pocao !== "poção") return falha("grimório não marcou a poção");
      // outra conta não despublica; o mestre despublica qualquer uma
      const loginA = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "abcd" }) });
      const cA = loginA.headers.get("set-cookie").split(";")[0];
      const HA = { cookie: cA, "content-type": "application/json" };
      if ((await fetch(`${base}/api/despublicar`, { method: "POST", headers: HA, body: JSON.stringify({ id: pub.id }) })).status !== 403) return falha("Amanda não podia despublicar a do Ray");
      if ((await fetch(`${base}/api/usuarios`, { headers: HA })).status !== 403) return falha("jogador não vê contas");
      if ((await fetch(`${base}/api/despublicar`, { method: "POST", headers: HJ, body: JSON.stringify({ id: pub.id }) })).status !== 200) return falha("mestre devia despublicar");
      const idx = await fetch(`${base}/m/${pub.id}`, { headers: H });
      if (idx.status !== 404) return falha("/m/ de despublicada devia dar 404");
      if ((await fetch(`${base}/`, { headers: H })).status !== 200 || (await fetch(`${base}/criar`, { headers: H })).status !== 200) return falha("/ ou /criar fora");

      // coleções: busca com sinônimo, filtros vêm da meta, ficha completa
      const lista = await (await fetch(`${base}/api/c/teste?q=garra`, { headers: H })).json();
      if (lista.itens.length !== 1 || lista.itens[0].id !== "urso" || lista.itens[0].html) return falha("busca da coleção: " + JSON.stringify(lista));
      if (lista.meta.ordem.nd[1] !== "2") return falha("meta da coleção não veio");
      const digitado = await (await fetch(`${base}/api/c/teste?q=mordda`, { headers: H })).json(); // "mordida" com letra faltando
      if (digitado.itens.length !== 1 || digitado.itens[0].id !== "lobo") return falha("parecido por digitação: " + JSON.stringify(digitado.itens));
      const ou = await (await fetch(`${base}/api/c/teste?q=lobo urso`, { headers: H })).json(); // ninguém tem as duas → qualquer uma serve
      if (ou.itens.length !== 2) return falha("busca sem resultado devia cair pra qualquer palavra");
      const ani = await (await fetch(`${base}/api/c/teste?q=lobo`, { headers: H })).json();
      if (ani.itens[0]?.rel !== 6 + 3) return falha("nome igual à consulta devia pontuar 9, veio " + ani.itens[0]?.rel);
      const lit = termosBusca('lobo "ND 1/4" "+2 na Defesa', vocabDe({}, () => ["lobo"]));
      if (lit.map((a) => a[0]).join("|") !== '"nd 1/4"|"+2 na defesa"|lobo' || lit[0].length !== 1) return falha("aspas: " + JSON.stringify(lit));
      if (!tem("animal · nd 1/4 · livro", lit[0][0]) || tem("nd 11/40", '"1/4"') || tem("nd 1/40", '"1/4"') || !tem("recebe +2 na defesa.", lit[1][0])) return falha("tem() com trecho cru");
      const tb = termosBusca("fogo relampgo", vocabDe({}, () => ["relampago chama"]));
      if (tb[0].fortes < 3 || tb[1].fortes !== 2 || tb[1][2] !== "relampago") return falha("termosBusca: " + JSON.stringify(tb));
      if (relevancia(["Relâmpago", "evocação fogo", "raio"], tb, "fogo relampgo") !== 2 + 1.5) return falha("relevância fraca devia valer metade");
      if (distancia("relampago", "relampgo", 2) !== 1 || distancia("urso", "gato", 1) !== 2) return falha("distancia()");
      const voc = vocabDe({}, () => ["treinado treinado treinado treinado treinado treinado em luta", "trincado", "espada longa"]);
      if (termosBusca("trinado", voc)[0].join() !== "trinado,trinad,treinado") return falha("correção devia preferir a palavra comum: " + termosBusca("trinado", voc)[0]);
      if (termosBusca("espadalonga", voc).map((a) => a[0]).join() !== "espada,longa") return falha("palavra grudada devia separar");
      if (termosBusca("pré-requisito: luta", voc).map((a) => a[0]).join() !== "pre,requisito,luta") return falha("pontuação/hífen da consulta");
      if (!termosBusca("magias", voc)[0].includes("magia") || !termosBusca("dragoes", voc)[0].includes("draga")) return falha("raiz(): " + termosBusca("dragoes", voc)[0]);
      if (tem("forma primal", "for") || !tem("for 1, sab 2", "for") || !tem("+2 na defesa", "+2")) return falha("palavra curta só casa inteira");
      if (relevancia(["Encouraçado", "", ""], termosBusca("encoracado", voc), "encoracado") < 4) return falha("nome quase igual devia pontuar");
      // poderes v2 (base inventada: o self-test não lê dados/): como se obtém, tema na busca, frase de pergunta, link antigo
      carregarPoderes.cache = {
        atletico: { nome: "Atlético", categoria: "Destino", acesso: "geral", donos: [], tags: ["deslocamento", "pericia"], livro: "Livro Básico", pagina: 130, linha: "Poder de destino · Livro Básico", prereq: "For 2", pre: { poderes: [] }, custo: "", descricao: "Texto de teste: ganha +3m de passo.", resumo: "Resumo de teste: corre mais.", libera: ["maratonista"] },
        maratonista: { nome: "Maratonista", categoria: "Destino", acesso: "geral", donos: [], tags: ["pericia"], livro: "Livro Básico", linha: "Poder de destino · Livro Básico", prereq: "Atlético", pre: { poderes: ["Atlético"] }, custo: "", descricao: "Texto de teste: aguenta a estrada." },
        graca: { nome: "Graça", categoria: "Racial", acesso: "raca", donos: ["Elfo"], racas: ["Elfo"], tags: ["deslocamento"], livro: "Livro Básico", linha: "Habilidade de raça · Elfo · Livro Básico", prereq: "", custo: "", descricao: "Texto de teste: passo leve de +6m, e ainda +2m no 5º nível." },
        "ataque-especial": { nome: "Ataque Especial", categoria: "Habilidade", acesso: "classe-habilidade", donos: ["Guerreiro"], niveis: { Guerreiro: [1, 5] }, tags: ["dano"], livro: "Livro Básico", linha: "Habilidade de classe · Guerreiro · Livro Básico", prereq: "", custo: "1 PM", descricao: "Texto de teste: golpe da classe." },
      };
      carregarPoderes.porNome = null;
      carregarBase.cache = { racas: [{ nome: "Elfo", livro: "Livro Básico", habilidades: ["graca"], opcoes: [], poderesDeRaca: [], ficha: { atributos: "Int +2", deslocamento: "12m", tamanho: "Médio", tipo: "humanoide", sentidos: "penumbra", escolhas: "nenhuma", tags: ["deslocamento"], resumo: "Ágil." } }],
        classes: [{ nome: "Guerreiro", livro: "Livro Básico", varianteDe: "", habilidades: [{ nivel: 1, poder: "ataque-especial", nome: "Ataque Especial" }], poderes: [], habilidadesSoltas: [] }, { nome: "Inovador", varianteDe: "Guerreiro", habilidades: [], poderes: [], poderesDaBase: [] }],
        divindades: [], origens: [], distincoes: [], aliases: { "atletico-velho": "atletico" }, magias: {} };
      const pv = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent("poderes que me deixem mais veloz")}`, { headers: H })).json();
      if (pv.poderes.map((x) => x.slug).sort().join() !== "atletico,graca" || pv.variantes.Inovador !== "Guerreiro") return falha("frase de pergunta + tema: " + JSON.stringify(pv.poderes.map((x) => x.slug)));
      if (pv.poderes.find((x) => x.slug === "graca").acesso !== "raca" || pv.poderes.find((x) => x.slug === "atletico").r !== "Resumo de teste: corre mais.") return falha("item da lista de poderes: " + JSON.stringify(pv.poderes[0]));
      const soPre = await (await fetch(`${base}/api/poderes?q=atletico&em=pre`, { headers: H })).json();
      if (soPre.poderes.map((x) => x.slug).join() !== "maratonista") return falha("busca só no pré-requisito: " + JSON.stringify(soPre.poderes.map((x) => x.slug)));
      const parc = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent("golpe estrada")}`, { headers: H })).json(); // ninguém tem as duas palavras
      if (parc.poderes.map((x) => x.slug).sort().join() !== "ataque-especial,maratonista") return falha("sem ninguém com todas as palavras, vale quem tem parte: " + JSON.stringify(parc.poderes.map((x) => x.slug)));
      // trecho com variável: # = qualquer número. Vem o trecho que casou (texto original) e o MAIOR número do item
      const pt = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent('"+#m"')}`, { headers: H })).json();
      const porSlug = Object.fromEntries(pt.poderes.map((x) => [x.slug, x]));
      if (pt.poderes.length !== 2 || porSlug.atletico?.num !== 3 || porSlug.graca?.num !== 6) return falha("trecho com #: " + JSON.stringify(pt.poderes.map((x) => [x.slug, x.num])));
      if (JSON.stringify(porSlug.atletico.trecho) !== JSON.stringify(["Texto de teste: ganha ", "+3m", " de passo."])) return falha("trecho destacado: " + JSON.stringify(porSlug.atletico.trecho));
      const semAspas = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent("+#m passo")}`, { headers: H })).json(); // palavra com # vira trecho sem precisar de aspas
      if (semAspas.poderes.map((x) => x.slug).sort().join() !== "atletico,graca" || semAspas.poderes[0].num == null) return falha("# fora das aspas: " + JSON.stringify(semAspas.poderes.map((x) => x.slug)));
      const obrig = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent('"+#m" golpe')}`, { headers: H })).json(); // "golpe" só existe em quem não tem +Nm
      if (obrig.poderes.some((x) => x.slug === "ataque-especial") || obrig.poderes.length !== 2) return falha("trecho é obrigatório: quem só tem a outra palavra não entra: " + JSON.stringify(obrig.poderes.map((x) => x.slug)));
      const soltos = termosBusca("db #219 nd # +#m", vocabDe({}, () => ["db nd"])).map((a) => a[0]);
      if (soltos.join("|") !== '"+#m"|db|219|nd') return falha("# colado em número ou sozinho não vira trecho: " + JSON.stringify(soltos));
      const pal = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent('"+#m % passo"')}`, { headers: H })).json(); // % = uma a quatro palavras
      if (pal.poderes.map((x) => x.slug).join() !== "atletico") return falha("trecho com %: " + JSON.stringify(pal.poderes.map((x) => x.slug)));
      // o trecho é procurado no texto que a pessoa lê, não nos temas: "deslocamento" é só TEMA de atletico e graca (o texto diz "passo")
      const soTema = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent('"deslocamento"')}`, { headers: H })).json();
      if (soTema.poderes.length) return falha("trecho entre aspas não pode casar com tema escondido: " + JSON.stringify(soTema.poderes.map((x) => x.slug)));
      const naLinha = await (await fetch(`${base}/api/poderes?q=${encodeURIComponent('"habilidade de classe"')}`, { headers: H })).json();
      if (naLinha.poderes.map((x) => x.slug).join() !== "ataque-especial" || naLinha.poderes[0].trecho?.[1] !== "Habilidade de classe") return falha("trecho na linha do tipo: " + JSON.stringify(naLinha.poderes));
      const preNum = await (await fetch(`${base}/api/poderes?em=pre&q=${encodeURIComponent('"for #"')}`, { headers: H })).json();
      if (preNum.poderes.map((x) => x.slug).join() !== "atletico" || preNum.poderes[0].num !== 2 || preNum.poderes[0].trecho?.[1] !== "For 2") return falha("trecho na busca só de pré-requisito: " + JSON.stringify(preNum.poderes));
      if (semHtml("<table><tr><td>Salada</td><td>+1,5m</td></tr></table>").includes("Salada+")) return falha("células de tabela coladas");
      const fn = await ferramentasArauto.buscar({ onde: "poderes", consulta: '"+#m"' });
      if (!(fn.indexOf("d:graca") < fn.indexOf("d:atletico")) || !fn.includes("trecho: “")) return falha("Arauto: maior número primeiro, com o trecho: " + fn);
      const pd = await (await fetch(`${base}/api/poder/atletico-velho`, { headers: H })).json();
      if (pd.slug !== "atletico" || pd.libera[0]?.nome !== "Maratonista" || !pd.comoObter.includes("qualquer personagem")) return falha("ficha do poder (link antigo, libera, como obter): " + JSON.stringify(pd).slice(0, 300));
      if ((await (await fetch(`${base}/api/poder/maratonista`, { headers: H })).json()).exige[0]?.slug !== "atletico") return falha("poder devia apontar o pré-requisito");
      if (!comoObter(carregarPoderes.cache.graca).includes("todo Elfo recebe") || !comoObter(carregarPoderes.cache["ataque-especial"]).includes("Guerreiro no 1º e 5º nível")) return falha("comoObter: " + comoObter(carregarPoderes.cache["ataque-especial"]));
      if (termosBusca("o que tem de fogo", vocabDe({}, () => ["fogo"])).length !== 1) return falha("palavras de pergunta deviam sair da frase");
      // ferramentas do Arauto sobre a mesma base
      const fb = await ferramentasArauto.buscar({ onde: "poderes", tema: "deslocamento", acesso: "raca" });
      if (!fb.includes("d:graca") || fb.includes("d:atletico")) return falha("buscar por tema + acesso: " + fb);
      const fd = await ferramentasArauto.buscar({ onde: "poderes", consulta: "veloz", dono: "elfo" });
      if (!fd.includes("d:graca") || fd.includes("d:atletico")) return falha("buscar por dono: " + fd);
      const ff = await ferramentasArauto.ficha({ tipo: "raca", nome: "elfo" });
      if (!ff.includes("Deslocamento: 12m") || !ff.includes("[d:graca]")) return falha("ficha de raça: " + ff);
      const fc = await ferramentasArauto.ficha({ tipo: "classe", nome: "inovador" });
      if (!fc.includes("variante de Guerreiro")) return falha("ficha de classe variante: " + fc);
      const fv = await ferramentasArauto.ver({ ids: ["d:atletico", "x:1"] });
      if (!fv.includes("Como se obtém: Poder geral de destino") || !fv.includes("É pré-requisito de: Maratonista [d:maratonista]") || !fv.includes("x:1: id desconhecido")) return falha("ver: " + fv);
      if (!(await ferramentasArauto.ficha({ tipo: "raca", nome: "zzz" })).includes("Existem: Elfo")) return falha("ficha de nome errado devia listar as opções");
      // rotas do Arauto: o bot sem token não passa; sem chave configurada o site avisa (o self-test não fala com a API)
      if ((await fetch(`${base}/api/arauto/bot`, { method: "POST", body: "{}" })).status !== 401) return falha("bot sem token devia dar 401");
      if ((await fetch(`${base}/api/arauto`, { method: "POST", body: "{}" })).status !== 401) return falha("Arauto do site sem login devia dar 401");
      const fluxo = await (await fetch(`${base}/api/arauto`, { method: "POST", headers: HJ, body: JSON.stringify({ pergunta: "como ficar veloz?" }) })).text();
      if (!fluxo.includes("event: status") || !fluxo.includes("event: fim") || !fluxo.includes("sem-chave")) return falha("fluxo do Arauto: " + fluxo.slice(0, 300));
      const urso = await (await fetch(`${base}/api/c/teste/urso`, { headers: H })).json();
      if (urso.html !== "<b>PV</b> 30") return falha("ficha da coleção");
      if ((await fetch(`${base}/api/c/naoexiste`, { headers: H })).status !== 404) return falha("coleção inexistente devia dar 404");
      const tudo = await (await fetch(`${base}/api/busca?q=garra`, { headers: H })).json();
      if (tudo.grupos.find((g) => g.col === "teste")?.itens[0]?.href !== "/c/teste/urso") return falha("busca em tudo: " + JSON.stringify(tudo).slice(0, 300));
      const at = await (await fetch(`${base}/api/atalhos`, { method: "POST", headers: HJ, body: JSON.stringify({ atalhos: ["/poderes", "/poderes", "javascript:alert(1)", "//fora.com", "/compendio?aba=classes"] }) })).json();
      if (JSON.stringify(at.atalhos) !== '["/poderes","/compendio?aba=classes"]') return falha("atalhos: " + JSON.stringify(at));
      if ((await (await fetch(`${base}/api/eu`, { headers: HJ })).json()).atalhos?.length !== 2) return falha("atalhos não voltam no /api/eu");
      const paginaC = await fetch(`${base}/c/teste/urso`, { headers: H });
      if (paginaC.status !== 200 || !(await paginaC.text()).includes('og:title" content="Urso"')) return falha("/c/ sem Open Graph");

      // missões: mestre grava o quadro, jogadora vota como o personagem, concluir apaga votos
      const quadro = await fetch(`${base}/api/missoes`, { method: "PUT", headers: HJ, body: JSON.stringify({ missoes: [{ titulo: "Caçar o lobo", perigo: 9 }, { id: "x-1", titulo: "Escolta" }] }) });
      if (quadro.status !== 200) return falha("PUT missões: " + (await quadro.json()).erro);
      if (missoes.missoes[0].perigo !== 5 || missoes.missoes[0].id !== "cacar-o-lobo") return falha("missão normalizada errada: " + JSON.stringify(missoes.missoes[0]));
      if ((await fetch(`${base}/api/missoes`, { method: "PUT", headers: HA, body: JSON.stringify({ missoes: [] }) })).status !== 403) return falha("jogadora não edita o quadro");
      const voto = await (await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).json();
      if (!voto.votos["cacar-o-lobo"]?.["Lydia Alnari"]) return falha("voto devia ser do personagem: " + JSON.stringify(voto.votos));
      if ((await fetch(`${base}/api/missoes/concluir`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).status !== 403) return falha("jogadora não conclui");
      const conc = await (await fetch(`${base}/api/missoes/concluir`, { method: "POST", headers: HJ, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).json();
      if (!conc.missoes[0].concluida || conc.votos["cacar-o-lobo"]) return falha("concluir devia apagar votos");
      if ((await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).status !== 400) return falha("não vota em cumprida");

      // agenda: só os próprios dias (mestre pode pelos outros), validação igual à do data-rpg
      const dias = { days: { "2026-10-03": "yes", "2026-10-04": "no" }, updatedAt: 5 };
      if ((await fetch(`${base}/api/agenda/user/Ray`, { method: "PUT", headers: HA, body: JSON.stringify(dias) })).status !== 403) return falha("Amanda não grava os dias do Ray");
      if ((await fetch(`${base}/api/agenda/user/amanda`, { method: "PUT", headers: HA, body: JSON.stringify(dias) })).status !== 200) return falha("Amanda devia gravar os próprios dias");
      if ((await fetch(`${base}/api/agenda/user/Amanda`, { method: "PUT", headers: HA, body: JSON.stringify({ days: { x: "yes" } }) })).status !== 400) return falha("data inválida → 400");
      const ags = await (await fetch(`${base}/api/agenda/state`, { headers: H })).json();
      if (ags.users.Amanda?.days["2026-10-03"] !== "yes" || ags.mestre !== "Ray" || ags.nomes.length !== 2) return falha("agenda state: " + JSON.stringify(ags));

      // contas: mestre cria, jogadora troca a própria senha, senha antiga para de valer
      const nova = await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Davi", senha: "davi1", personagem: "Behrtio" }) });
      if (nova.status !== 200 || usuarios.davi?.personagem !== "Behrtio") return falha("criar conta");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Novo" }) })).status !== 400) return falha("conta nova sem senha devia falhar");
      if ((await fetch(`${base}/api/senha`, { method: "POST", headers: HA, body: JSON.stringify({ atual: "errada", nova: "zzzz" }) })).status !== 403) return falha("senha atual errada");
      if ((await fetch(`${base}/api/senha`, { method: "POST", headers: HA, body: JSON.stringify({ atual: "abcd", nova: "nova1" }) })).status !== 200) return falha("trocar senha");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "abcd" }) })).status !== 401) return falha("senha antiga ainda vale");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "nova1" }) })).status !== 200) return falha("senha nova não vale");
      // renomear: personagem muda o votante; nome muda a chave, a agenda, o autor das publicadas e o cookie
      const HA2 = { cookie: (await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "nova1" }) })).headers.get("set-cookie").split(";")[0], "content-type": "application/json" };
      await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA2, body: JSON.stringify({ id: "x-1", ligar: true }) });
      const ren = await fetch(`${base}/api/conta`, { method: "POST", headers: HA2, body: JSON.stringify({ nome: "Amanda Silva", personagem: "Lydia" }) });
      if (ren.status !== 200) return falha("renomear: " + (await ren.json()).erro);
      if (!usuarios["amanda silva"] || usuarios.amanda) return falha("chave não mudou");
      if (!missoes.votos["x-1"]?.Lydia || missoes.votos["x-1"]["Lydia Alnari"]) return falha("voto não seguiu o personagem: " + JSON.stringify(missoes.votos));
      if (!agenda.users["Amanda Silva"] || agenda.users.Amanda) return falha("agenda não seguiu o nome");
      if ((await fetch(`${base}/api/eu`, { headers: { cookie: HA2.cookie } })).status !== 401) return falha("cookie antigo devia morrer");
      const cookieNovo = ren.headers.get("set-cookie").split(";")[0];
      if ((await (await fetch(`${base}/api/eu`, { headers: { cookie: cookieNovo } })).json()).nome !== "Amanda Silva") return falha("cookie novo não veio");
      if ((await fetch(`${base}/api/conta`, { method: "POST", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ nome: "Davi" }) })).status !== 400) return falha("não podia tomar o nome do Davi");
      // mestre renomeia a si mesmo mantendo as publicadas e o papel
      await fetch(`${base}/api/publicar`, { method: "POST", headers: HJ, body: JSON.stringify({ magia }) });
      const renRay = await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Ray", novoNome: "RayNathus", papel: "mestre" }) });
      if (renRay.status !== 200 || !usuarios.raynathus || usuarios.raynathus.papel !== "mestre") return falha("mestre renomeado errado");
      if (!Object.values(estado.publicadas).every((m) => m.autor === "RayNathus")) return falha("autor das publicadas não seguiu");
      const HR = { cookie: renRay.headers.get("set-cookie").split(";")[0], "content-type": "application/json" };
      if ((await (await fetch(`${base}/api/eu`, { headers: HR })).json()).nome !== "RayNathus") return falha("cookie do mestre renomeado");
      // apelido: login aceita nome ou apelido; apelido não pode ser nome/apelido de outro
      if ((await fetch(`${base}/api/conta`, { method: "POST", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ apelido: "Manduuu" }) })).status !== 200) return falha("definir apelido");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "manduuu", senha: "nova1" }) })).status !== 200) return falha("login pelo apelido");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HR, body: JSON.stringify({ nome: "Davi", apelido: "manduuu" }) })).status !== 400) return falha("apelido repetido devia falhar");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HR, body: JSON.stringify({ nome: "Manduuu", senha: "1234" }) })).status !== 400) return falha("conta nova com nome igual a apelido devia falhar");
      // criador de ficha: personagens por conta (o "jogador" do site é ignorado), lista/ler/apagar
      const HP = { cookie: cookieNovo, "content-type": "application/json" };
      const putP = await fetch(`${base}/api/criador/personagens/abcd1234?jogador=outro`, { method: "PUT", headers: HP, body: JSON.stringify({ jogador: "outro", nome: "Zé", resumo: "humano guerreiro", estado: { nome: "Zé" }, passo: "raca" }) });
      if (putP.status !== 200) return falha("PUT personagem: " + putP.status);
      const lista2 = await (await fetch(`${base}/api/criador/personagens?jogador=x`, { headers: HP })).json();
      if (lista2.length !== 1 || lista2[0].id !== "abcd1234" || lista2[0].temFicha) return falha("lista de personagens: " + JSON.stringify(lista2));
      if ((await (await fetch(`${base}/api/criador/personagens`, { headers: HR })).json()).length !== 0) return falha("personagem vazou pra outra conta");
      const um = await (await fetch(`${base}/api/criador/personagens/abcd1234`, { headers: HP })).json();
      if (um.estado !== JSON.stringify({ nome: "Zé" }) || um.jogador !== "Amanda Silva") return falha("ler personagem: " + JSON.stringify(um));
      if ((await fetch(`${base}/api/criador/personagens/abcd1234`, { method: "DELETE", headers: HP })).status !== 200) return falha("apagar personagem");
      if ((await fetch(`${base}/api/criador/personagens/abcd1234`, { headers: HP })).status !== 404) return falha("personagem devia sumir");
      if ((await fetch(`${base}/ficha`, { headers: HP, redirect: "manual" })).status !== 302) return falha("/ficha devia redirecionar pra /ficha/");
      // criador de ameaças: regras, biblioteca, CRUD por conta, download Foundry do bestiário
      if ((await (await fetch(`${base}/api/criador/ameacas-regras`, { headers: HP })).json()).tabela?.solo?.["1"]?.pv !== 77) return falha("regras de ameaças");
      const bib = await (await fetch(`${base}/api/criador/ameacas-habilidades?q=faro`, { headers: HP })).json();
      if (bib.length !== 1 || bib[0].nome !== "Faro" || bib[0].n !== 1 || !bib[0].de.includes("Lobo Cinzento")) return falha("biblioteca de habilidades: " + JSON.stringify(bib));
      const par = await (await fetch(`${base}/api/criador/ameacas-parecidas?tipo=Animal&tamanho=M%C3%A9dio&nd=2`, { headers: HP })).json();
      if (par[0]?.nome !== "Lobo Cinzento" || par[0].atributos?.des !== 2) return falha("fichas parecidas: " + JSON.stringify(par));
      const putA = await fetch(`${base}/api/criador/ameacas/abc12345`, { method: "PUT", headers: HP, body: JSON.stringify({ ameaca: { nome: "Lobo Mau", nd: "2", papel: "chefe", ataques: [{ nome: "Mordida", dados: "1d8<script>" }] } }) });
      const ja = await putA.json();
      if (putA.status !== 200 || ja.ameaca.papel !== "solo" || ja.ameaca.ataques[0].dados !== "") return falha("PUT ameaça devia normalizar: " + JSON.stringify(ja));
      const listaA = await (await fetch(`${base}/api/criador/ameacas`, { headers: HP })).json();
      if (listaA.length !== 1 || listaA[0].nome !== "Lobo Mau" || listaA[0].nd !== "2") return falha("lista de ameaças: " + JSON.stringify(listaA));
      if ((await (await fetch(`${base}/api/criador/ameacas`, { headers: HR })).json()).length !== 0) return falha("ameaça vazou pra outra conta");
      if ((await fetch(`${base}/api/criador/ameacas/abc12345`, { method: "PUT", headers: HP, body: JSON.stringify({ ameaca: "x" }) })).status !== 400) return falha("ameaça inválida devia dar 400");
      if ((await (await fetch(`${base}/api/criador/ameacas/abc12345`, { headers: HP })).json()).ameaca?.nome !== "Lobo Mau") return falha("ler ameaça");
      const fdl = await fetch(`${base}/api/c/ameacas/lobo-cinzento/foundry`, { headers: HP });
      const ator = await fdl.json();
      if (fdl.status !== 200 || !/attachment/.test(fdl.headers.get("content-disposition") || "") || ator.type !== "npc" || ator.system.attributes.defesa.base !== 13
        || ator.flags.world.hubT20.nome !== "Lobo Cinzento" || ator.items.length !== 2) return falha("download Foundry: " + fdl.status + " " + JSON.stringify(ator).slice(0, 300));
      if ((await fetch(`${base}/api/c/ameacas/naoexiste/foundry`, { headers: HP })).status !== 404) return falha("download de ameaça inexistente devia dar 404");
      if ((await fetch(`${base}/criar-ameaca`, { headers: HP })).status !== 200) return falha("página do criador de ameaças");
      // links: padrão vem, mestre troca, jogador não
      const lk = await (await fetch(`${base}/api/links`, { headers: HR })).json(); // H morreu com o rename do Ray
      if (!lk.grupos?.length) return falha("links padrão");
      if ((await fetch(`${base}/api/links`, { method: "PUT", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ grupos: [] }) })).status !== 403) return falha("jogadora não edita links");
      // renomear a conta leva junto as ameaças criadas
      const renA = await fetch(`${base}/api/conta`, { method: "POST", headers: HP, body: JSON.stringify({ nome: "Amanda Souza" }) });
      const HS = { cookie: renA.headers.get("set-cookie")?.split(";")[0] || "", "content-type": "application/json" };
      if (renA.status !== 200 || (await (await fetch(`${base}/api/criador/ameacas`, { headers: HS })).json()).length !== 1) return falha("ameaça não seguiu a conta renomeada");
      if ((await fetch(`${base}/api/criador/ameacas/abc12345`, { method: "DELETE", headers: HS })).status !== 200) return falha("apagar ameaça");
      if ((await fetch(`${base}/api/criador/ameacas/abc12345`, { headers: HS })).status !== 404) return falha("ameaça devia sumir");
      if ((await fetch(`${base}/api/sair`, { method: "POST", headers: HR })).headers.get("set-cookie") !== cookieSessao({ headers: { host: "127.0.0.1" } }, "x", 0)) return falha("sair devia apagar o cookie");
      console.log("server.mjs --check OK");
      server.close();
    } catch (e) { falha(e.stack || e.message); }
  });
} else {
  server.listen(PORT, () => console.log(`Hub T20 em http://localhost:${PORT} (${Object.keys(usuarios).length} contas)`));
  vetores.aquecer().then((v) => console.log(v ? "busca por sentido: modelo acordado" : "busca por sentido: Ollama fora — a busca segue só por palavra e tema")); // a 1ª consulta não paga os ~2,5 s de carga do modelo
}
