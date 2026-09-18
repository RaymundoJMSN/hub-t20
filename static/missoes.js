/* missoes.js — motor do quadro da guilda (guilda.raynathus.com.br), com o visual intacto.
   O que mudou: as missões e os votos vêm da API do hub (/api/missoes) em vez do Firebase,
   quem sou eu vem da sessão (personagem da conta, ou o nome), e o Mestre edita o quadro. */
import { eu, aoSair } from "/hub.js";

const PERIGO_INFO = {
  1: { nome: "Trivial", classe: "perigo-1" },
  2: { nome: "Moderado", classe: "perigo-2" },
  3: { nome: "Perigoso", classe: "perigo-3" },
  4: { nome: "Mortal", classe: "perigo-4" },
  5: { nome: "Lendário", classe: "perigo-5" },
};
const MESTRE = "Mestre";

function escapeHTML(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Iniciais do aventureiro, usadas como reserva se não houver ícone. */
function iniciais(nome) {
  const partes = String(nome).trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/* Ícone (brasão) de cada aventureiro. SVGs em "currentColor" para herdar a cor do crachá. */
const ICONES = {
  // Behrtio — caveira
  Behrtio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3C8 3 5 6 5 9.8c0 2 .9 3.8 2.3 5 .4.4.7.9.7 1.5V18c0 .6.4 1 1 1h8c.6 0 1-.4 1-1v-1.7c0-.6.3-1.1.7-1.5C19.1 13.6 20 11.8 20 9.8 20 6 17 3 12 3z"/><circle cx="9.2" cy="11" r="1.6" fill="currentColor" stroke="none"/><circle cx="14.8" cy="11" r="1.6" fill="currentColor" stroke="none"/><path d="M12 13.2l-.9 1.6h1.8z" fill="currentColor" stroke="none"/><path d="M10 19v-2M14 19v-2M12 19v-2.4"/></svg>`,
  // Franziska von Karma — chicote
  "Franziska von Karma": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 20 8 16.5" stroke-width="2.8"/><path d="M8 16.5 C 12.5 12, 18.5 14.5, 19 9.5 C 19.4 5.8, 13.5 4.2, 12.5 7.5 C 11.8 9.8, 15 10.8, 16.2 8.8" stroke-width="1.6"/></svg>`,
  // Lydia Alnari — alaúde
  "Lydia Alnari": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="15.2" r="5.4"/><circle cx="9" cy="15.2" r="1.3"/><path d="M12.9 11.4 18.6 5.7"/><path d="M17.2 3.6 21 7.4l-1.9 1.1-2-2z" fill="currentColor" stroke="none"/></svg>`,
  // Silvester, O Mártir — cruz com auréola (santo)
  "Silvester, O Mártir": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9.5" r="4.6"/><path d="M12 3.5v17M6.8 9.5h10.4"/></svg>`,
  // Valka Calen — escudo de paladino
  "Valka Calen": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 2.4v4.8c0 4.5-3 7.9-7 9.6-4-1.7-7-5.1-7-9.6V5.4z"/><path d="M12 7.2v8.2M8.4 11.2h7.2"/></svg>`,
  // Mestre — coroa
  Mestre: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.5 9.5 8 12.2 12 6.8 16 12.2 19.5 9.5 18 17.2H6z"/><rect x="5.6" y="18.4" width="12.8" height="2.2" rx="1"/><circle cx="4.5" cy="8" r="1.5"/><circle cx="19.5" cy="8" r="1.5"/><circle cx="12" cy="5.2" r="1.7"/></svg>`,
};
function iconeDe(nome) { return ICONES[nome] || escapeHTML(iniciais(nome)); }

function pips(nivel) {
  let out = "";
  for (let i = 1; i <= 5; i++) out += `<span class="pip ${i <= nivel ? "pip-on" : "pip-off"}"></span>`;
  return out;
}

/* ------------------------------------------------------------
   ARMAZENAMENTO = API do hub. Mesma interface do original:
     assinar(cb) → cb({ marcacoes, concluidas }); alternarMarcacao(id, nome, ligar); concluir(id, ligar)
   Cada ação devolve o estado inteiro; entre ações, um poll a cada 30 s e ao voltar pra aba.
   ------------------------------------------------------------ */
let MISSOES = [];
function criarArmazenamentoApi() {
  let ouvinte = null;
  const post = (rota, corpo) => fetch(rota, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }).then((r) => r.json());
  const entregar = (dados) => {
    if (dados.erro || !Array.isArray(dados.missoes)) return;
    const concluidas = Object.fromEntries(dados.missoes.filter((m) => m.concluida).map((m) => [m.id, true]));
    const trocouQuadro = JSON.stringify(dados.missoes.map((m) => [m.id, m.titulo, m.solicitante, m.local, m.descricao, m.perigo, m.recompensa]))
      !== JSON.stringify(MISSOES.map((m) => [m.id, m.titulo, m.solicitante, m.local, m.descricao, m.perigo, m.recompensa]));
    MISSOES = dados.missoes;
    if (trocouQuadro) montarCartazes();
    ouvinte?.({ marcacoes: dados.votos || {}, concluidas });
  };
  const buscar = async () => { try { entregar(await (await fetch("/api/missoes")).json()); } catch {} };
  return {
    assinar(cb) {
      ouvinte = cb;
      buscar();
      const poll = setInterval(buscar, 30000);
      const aoVoltar = () => { if (!document.hidden) buscar(); };
      addEventListener("visibilitychange", aoVoltar);
      aoSair(() => { clearInterval(poll); removeEventListener("visibilitychange", aoVoltar); ouvinte = null; });
    },
    async alternarMarcacao(id, _nome, ligar) { entregar(await post("/api/missoes/votar", { id, ligar })); },
    async concluir(id, ligar) { entregar(await post("/api/missoes/concluir", { id, ligar })); },
    async salvarQuadro(missoes) {
      const r = await (await fetch("/api/missoes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ missoes }) })).json();
      if (r.ok) await buscar();
      return r;
    },
  };
}

/* ------------------------------------------------------------ */

let usuarioAtual = null;
let souMestre = false;
let armazenamento = null;
let ultimasMarcacoes = {};
let ultimasConcluidas = {};
let cartoes = []; // { id, indice, el, btn, btnConcluir, marcadoresEl }
const ehMestre = () => souMestre;

function criarCartaz(m, indice) {
  const nivel = Math.min(5, Math.max(1, parseInt(m.perigo, 10) || 1));
  const info = PERIGO_INFO[nivel];
  const id = m.id;

  const el = document.createElement("article");
  el.className = "cartaz";
  el.style.setProperty("--delay", `${indice * 90}ms`);
  el.dataset.id = id;

  el.innerHTML = `
    <div class="furo furo-esq"></div>
    <div class="furo furo-dir"></div>

    <div class="cartaz-topo">
      <span class="bracket">❧</span>
      <h2 class="cartaz-titulo">${escapeHTML(m.titulo)}</h2>
      <span class="bracket flip">❧</span>
    </div>

    <div class="selo ${info.classe}" title="Nível de Perigo ${nivel} — ${info.nome}">
      <span class="selo-num">${nivel}</span>
    </div>

    <dl class="cartaz-meta">
      <div class="meta-linha">
        <dt>Solicitante:</dt>
        <dd>${escapeHTML(m.solicitante)}</dd>
      </div>
      <div class="meta-linha">
        <dt>Local:</dt>
        <dd>${escapeHTML(m.local)}</dd>
      </div>
    </dl>

    <p class="cartaz-descricao">${escapeHTML(m.descricao)}</p>

    <div class="cartaz-rodape">
      <div class="perigo">
        <span class="perigo-rotulo">Perigo</span>
        <span class="pips">${pips(nivel)}</span>
        <span class="perigo-nome">${info.nome}</span>
      </div>
      <div class="recompensa">
        <span class="recompensa-rotulo">Recompensa</span>
        <span class="recompensa-valor">${escapeHTML(m.recompensa)}</span>
      </div>
    </div>

    <div class="cartaz-grupo">
      <button type="button" class="btn-marcar" aria-pressed="false">
        <span class="btn-marcar-icone">⛏</span>
        <span class="btn-marcar-txt">Quero fazer</span>
      </button>
      <div class="marcadores" aria-live="polite"></div>
    </div>

    <div class="cartaz-mestre">
      <button type="button" class="btn-concluir">
        <span class="btn-concluir-txt">Marcar como cumprida</span>
      </button>
    </div>

    <div class="carimbo-cumprido" aria-hidden="true">
      <span class="carimbo-titulo">Cumprido</span>
      <span class="carimbo-sub">Pelos Viajantes Eternos</span>
    </div>
  `;

  const btn = el.querySelector(".btn-marcar");
  const marcadoresEl = el.querySelector(".marcadores");
  const btnConcluir = el.querySelector(".btn-concluir");

  btn.addEventListener("click", () => {
    if (!usuarioAtual || !armazenamento) return;
    const marcados = ultimasMarcacoes[id] || {};
    armazenamento.alternarMarcacao(id, usuarioAtual, !marcados[usuarioAtual]);
  });
  btnConcluir.addEventListener("click", () => {
    if (!ehMestre() || !armazenamento) return;
    armazenamento.concluir(id, !ultimasConcluidas[id]);
  });

  cartoes.push({ id, indice, el, btn, btnConcluir, marcadoresEl });
  return el;
}

/* (re)pinta os cartazes do zero — na carga e quando o Mestre salva um quadro novo */
function montarCartazes() {
  const quadro = document.getElementById("quadro");
  quadro.innerHTML = "";
  cartoes = [];
  MISSOES.forEach((m, i) => quadro.appendChild(criarCartaz(m, i)));
  reaplicar();
}

/* Atualiza toda a UI a partir do estado atual (votos + cumpridas) e reordena via CSS "order":
   abertas primeiro, das mais votadas para as menos; cumpridas por último (ordem original). */
function reaplicar() {
  const lista = cartoes.map((c) => {
    const concluida = !!ultimasConcluidas[c.id];
    const marcados = concluida ? [] : Object.keys(ultimasMarcacoes[c.id] || {});
    return { c, concluida, marcados, n: marcados.length };
  });

  lista.sort((a, b) => {
    if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
    if (!a.concluida && b.n !== a.n) return b.n - a.n;
    return a.c.indice - b.c.indice;
  });

  const topAberta = lista.find((x) => !x.concluida && x.n > 0);

  lista.forEach((item, posicao) => {
    const { c, concluida, marcados } = item;
    c.el.style.order = String(posicao);
    c.el.classList.toggle("concluida", concluida);
    c.el.classList.toggle("destaque", item === topAberta);

    const euMarquei = usuarioAtual && marcados.includes(usuarioAtual);
    c.btn.classList.toggle("ativo", !!euMarquei);
    c.btn.setAttribute("aria-pressed", euMarquei ? "true" : "false");
    c.btn.querySelector(".btn-marcar-txt").textContent = euMarquei ? "Vou nessa!" : "Quero fazer";
    c.btn.disabled = !usuarioAtual;

    if (marcados.length === 0) {
      c.marcadoresEl.innerHTML = '<span class="marcadores-vazio">Ninguém marcou ainda</span>';
    } else {
      const chips = marcados.slice().sort()
        .map((nome) => `<span class="chip ${nome === usuarioAtual ? "eu" : ""}" data-nome="${escapeHTML(nome)}" aria-label="${escapeHTML(nome)}">${iconeDe(nome)}</span>`)
        .join("");
      const rotulo = marcados.length === 1 ? "1 interessado" : `${marcados.length} interessados`;
      c.marcadoresEl.innerHTML = `<span class="marcadores-contagem">${rotulo}</span><span class="marcadores-chips">${chips}</span>`;
    }

    c.btnConcluir.classList.toggle("reabrir", concluida);
    c.btnConcluir.querySelector(".btn-concluir-txt").textContent = concluida ? "Reabrir missão" : "Marcar como cumprida";
  });

  const contador = document.getElementById("contador");
  if (contador) {
    const abertas = lista.filter((x) => !x.concluida).length;
    contador.textContent = abertas === 1 ? "1 missão disponível" : `${abertas} missões disponíveis`;
  }
}

/* ------------------------------------------------------------
   QUEM SOU EU: sessão do hub (personagem da conta, ou o nome). O Mestre ganha os poderes.
   ------------------------------------------------------------ */
function atualizarBadgeUsuario() {
  const badge = document.getElementById("usuarioAtual");
  const nomeEl = document.getElementById("usuarioNome");
  if (usuarioAtual) {
    nomeEl.innerHTML = ehMestre()
      ? `<span class="badge-coroa">${iconeDe(MESTRE)}</span>${escapeHTML(usuarioAtual)}`
      : escapeHTML(usuarioAtual);
    badge.hidden = false;
  } else badge.hidden = true;
}

/* ------------------------------------------------------------
   EDITOR DO QUADRO (Mestre): um bloco por missão; salvar regrava a lista inteira.
   ------------------------------------------------------------ */
function abrirEditor() {
  const editor = document.getElementById("editor");
  const blocos = document.getElementById("editorBlocos");
  blocos.innerHTML = "";
  MISSOES.forEach(blocoEditor);
  editor.hidden = false;
  document.getElementById("editorMsg").textContent = "";
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}
function blocoEditor(m = { perigo: 1 }) {
  const b = document.createElement("div");
  b.className = "editor-bloco";
  b.dataset.id = m.id || "";
  b.dataset.concluida = m.concluida ? "1" : "";
  const campo = (k, rotulo, tipo = "input") => `<label><span>${rotulo}</span><${tipo} class="ed-${k}" ${tipo === "input" ? `value="${escapeHTML(m[k] || "")}"` : ""}>${tipo === "textarea" ? escapeHTML(m[k] || "") : ""}</${tipo}></label>`;
  b.innerHTML = `
    ${campo("titulo", "Título")}
    ${campo("solicitante", "Solicitante")}
    ${campo("local", "Local")}
    ${campo("descricao", "Descrição", "textarea")}
    ${campo("recompensa", "Recompensa")}
    <label><span>Perigo</span><select class="ed-perigo">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === (m.perigo || 1) ? "selected" : ""}>${n} — ${PERIGO_INFO[n].nome}</option>`).join("")}</select></label>
    <button type="button" class="trocar-usuario ed-tirar">tirar do quadro</button>`;
  b.querySelector(".ed-tirar").addEventListener("click", () => b.remove());
  document.getElementById("editorBlocos").appendChild(b);
}
async function salvarEditor() {
  const msg = document.getElementById("editorMsg");
  const missoes = [...document.querySelectorAll("#editorBlocos .editor-bloco")].map((b) => ({
    id: b.dataset.id || undefined, concluida: !!b.dataset.concluida,
    titulo: b.querySelector(".ed-titulo").value, solicitante: b.querySelector(".ed-solicitante").value, local: b.querySelector(".ed-local").value,
    descricao: b.querySelector(".ed-descricao").value, recompensa: b.querySelector(".ed-recompensa").value, perigo: Number(b.querySelector(".ed-perigo").value),
  }));
  const r = await armazenamento.salvarQuadro(missoes);
  msg.textContent = r.ok ? "Quadro atualizado." : r.erro || "Não deu.";
  if (r.ok) document.getElementById("editor").hidden = true;
}

/* ------------------------------------------------------------ */

async function inicializar() {
  const u = await eu;
  usuarioAtual = u.personagem || u.nome;
  souMestre = !!u.mestre;
  document.body.classList.toggle("modo-mestre", souMestre);
  atualizarBadgeUsuario();

  const btnEditar = document.getElementById("editarQuadro");
  btnEditar.hidden = !souMestre;
  btnEditar.addEventListener("click", abrirEditor);
  document.getElementById("editorNova").addEventListener("click", () => blocoEditor());
  document.getElementById("editorSalvar").addEventListener("click", salvarEditor);
  document.getElementById("editorCancelar").addEventListener("click", () => (document.getElementById("editor").hidden = true));

  armazenamento = criarArmazenamentoApi();
  armazenamento.assinar((dados) => {
    ultimasMarcacoes = dados.marcacoes || {};
    ultimasConcluidas = dados.concluidas || {};
    reaplicar();
  });
}

inicializar();
