// agenda.js — lógica original do data-rpg (data.raynathus.com.br) como módulo (o roteador do hub roda de novo a cada visita).
// O que mudou: quem sou eu vem da sessão (/api/agenda/state devolve "eu"), a lista de nomes vem das contas,
// a API mora em /api/agenda/, e os timers/listeners são desfeitos ao sair da página (aoSair).
import { aoSair } from "/hub.js";

let USERS = [];
let MESTRE = 'Raimundo';
const MIN_CONFIRM = 4;
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DOW = ['D','S','T','Q','Q','S','S'];
const DIAS_SEMANA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

let me = null;
let state = { users: {} };
let monthCount = 3;
let saveTimer = null, dirty = false;
let vivo = true; // false depois que a página sai (o roteador trocou de aba)

const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hoje = () => fmt(new Date());
const dateOf = s => new Date(s + 'T12:00:00');  // meio-dia evita pulo de fuso
const $ = (id) => document.getElementById(id);

function myDays() { return (state.users[me] ??= { days: {} }).days; }

// ---- sync ----
async function load() {
  if (!vivo) return;
  try {
    const r = await fetch('/api/agenda/state');
    if (r.status === 401) { location.href = '/login?voltar=/agenda'; return; }
    const fresh = await r.json();
    fresh.users ??= {};
    me = fresh.eu; USERS = fresh.nomes; MESTRE = fresh.mestre || MESTRE;
    // não perde edição local ainda não salva / mais nova
    const mine = state.users[me];
    if (mine && (dirty || (mine.updatedAt ?? 0) > (fresh.users[me]?.updatedAt ?? 0))) fresh.users[me] = mine;
    state = fresh;
  } catch {}
  render();
}
function scheduleSave() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }
async function save() {
  if (!me) return;
  state.users[me].updatedAt = Date.now();
  try {
    await fetch('/api/agenda/user/' + encodeURIComponent(me), { method: 'PUT', body: JSON.stringify(state.users[me]) });
    dirty = false;
  } catch { setTimeout(save, 3000); }
}
const aoEsconder = () => { if (dirty && me) navigator.sendBeacon('/api/agenda/user/' + encodeURIComponent(me), JSON.stringify(state.users[me])); };
const aoVoltar = () => { if (!document.hidden) load(); };
addEventListener('pagehide', aoEsconder);
addEventListener('visibilitychange', aoVoltar);
const poll = setInterval(load, 30000);
aoSair(() => { vivo = false; clearInterval(poll); removeEventListener('pagehide', aoEsconder); removeEventListener('visibilitychange', aoVoltar); if (dirty) save(); });

// ---- edição ----
function cycle(dstr) {
  if (suppressClick) { suppressClick = false; return; }   // clique que sobrou do long-press
  const d = myDays(), cur = d[dstr];
  if (cur == null) d[dstr] = 'yes';
  else if (cur === 'yes') d[dstr] = 'no';
  else delete d[dstr];
  scheduleSave(); render();
}
function bloquear(dstr) {          // botão direito (mouse): bloqueia (de novo = desbloqueia)
  if (lastPtrType !== 'mouse') return false;   // long-press no celular dispara contextmenu → é o popup, não bloqueio
  const d = myDays();
  if (d[dstr] === 'no') delete d[dstr]; else d[dstr] = 'no';
  scheduleSave(); render();
  return false;
}

// ---- long-press: popup com os votos do dia ----
let pressTimer = null, pressXY = null, suppressClick = false, lastPtrType = 'mouse';
function showVotes(dstr) {
  const d = dateOf(dstr);
  $('pTitle').textContent = `${DIAS_SEMANA[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  $('pRows').innerHTML = USERS.map(u => {
    const v = state.users[u]?.days?.[dstr];
    const [cls, txt] = v === 'yes' ? ['y','pode'] : v === 'no' ? ['n','não pode'] : ['m','não respondeu'];
    return `<div class="prow ${cls}"><span>${u}${u === MESTRE ? ' <small>(mestre)</small>' : ''}</span><b>${txt}</b></div>`;
  }).join('');
  $('popup').classList.remove('hide');
}
{
  const months = $('months');
  months.addEventListener('pointerdown', e => {
    lastPtrType = e.pointerType;
    suppressClick = false;
    const cell = e.target.closest('.day');
    if (!cell) return;
    pressXY = [e.clientX, e.clientY];
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { suppressClick = true; showVotes(cell.dataset.d); }, 500);
  });
  months.addEventListener('pointermove', e => {
    if (pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 12) clearTimeout(pressTimer);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
    months.addEventListener(ev, () => clearTimeout(pressTimer));
}
function act(fn) { fn(); $('acoes').removeAttribute('open'); }
const foraDoMenu = e => { const dd = $('acoes'); if (dd && dd.open && !dd.contains(e.target)) dd.removeAttribute('open'); };
addEventListener('click', foraDoMenu);
aoSair(() => removeEventListener('click', foraDoMenu));
function bulk(kind, val) {
  const t = hoje(), d = myDays();
  for (const dstr of visibleDates()) {
    if (dstr < t) continue;
    const dow = dateOf(dstr).getDay(), fds = dow === 0 || dow === 6;
    if ((kind === 'fds') === fds) d[dstr] = val;
  }
  scheduleSave(); render();
}
function clearMine() {
  const t = hoje(), d = myDays();
  for (const k of Object.keys(d)) if (k >= t) delete d[k];
  scheduleSave(); render();
}
function visibleDates() {
  const out = [], now = new Date();
  for (let i = 0; i < monthCount; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + i + 1, 0).getDate();
    for (let day = 1; day <= last; day++) out.push(fmt(new Date(first.getFullYear(), first.getMonth(), day)));
  }
  return out;
}

// ---- melhor dia ----
// prioridade: a data MAIS PRÓXIMA com 4+ podendo; dia bloqueado pelo mestre é vetado
function ranking() {
  const t = hoje(), byDate = {};
  for (const u of USERS) {
    for (const [dstr, v] of Object.entries(state.users[u]?.days ?? {})) {
      if (dstr < t) continue;
      (byDate[dstr] ??= { yes: [], no: [] })[v].push(u);
    }
  }
  return Object.entries(byDate)
    .filter(([, c]) => c.yes.length >= MIN_CONFIRM && !c.no.includes(MESTRE))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ---- render ----
function render() {
  if (!vivo || !$('months')) return;
  $('meName').textContent = me ?? '';
  $('dotOrder').textContent = USERS.join(', ');
  $('mestreNome').textContent = MESTRE;

  const rank = ranking();
  const bannerEl = $('banner');
  const bestDate = rank[0]?.[0];
  if (bestDate) {
    const c = rank[0][1];
    const d = dateOf(bestDate);
    const falta = USERS.filter(u => !c.yes.includes(u) && !c.no.includes(u));
    bannerEl.className = 'banner on';
    bannerEl.innerHTML =
      `<div class="label">Próxima sessão</div>` +
      `<div class="date">${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}</div>` +
      `<div class="names"><span class="y">✅ ${c.yes.join(', ')}</span>` +
      (c.no.length ? ` · <span class="n">🚫 ${c.no.join(', ')}</span>` : '') +
      (falta.length ? ` · <span class="m">🤷 ${falta.join(', ')}</span>` : '') + `</div>` +
      (rank.length > 1 ? `<div class="alt">Outras opções: ${rank.slice(1, 4).map(([ds, cc]) => { const dd = dateOf(ds); return `${String(dd.getDate()).padStart(2,'0')}/${String(dd.getMonth()+1).padStart(2,'0')} (${cc.yes.length}✅)`; }).join(' · ')}</div>` : '');
  } else {
    bannerEl.className = 'banner';
    bannerEl.innerHTML = `<div class="label">Próxima sessão</div><div class="names m" style="color:var(--dim)">Ainda sem data com ${MIN_CONFIRM}+ confirmados. Marquem os dias! 👇</div>`;
  }

  const t = hoje(), now = new Date();
  let html = '';
  for (let i = 0; i < monthCount; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    html += `<div class="month"><h2>${MESES[first.getMonth()]} ${first.getFullYear()}</h2><div class="grid">`;
    html += DOW.map(w => `<div class="dow">${w}</div>`).join('');
    html += '<div></div>'.repeat(first.getDay());
    for (let day = 1; day <= lastDay; day++) {
      const dstr = fmt(new Date(first.getFullYear(), first.getMonth(), day));
      const mine = state.users[me]?.days?.[dstr];
      const cls = ['day', mine === 'yes' ? 'yes' : mine === 'no' ? 'no' : '', dstr < t ? 'past' : '', dstr === bestDate ? 'best' : ''].filter(Boolean).join(' ');
      const dots = USERS.map(u => { const v = state.users[u]?.days?.[dstr]; return `<span class="dot ${v === 'yes' ? 'y' : v === 'no' ? 'n' : ''}"></span>`; }).join('');
      const tip = USERS.map(u => { const v = state.users[u]?.days?.[dstr]; return `${u}: ${v === 'yes' ? 'pode' : v === 'no' ? 'não pode' : '?'}`; }).join('\n');
      html += `<div class="${cls}" title="${tip}" data-d="${dstr}" onclick="agenda.cycle('${dstr}')" oncontextmenu="return agenda.bloquear('${dstr}')"><div class="num">${day}</div><div class="dots">${dots}</div></div>`;
    }
    html += '</div></div>';
  }
  $('months').innerHTML = html;
}

// os handlers inline do HTML original (onclick="…") chamam por aqui
window.agenda = { cycle, bloquear, act, bulk, clearMine, maisUmMes: () => { monthCount++; render(); } };
load();
