/* Ecoesencias · Servicio Técnico — app de técnicos y panel de administración */
'use strict';

/* ---------- Catálogos de la hoja de servicio ---------- */
const TIPOS = ['Instalación','Mantención preventiva','Mantención correctiva','Retiro de equipo','Revisión técnica','Cambio de ubicación','Otro'];
const TRABAJOS = ['Equipo instalado','Equipo retirado','Equipo revisado','Limpieza realizada','Recarga o cambio de aroma','Programación ajustada','Pilas reemplazadas','Fuente de poder revisada','Funcionamiento comprobado','Equipo entregado operativo','Evidencia fotográfica registrada','Requiere nueva visita','Copia entregada o enviada al cliente'];
const RESULTADOS = [
  {k:'conforme', t:'Conforme y operativo', c:'ok'},
  {k:'obs', t:'Operativo con observaciones', c:'warn'},
  {k:'pendiente', t:'Pendiente de solución', c:'bad'},
  {k:'fuera', t:'Equipo fuera de servicio', c:'bad'}];
const FOTOS = [
  {k:'antes', t:'Por dentro', h:'Cómo estaba al abrirlo'},
  {k:'despues', t:'Cómo quedó', h:'Después del servicio'},
  {k:'general', t:'Vista general', h:'Desde más lejos'}];
const STEPS = ['Cliente','Tipo de asistencia','Equipos y fotos','Trabajo realizado','Firma y cierre'];

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => iso(new Date());
const addD = (n, base) => { const d = base ? new Date(base + 'T12:00') : new Date(); d.setHours(12); d.setDate(d.getDate() + n); return iso(d); };
const dmy = s => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—';
const longD = s => new Date(s + 'T12:00').toLocaleDateString('es-CL', {weekday:'long', day:'numeric', month:'long'});
const shortD = s => new Date(s + 'T12:00').toLocaleDateString('es-CL', {weekday:'short', day:'numeric', month:'short'});
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const daysFrom = s => Math.round((new Date(String(s).slice(0, 10) + 'T12:00') - new Date(hoy() + 'T12:00')) / 864e5);
const osNum = n => 'OS-' + pad(n, 5);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const firstName = n => String(n || '').split(' ')[0];
const resOf = k => RESULTADOS.find(r => r.k === k || r.t === k) || {t:k || '—', c:''};
const fmtRut = v => {
  const c = String(v).replace(/[^0-9kK]/g, '').toUpperCase(); if (c.length < 2) return c;
  return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + c.slice(-1);
};
const cleanMsg = m => String(m || '').replace(/^(RED|SESION):\s*/, '');
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem('eco.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('eco.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('eco.' + k); } catch (e) {} }
};
const ICONS = {
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};

/* ---------- IndexedDB: cola de envíos, servicios cerrados y borrador ---------- */
let DBH;
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('eco-servicio', 1);
    r.onupgradeneeded = () => { const d = r.result; ['cola','hechos'].forEach(n => d.createObjectStore(n, {keyPath:'uid'})); d.createObjectStore('kv'); };
    r.onsuccess = () => { DBH = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode, fn) => new Promise((res, rej) => {
  const t = DBH.transaction(store, mode); const s = t.objectStore(store); const r = fn(s);
  t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error);
});
const idb = {
  all: s => tx(s, 'readonly', st => st.getAll()),
  get: (s, k) => tx(s, 'readonly', st => st.get(k)),
  put: (s, v, k) => tx(s, 'readwrite', st => k === undefined ? st.put(v) : st.put(v, k)),
  del: (s, k) => tx(s, 'readwrite', st => st.delete(k))
};

/* ---------- Conexión con el programa de Google ---------- */
const apiUrl = () => (ls.get('api') || (window.ECO_CONFIG && ECO_CONFIG.API_URL) || '').trim();
async function api(action, data = {}, timeout = 45000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try { r = await fetch(apiUrl(), {method:'POST', body:JSON.stringify(Object.assign({action}, data)), signal:ctl.signal, redirect:'follow'}); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'RED: La conexión tardó demasiado.' : 'RED: No hay conexión con el servidor.'); }
  finally { clearTimeout(t); }
  let j; try { j = await r.json(); } catch (e) { throw new Error('RED: El servidor respondió algo inesperado. Revisa la dirección del programa.'); }
  if (!j.ok) throw new Error(j.error || 'Error desconocido.');
  return j;
}

/* ---------- Estado ---------- */
const S = {
  view:'login', ses:ls.get('ses'), cat:ls.get('cat'), step:1, draft:null, borrador:null, err:'', toast:'',
  online:navigator.onLine, cola:[], hechos:[], lastUid:null, syncing:false, syncErr:'', busy:'', modal:null,
  armed:{}, q:'',
  form:{login:{u:'', p:''}, adm:{u:'', p:''}, api:'', tec:{nombre:'', usuario:'', pin:''}, vis:{cliente_id:'', sucursal_id:'', tecnico_id:'', fecha:addD(1), tipo:'Mantención preventiva'}},
  adm:{token:null, data:null, tab:'resumen', fTec:'', fCli:'', showPin:{}}
};
try { S.adm.token = sessionStorage.getItem('eco.adm'); } catch (e) {}

const tecId = () => S.ses && S.ses.tecnico.id;
const firmaTec = () => ls.get('firma.' + tecId());
const suc = id => (S.cat && S.cat.sucursales || []).find(s => s.id === id);
const cli = id => (S.cat && S.cat.clientes || []).find(c => c.id === id) || {nombre:'', rut:''};
const eqsOf = sid => (S.cat && S.cat.equipos || []).filter(e => e.sucursal_id === sid);

/* Números de orden reservados para este teléfono */
const osBlocks = () => ls.get('os.' + tecId(), []);
const osLeft = () => osBlocks().reduce((a, b) => a + (b.hasta - b.desde + 1), 0);
function addOsBlock(b) { if (!b) return; const l = osBlocks(); l.push({desde:b.desde, hasta:b.hasta}); ls.set('os.' + tecId(), l); }
function takeOs() {
  const l = osBlocks(); if (!l.length) return null;
  const n = l[0].desde; l[0].desde++; if (l[0].desde > l[0].hasta) l.shift();
  ls.set('os.' + tecId(), l); return n;
}

let toastT;
function toast(m) { S.toast = m; renderToast(); clearTimeout(toastT); toastT = setTimeout(() => { S.toast = ''; renderToast(); }, 4500); }
function busy(m) { S.busy = m; $('#busy').innerHTML = m ? `<div class="busy"><div><div class="spin"></div><span>${esc(m)}</span></div></div>` : ''; }
function arm(key) { // confirmación en dos toques
  if (S.armed[key]) { delete S.armed[key]; return true; }
  S.armed[key] = true; setTimeout(() => { if (S.armed[key]) { delete S.armed[key]; render(); } }, 4000); render(); return false;
}

async function loadQueues() {
  const mine = x => !S.ses || x.tecId === tecId();
  S.cola = (await idb.all('cola')).sort((a, b) => b.creado - a.creado);
  S.hechos = (await idb.all('hechos')).filter(mine).sort((a, b) => b.creado - a.creado);
}

/* ---------- Sincronización ---------- */
async function refreshCatalog(silent) {
  if (!S.ses || !navigator.onLine) return;
  try {
    const r = await api('catalogo', {token:S.ses.token, pedirOs: osLeft() < 10});
    if (r.osBlock) addOsBlock(r.osBlock);
    delete r.ok; delete r.osBlock; S.cat = r; ls.set('cat', r);
    if (!silent && S.view !== 'form') render();
  } catch (e) { handleErr(e, true); }
}

async function syncCola() {
  if (S.syncing || !S.ses || !navigator.onLine) return;
  const items = S.cola.filter(x => x.tecId === tecId());
  if (!items.length) return;
  S.syncing = true; S.syncErr = ''; if (S.view === 'agenda') render();
  for (const it of items.slice().reverse()) {
    try {
      const s = Object.assign({}, it.servicio, {firma:undefined, equipos:it.servicio.equipos.map(q => Object.assign({}, q, {fotos:undefined}))});
      const fotos = [];
      it.servicio.equipos.filter(q => q.atendido).forEach((q, i) => FOTOS.forEach(f => {
        const d = q.fotos && q.fotos[f.k]; if (d) fotos.push({nombre:`Equipo ${i + 1} - ${f.t}`, data:d.split(',').pop()});
      }));
      const r = await api('enviar', {token:S.ses.token, servicio:s, pdf:it.pdf, fotos}, 180000);
      const done = Object.assign({}, it, {estado:'enviado', pdfUrl:r.pdfUrl, correo:r.correo, enviado:Date.now()});
      delete done.servicio.firma; done.servicio.equipos.forEach(q => { q.fotos = {}; }); // el PDF ya las contiene
      await idb.put('hechos', done); await idb.del('cola', it.uid);
    } catch (e) {
      S.syncErr = cleanMsg(e.message);
      if (/^SESION/.test(e.message)) { handleErr(e); break; }
      if (/^RED/.test(e.message)) break;
    }
  }
  // Se guardan los últimos 40 servicios en el teléfono
  const h = (await idb.all('hechos')).sort((a, b) => b.creado - a.creado);
  for (const x of h.slice(40)) await idb.del('hechos', x.uid);
  await loadQueues(); S.syncing = false;
  if (S.view !== 'form') render();
}

function handleErr(e, quiet) {
  const m = e.message || '';
  if (/^SESION/.test(m)) {
    S.ses = null; ls.del('ses'); S.view = 'login'; S.err = cleanMsg(m) + (S.cola.length ? ' Los servicios guardados se enviarán cuando vuelvas a ingresar.' : '');
    render(); return;
  }
  if (!quiet) { S.err = cleanMsg(m); render(); }
}

window.addEventListener('online', () => { S.online = true; if (S.view !== 'form') render(); refreshCatalog(true); syncCola(); });
window.addEventListener('offline', () => { S.online = false; if (S.view !== 'form') render(); else renderTop(); });
setInterval(() => { if (navigator.onLine) syncCola(); }, 60000);

/* ---------- Componentes ---------- */
const pillRes = k => { const r = resOf(k); return `<span class="pill ${r.c}"><i></i>${esc(r.t)}</span>`; };
function pillCorreo(t) {
  t = String(t || 'Pendiente');
  const c = /^(Enviado|Reenviado)/.test(t) ? 'ok' : /^Error/.test(t) ? 'bad' : /^No enviado/.test(t) ? '' : 'warn';
  return `<span class="pill ${c}" title="${esc(t)}"><i></i>${esc(t.replace(/ \d{4}-\d{2}-\d{2}.*/, ''))}</span>`;
}

function renderTop() {
  const net = `<span class="netpill ${S.online ? '' : 'off'}">${S.online ? 'Con señal' : 'Sin señal'}</span>`;
  $('#topbar').innerHTML = `<div class="brand"><img src="${ECO_ICON}" alt=""><div><b>Ecoesencias</b><span>Servicio técnico</span></div></div>${S.view === 'admin' ? '' : net}`;
}

/* ---------- Pantallas: configuración e ingreso ---------- */
function vSetup() {
  return `<form class="login card" data-submit="saveApi">
  <img src="${ECO_LOGO}" class="login-logo" alt="Ecoesencias">
  <h1>Conectar la app</h1><p class="muted">Pega la dirección de la aplicación web de Google Apps Script. Termina en <b>/exec</b>.</p>
  ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
  <div class="field"><label for="ap">Dirección del programa</label><input id="ap" type="url" data-bind="f.api" value="${esc(S.form.api || apiUrl())}" placeholder="https://script.google.com/macros/s/…/exec"></div>
  <button class="btn primary block" type="submit">Guardar y probar</button>
  ${apiUrl() ? '<button type="button" class="link" data-act="toLogin">Volver</button>' : ''}</form>`;
}
function vLogin() {
  return `<form class="login card" data-submit="login">
  <img src="${ECO_LOGO}" class="login-logo" alt="Ecoesencias">
  <h1>Ingreso técnicos</h1><p class="muted">Entra con el usuario y PIN que te asignó la administración.</p>
  ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
  ${S.online ? '' : '<p class="hint-box">Para ingresar la primera vez necesitas señal. Después la app funciona sin conexión.</p>'}
  <div class="field"><label for="lu">Usuario</label><input id="lu" autocomplete="username" autocapitalize="none" spellcheck="false" data-bind="f.login.u" value="${esc(S.form.login.u)}"></div>
  <div class="field"><label for="lp">PIN</label><input id="lp" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" data-bind="f.login.p" value="${esc(S.form.login.p)}"></div>
  <button class="btn primary block" type="submit">Ingresar</button>
  <div class="spread"><button type="button" class="link" data-act="toAdminLogin">Ingreso administración</button><button type="button" class="link" data-act="toSetup">Conexión</button></div></form>`;
}
function vFirmaTec() {
  return `<section><p class="eyebrow">Una sola vez</p><h1>Registra tu firma</h1><p class="muted" style="margin-top:6px">Se agrega automáticamente en cada hoja de servicio como técnico responsable.</p></section>
  <div class="card stack"><div class="spread"><span class="lbl">Firma de ${esc(S.ses.tecnico.nombre)}</span><button class="link" data-act="clearSig">Borrar</button></div>
  <div class="sigwrap"><canvas id="sig" class="sig"></canvas><div class="sigph" id="sigph">Firma aquí con el dedo</div></div>
  ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
  <button class="btn primary" data-act="saveFirmaTec">Guardar mi firma</button></div>`;
}

/* ---------- Agenda del técnico ---------- */
function itemsLocales() { return S.cola.filter(x => x.tecId === tecId()).concat(S.hechos); }
function localDe(visitaId) { return itemsLocales().find(x => x.servicio && x.servicio.visita_id === visitaId); }

function visitCard(v) {
  const su = suc(v.sucursal_id);
  if (!su) return '';
  const c = cli(su.cliente_id), n = eqsOf(su.id).length, loc = localDe(v.id);
  const done = loc || v.estado === 'completada';
  return `<article class="card visit ${done ? 'done' : ''}">
    <div><div class="row"><span class="pill info">${esc(v.tipo)}</span>${done ? `<span class="pill ok"><i></i>Completado${loc ? ' · ' + osNum(loc.os) : v.os ? ' · ' + esc(v.os) : ''}</span>` : ''}${loc && loc.estado !== 'enviado' ? '<span class="pill warn"><i></i>En el teléfono</span>' : ''}</div>
    <h3>${esc(su.nombre)}</h3><p class="meta">${esc(c.nombre)} · ${esc(su.direccion)}${su.comuna ? ', ' + esc(su.comuna) : ''}</p>
    <p class="meta">${n} equipo${n === 1 ? '' : 's'}${su.encargado ? ' · Encargado: ' + esc(su.encargado) : ''}${su.horario ? ' · ' + esc(su.horario) : ''}</p></div>
    ${loc ? `<div class="row"><button class="btn sm" data-act="share" data-id="${loc.uid}">Compartir PDF</button><button class="btn sm" data-act="download" data-id="${loc.uid}">Descargar PDF</button></div>`
      : done ? '' : `<button class="btn primary" data-act="start" data-v="${esc(v.id)}">Iniciar servicio</button>`}
  </article>`;
}

function vAgenda() {
  const t = S.ses.tecnico, cat = S.cat || {visitas:[]};
  const vs = (cat.visitas || []).filter(v => daysFrom(v.fecha) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const days = [...new Set(vs.map(v => v.fecha))];
  const pend = S.cola.filter(x => x.tecId === tecId());
  const otros = S.cola.length - pend.length;
  const recientes = itemsLocales().sort((a, b) => b.creado - a.creado).slice(0, 8);
  const b = S.borrador;
  return `<section class="hello"><div><p class="eyebrow">${longD(hoy())}</p><h1>Hola, ${esc(firstName(t.nombre))}</h1></div>
    <button class="btn sm" data-act="logout">${S.armed.logout ? 'Toca de nuevo para salir' : 'Salir'}</button></section>
  ${b ? `<div class="banner"><span>Tienes un servicio sin terminar en ${esc((suc(b.draft.sucursal_id) || {}).nombre || 'una sucursal')}</span>
     <div class="row"><button class="btn sm" data-act="discardDraft">${S.armed.discard ? 'Toca para descartar' : 'Descartar'}</button><button class="btn sm lime" data-act="resumeDraft">Continuar</button></div></div>` : ''}
  ${pend.length ? `<div class="banner"><span>${pend.length} servicio${pend.length > 1 ? 's' : ''} guardado${pend.length > 1 ? 's' : ''} en el teléfono${S.syncErr ? `<br><small>${esc(S.syncErr)}</small>` : ''}</span>
     <button class="btn sm lime" data-act="sync" ${S.online && !S.syncing ? '' : 'disabled'}>${S.syncing ? 'Enviando…' : S.online ? 'Enviar ahora' : 'Se enviará con señal'}</button></div>` : ''}
  ${otros ? `<p class="hint-box">Hay ${otros} servicio(s) de otro técnico guardados en este teléfono. Se enviarán cuando esa persona ingrese.</p>` : ''}
  ${days.length ? days.map(d => {
    const l = vs.filter(v => v.fecha === d); const df = daysFrom(d);
    return `<div class="day-h"><h2>${df === 0 ? 'Hoy' : df === 1 ? 'Mañana' : shortD(d)}</h2><span class="muted small">${longD(d)} · ${l.length} visita${l.length > 1 ? 's' : ''}</span></div>${l.map(visitCard).join('')}`;
  }).join('') : `<div class="card"><h3>Sin visitas en la agenda</h3><p class="muted">Cuando la administración te asigne visitas aparecerán aquí. También puedes iniciar un servicio directamente.</p></div>`}
  <button class="btn primary" data-act="toPick">+ Nuevo servicio sin agenda</button>
  ${recientes.length ? `<h2>Cerrados en este teléfono</h2><div class="card"><div class="list">${recientes.map(x => `<div class="li"><div><b>${esc(x.sucursal)}</b> <span class="mono muted small">${osNum(x.os)}</span>
      <p class="muted small">${dmy(x.fecha)} · ${x.estado === 'enviado' ? 'Enviado' : 'En el teléfono, pendiente de envío'}</p></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="share" data-id="${x.uid}">Compartir</button><button class="btn sm" data-act="download" data-id="${x.uid}">PDF</button></div></div>`).join('')}</div></div>` : ''}
  <p class="footnote">Números de orden disponibles en este teléfono: ${osLeft()} · <button class="link" data-act="redoFirma">Cambiar mi firma</button></p>`;
}

function vPick() {
  const cat = S.cat || {clientes:[], sucursales:[]};
  return `<button class="back" data-act="toAgenda">${ICONS.back}Agenda</button>
  <section><h1>¿Dónde es el servicio?</h1></section>
  <input id="q" type="search" placeholder="Buscar cliente, sucursal o comuna" data-filter="1" value="${esc(S.q)}">
  <div class="card pick" id="picklist">${cat.clientes.map(c => {
    const ss = cat.sucursales.filter(s => s.cliente_id === c.id); if (!ss.length) return '';
    return `<div data-group><h3>${esc(c.nombre)}</h3>${ss.map(s => `<button data-act="startFree" data-v="${esc(s.id)}" data-text="${esc((c.nombre + ' ' + s.nombre + ' ' + s.comuna).toLowerCase())}">${esc(s.nombre)}<span>${esc(s.comuna || '')}</span></button>`).join('')}</div>`;
  }).join('') || '<p class="muted">No hay clientes cargados en la planilla.</p>'}</div>`;
}

/* ---------- Formulario de servicio ---------- */
function newDraft(su, v) {
  return {uid:uid(), visita_id:v ? v.id : '', sucursal_id:su.id, llegada:nowHM(), termino:'', correo:su.correo || '',
    tipos:v && v.tipo ? [v.tipo] : [], otro:'', reemplazo:'no',
    equipos:eqsOf(su.id).map(e => Object.assign({}, e, {atendido:true, nuevo:false, fotos:{}, aroma_anterior:e.aroma || ''})),
    trabajo:[], resultado:'', obs:'', proxima:addD((S.cat && S.cat.diasProxima) || 30), seguimiento:'no', motivo:'',
    cliente:{nombre:su.encargado || '', rut:'', cargo:''}, firma:null, ausente:false};
}
let draftT;
function saveDraft() {
  clearTimeout(draftT);
  draftT = setTimeout(() => { if (S.draft) idb.put('kv', {draft:S.draft, step:S.step, tecId:tecId()}, 'borrador').catch(() => toast('No se pudo guardar el borrador. Revisa el espacio del teléfono.')); }, 400);
}

function vStep1(d, su, c) {
  return `<div class="card"><p class="eyebrow">Datos del cliente</p><h3 style="margin-top:4px">${esc(c.nombre)}</h3>
    <dl class="kv"><div><dt>RUT</dt><dd>${esc(c.rut) || '—'}</dd></div><div><dt>N° sucursal</dt><dd>${esc([su.numero, su.nombre].filter(Boolean).join(' · '))}</dd></div>
    <div><dt>Dirección</dt><dd>${esc(su.direccion) || '—'}${su.comuna ? ', ' + esc(su.comuna) : ''}</dd></div><div><dt>Encargado</dt><dd>${esc(su.encargado) || '—'}</dd></div>
    <div><dt>Teléfono</dt><dd>${esc(su.telefono) || '—'}</dd></div><div><dt>Horario de atención</dt><dd>${esc(su.horario) || '—'}</dd></div></dl></div>
  <div class="grid2"><div class="field"><label for="f-correo">Correo para el respaldo</label><input id="f-correo" type="email" inputmode="email" data-bind="d.correo" value="${esc(d.correo)}"><span class="hint">La hoja de servicio llegará a este correo. Para varios, sepáralos con coma.</span></div>
    <div class="field"><label for="f-lleg">Hora de llegada</label><input id="f-lleg" type="time" data-bind="d.llegada" value="${esc(d.llegada)}"></div></div>`;
}
function vStep2(d) {
  return `<div class="card stack"><h3>¿Qué tipo de servicio es?</h3><p class="muted small">Puedes marcar más de uno.</p>
    <div class="chips">${TIPOS.map(t => `<button class="chip" data-act="toggle" data-list="tipos" data-v="${esc(t)}" aria-pressed="${d.tipos.includes(t)}">${t}</button>`).join('')}</div>
    ${d.tipos.includes('Otro') ? `<div class="field"><label for="f-otro">Describe el otro tipo</label><input id="f-otro" data-bind="d.otro" value="${esc(d.otro)}"></div>` : ''}</div>
  <div class="card spread"><div><h3>Equipo de reemplazo instalado</h3><p class="muted small">Si dejaste un equipo en reemplazo de otro.</p></div>
    <div class="seg">${[['si','Sí'],['no','No']].map(([k, t]) => `<button data-act="set" data-k="reemplazo" data-v="${k}" aria-pressed="${d.reemplazo === k}">${t}</button>`).join('')}</div></div>`;
}
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function aromaHint(e) {
  const a = String(e.aroma || '').trim(), lista = (S.cat && S.cat.aromas) || [];
  const parts = [];
  if (e.aroma_anterior && a && norm(a) !== norm(e.aroma_anterior)) parts.push(`Cambio de aroma: antes era ${esc(e.aroma_anterior)}.`);
  if (a && lista.length && !lista.some(x => norm(x) === norm(a))) parts.push('Este aroma no está en la lista; se guardará igual.');
  return parts.join(' ');
}
function aromaSuggest(i) {
  const el = document.getElementById('a' + i), box = document.getElementById('sg' + i); if (!el || !box) return;
  const q = norm(el.value), words = q.split(/\s+/).filter(Boolean);
  const lista = (S.cat && S.cat.aromas) || [];
  if (!words.length || document.activeElement !== el) { box.innerHTML = ''; return; }
  const m = lista.filter(a => { const n = norm(a); return words.every(w => n.includes(w)); })
    .sort((a, b) => (norm(b).startsWith(q) - norm(a).startsWith(q)) || a.localeCompare(b, 'es')).slice(0, 12);
  box.innerHTML = m.length && !(m.length === 1 && norm(m[0]) === q)
    ? m.map(a => `<button type="button" class="chip sm" data-act="pickAroma" data-i="${i}" data-v="${esc(a)}">${esc(a)}</button>`).join('')
    : (m.length ? '' : '<span class="hint">Sin coincidencias en la lista.</span>');
}
function vStep3(d) {
  const modelos = (S.cat && S.cat.modelos) || [];
  return `<div class="card"><h3>3 fotos por equipo</h3><p class="muted small" style="margin-top:4px">Por dentro (cómo estaba), cómo quedó y una vista general desde más lejos.</p></div>
  ${d.equipos.map((e, i) => `<article class="card stack eq ${e.atendido ? '' : 'off'}">
    <header class="eq-h"><div style="min-width:0"><span class="eq-n">Equipo ${i + 1}${e.nuevo ? ' · nuevo' : ''}</span><h4>${esc(e.modelo || 'Equipo nuevo')}</h4>
      <p class="muted small">${e.nuevo ? 'Completa los datos del equipo instalado' : `Serie <span class="mono">${esc(e.serie) || '—'}</span> · ${esc(e.ubicacion) || '—'}`}</p></div>
      ${e.nuevo ? `<button class="link small" data-act="delEq" data-v="${i}">Quitar</button>` : `<label class="tog"><input type="checkbox" data-bind="d.equipos.${i}.atendido" data-rerender="1" ${e.atendido ? 'checked' : ''}>Atendido</label>`}</header>
    <div class="eq-body stack">
    ${e.nuevo ? `<div class="grid2">
      <div class="field"><label for="m${i}">Modelo</label><input id="m${i}" list="modelos" data-bind="d.equipos.${i}.modelo" value="${esc(e.modelo)}"></div>
      <div class="field"><label for="c${i}">Color</label><input id="c${i}" data-bind="d.equipos.${i}.color" value="${esc(e.color)}"></div>
      <div class="field"><label for="s${i}">N° de serie</label><input id="s${i}" data-bind="d.equipos.${i}.serie" value="${esc(e.serie)}"></div>
      <div class="field"><label for="u${i}">Ubicación</label><input id="u${i}" data-bind="d.equipos.${i}.ubicacion" value="${esc(e.ubicacion)}" placeholder="ej. Entrada principal"></div></div>` : ''}
    <div class="field"><label for="a${i}">Aroma</label><input id="a${i}" autocomplete="off" autocapitalize="none" spellcheck="false" data-bind="d.equipos.${i}.aroma" data-aroma="${i}" value="${esc(e.aroma)}" placeholder="Escribe para buscar el aroma">
      <div class="sugg" id="sg${i}"></div><span class="hint" id="ah${i}">${aromaHint(e)}</span></div>
    <div class="shots">${FOTOS.map(f => { const v = e.fotos[f.k]; return `<label class="shot ${v ? 'has' : ''}">
      <input class="vh" type="file" accept="image/*" capture="environment" data-photo="${i}:${f.k}">
      ${v ? `<img src="${v}" alt="${f.t}"><span class="cap">${f.t} · cambiar</span>` : `${ICONS.cam}<b>${f.t}</b><span>${f.h}</span>`}</label>`; }).join('')}</div>
    </div></article>`).join('')}
  <datalist id="modelos">${modelos.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
  <button class="btn" data-act="addEq">+ Agregar equipo nuevo</button>`;
}
function vStep4(d) {
  return `<div class="card stack"><h3>Revisión y trabajo realizado</h3>
    <div class="checks">${TRABAJOS.map(t => `<button class="check" data-act="toggle" data-list="trabajo" data-v="${esc(t)}" aria-pressed="${d.trabajo.includes(t)}"><span class="box"></span>${t}</button>`).join('')}</div></div>
  <div class="card stack"><h3>Resultado del servicio</h3><div class="res">
    ${RESULTADOS.map(r => `<button class="check" data-act="set" data-k="resultado" data-v="${r.k}" aria-pressed="${d.resultado === r.k}"><span class="box"></span>${r.t}</button>`).join('')}</div></div>
  <div class="card stack"><div class="field"><label for="f-obs">Resumen del trabajo, anomalías y observaciones</label><textarea id="f-obs" data-bind="d.obs" placeholder="Qué se hizo, qué se encontró y cualquier detalle que el cliente deba saber">${esc(d.obs)}</textarea></div></div>
  <div class="card stack"><h3>Control de mantenciones</h3>
    <div class="grid2"><div class="field"><label for="f-prox">Próxima mantención</label><input id="f-prox" type="date" data-bind="d.proxima" value="${esc(d.proxima)}"></div>
    <div class="field"><span class="lbl">¿Requiere seguimiento?</span><div class="seg">${[['si','Sí'],['no','No']].map(([k, t]) => `<button data-act="set" data-k="seguimiento" data-v="${k}" aria-pressed="${d.seguimiento === k}">${t}</button>`).join('')}</div></div></div>
    ${d.seguimiento === 'si' ? `<div class="field"><label for="f-mot">Motivo / acción pendiente</label><input id="f-mot" data-bind="d.motivo" value="${esc(d.motivo)}"></div>` : ''}</div>`;
}
function vStep5(d) {
  return `<div class="card stack"><h3>Firma del cliente</h3>
    <label class="tog"><input type="checkbox" data-bind="d.ausente" data-rerender="1" ${d.ausente ? 'checked' : ''}>Cliente ausente / firma no disponible</label>
    ${d.ausente ? `<p class="hint-box">La visita queda respaldada con las fotos de cada equipo. En la hoja aparecerá “Cliente ausente”.</p>` : `
    <div class="grid2"><div class="field"><label for="f-cn">Nombre</label><input id="f-cn" data-bind="d.cliente.nombre" value="${esc(d.cliente.nombre)}"></div>
      <div class="field"><label for="f-cr">RUT</label><input id="f-cr" data-fmt="rut" data-bind="d.cliente.rut" value="${esc(d.cliente.rut)}" placeholder="12.345.678-9"></div>
      <div class="field"><label for="f-cc">Cargo</label><input id="f-cc" data-bind="d.cliente.cargo" value="${esc(d.cliente.cargo)}" placeholder="ej. Jefe de tienda"></div></div>
    <div class="field"><div class="spread"><span class="lbl">Firma</span><button class="link" data-act="clearSig">Borrar firma</button></div>
      <div class="sigwrap"><canvas id="sig" class="sig" aria-label="Recuadro para firmar"></canvas><div class="sigph" id="sigph" ${d.firma ? 'hidden' : ''}>Firme aquí con el dedo</div></div></div>`}
  </div>
  <div class="card stack"><h3>Técnico responsable</h3>
    <div class="spread"><div><b>${esc(S.ses.tecnico.nombre)}</b><p class="muted small">Tu firma registrada se agrega automáticamente.</p></div>
    <div class="field" style="max-width:160px"><label for="f-ter">Hora de término</label><input id="f-ter" type="time" data-bind="d.termino" value="${esc(d.termino)}"></div></div></div>`;
}
function vForm() {
  const d = S.draft, su = suc(d.sucursal_id) || {nombre:'Sucursal'}, c = cli(su.cliente_id);
  const body = [vStep1, vStep2, vStep3, vStep4, vStep5][S.step - 1](d, su, c);
  return `<section class="form-head"><button class="back" data-act="pauseForm">${ICONS.back}Agenda</button>
    <div><p class="eyebrow">Paso ${S.step} de 5 · ${STEPS[S.step - 1]}</p><h1 style="margin-top:2px">${esc(su.nombre)}</h1></div>
    <div class="steps">${STEPS.map((_, i) => `<i class="${i < S.step ? 'on' : ''}"></i>`).join('')}</div></section>${body}`;
}
function barForm() {
  return `<div class="formbar"><div class="formbar-in">${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
    <div class="row">${S.step > 1 ? '<button class="btn" data-act="prev">Atrás</button>' : ''}
    ${S.step < 5 ? '<button class="btn primary" data-act="next">Siguiente</button>' : '<button class="btn lime" data-act="close">Cerrar servicio</button>'}</div></div></div>`;
}
function validate() {
  const d = S.draft;
  if (S.step === 1) {
    const ms = d.correo.split(',').map(x => x.trim()).filter(Boolean);
    if (!ms.length || ms.some(m => !/^\S+@\S+\.\S+$/.test(m))) return 'Revisa el correo para el respaldo: falta o no es válido.';
    if (!d.llegada) return 'Falta la hora de llegada.';
  }
  if (S.step === 2) { if (!d.tipos.length) return 'Marca al menos un tipo de asistencia.'; if (d.tipos.includes('Otro') && !d.otro.trim()) return 'Describe el tipo “Otro”.'; }
  if (S.step === 3) {
    if (!d.equipos.some(e => e.atendido)) return 'Agrega o marca al menos un equipo como atendido.';
    for (const [i, e] of d.equipos.entries()) {
      if (!e.atendido) continue;
      if (e.nuevo && (!e.modelo.trim() || !e.ubicacion.trim())) return `Equipo ${i + 1}: falta el modelo o la ubicación.`;
      if (!String(e.aroma || '').trim()) return `Equipo ${i + 1}: falta el aroma.`;
      const miss = FOTOS.filter(f => !e.fotos[f.k]).map(f => f.t.toLowerCase());
      if (miss.length) return `Equipo ${i + 1}: falta${miss.length > 1 ? 'n' : ''} la foto${miss.length > 1 ? 's' : ''} ${miss.join(', ')}.`;
    }
  }
  if (S.step === 4) { if (!d.trabajo.length) return 'Marca el trabajo realizado.'; if (!d.resultado) return 'Elige el resultado del servicio.'; if (d.seguimiento === 'si' && !d.motivo.trim()) return 'Indica el motivo del seguimiento.'; }
  if (S.step === 5 && !d.ausente) { if (!d.cliente.nombre.trim()) return 'Falta el nombre de quien firma.'; if (!d.firma) return 'Falta la firma del cliente, o marca “Cliente ausente”.'; }
  return '';
}

function vDone() {
  const x = itemsLocales().find(i => i.uid === S.lastUid);
  if (!x) return vAgenda();
  const ok = x.estado === 'enviado';
  const sending = !ok && S.syncing;
  return `<div class="card stack done-hero"><div class="done-ic ${ok ? '' : 'warn'}">${ok ? ICONS.check : ICONS.phone}</div>
    <p class="eyebrow">${osNum(x.os)}</p><h1>Servicio cerrado</h1>
    <p class="muted" style="max-width:46ch">${ok ? `El respaldo se envió a <b>${esc(x.servicio.correo)}</b> y quedó guardado en Drive.`
      : sending ? 'Enviando el respaldo al cliente…' : `Quedó guardado en el teléfono. Se enviará a <b>${esc(x.servicio.correo)}</b> apenas haya señal.`}</p>
    ${ok && x.correo && !/^(Enviado|Reenviado)/.test(x.correo) ? `<p class="err">${esc(x.correo)}</p>` : ''}
    <div class="row" style="justify-content:center"><button class="btn lime" data-act="share" data-id="${x.uid}">Compartir PDF</button><button class="btn" data-act="download" data-id="${x.uid}">Descargar PDF</button></div>
    <button class="btn primary" data-act="toAgenda">Volver a la agenda</button></div>
  <p class="footnote">Compartir abre WhatsApp, correo u otras apps del teléfono. El correo automático al cliente sale igual.</p>`;
}

/* ---------- Panel de administración ---------- */
function vAdmLogin() {
  return `<form class="login card" data-submit="admLogin">
  <img src="${ECO_LOGO}" class="login-logo" alt="Ecoesencias">
  <h1>Administración</h1><p class="muted">Panel de servicios, agenda y técnicos.</p>
  ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
  <div class="field"><label for="au">Usuario</label><input id="au" autocapitalize="none" data-bind="f.adm.u" value="${esc(S.form.adm.u)}"></div>
  <div class="field"><label for="ap2">PIN</label><input id="ap2" type="password" inputmode="numeric" data-bind="f.adm.p" value="${esc(S.form.adm.p)}"></div>
  <button class="btn primary block" type="submit">Ingresar</button>
  <button type="button" class="link" data-act="toLogin">Volver al ingreso de técnicos</button></form>`;
}
const A = () => S.adm.data;
const aSuc = id => A().sucursales.find(s => s.id === id) || {nombre:id, cliente_id:''};
const aCli = id => A().clientes.find(c => c.id === id) || {nombre:''};
const aTec = id => A().tecnicos.find(t => t.id === id) || {nombre:id};
function ultimoPorSucursal() {
  const m = {};
  A().servicios.forEach(s => { if (!m[s.sucursal_id] || s.os > m[s.sucursal_id].os) m[s.sucursal_id] = s; });
  return m;
}
function vAdmResumen() {
  const d = A(), mes = hoy().slice(0, 7);
  const delMes = d.servicios.filter(s => String(s.fecha).slice(0, 7) === mes);
  const porFact = d.servicios.filter(s => !s.factura_enviada);
  const errs = d.servicios.filter(s => /^Error/.test(s.estado_correo));
  const attn = d.servicios.filter(s => !/^Conforme/.test(s.resultado) || s.seguimiento === 'SI').sort((a, b) => b.os - a.os).slice(0, 8);
  const ult = ultimoPorSucursal();
  const prox = Object.values(ult).filter(s => s.proxima && daysFrom(s.proxima) <= 15).sort((a, b) => String(a.proxima).localeCompare(String(b.proxima)));
  return `<div class="kpis"><div class="card kpi"><b>${delMes.length}</b><span>Servicios este mes</span></div>
    <div class="card kpi ${porFact.length ? 'attn' : ''}"><b>${porFact.length}</b><span>Sin factura enviada</span></div>
    <div class="card kpi ${prox.length ? 'attn' : ''}"><b>${prox.length}</b><span>Mantenciones en los próximos 15 días</span></div>
    <div class="card kpi ${errs.length ? 'attn' : ''}"><b>${errs.length}</b><span>Correos con error</span></div></div>
  <div class="cols">
    <div class="card"><h2>Requiere atención</h2><div class="list" style="margin-top:6px">${attn.length ? attn.map(s => `<div class="li"><div><b>${esc(s.sucursal)}</b> <span class="muted small mono">${osNum(s.os)}</span>
      <p class="muted small">${dmy(s.fecha)} · ${esc(s.motivo || s.obs || '')}</p></div><div class="stack" style="align-items:flex-end;gap:6px">${pillRes(s.resultado)}<a class="link small" href="${esc(s.pdf)}" target="_blank" rel="noopener">Ver PDF</a></div></div>`).join('') : '<p class="muted">Todo en orden.</p>'}</div></div>
    <div class="card"><h2>Mantenciones por vencer</h2><div class="list" style="margin-top:6px">${prox.length ? prox.map(s => { const df = daysFrom(s.proxima);
      return `<div class="li"><div><b>${esc(s.sucursal)}</b><p class="muted small">${esc(s.cliente)} · ${dmy(s.proxima)}</p></div>
      <span class="pill ${df < 0 ? 'bad' : df <= 5 ? 'warn' : 'info'}">${df < 0 ? `Vencida hace ${-df} d` : df === 0 ? 'Hoy' : `En ${df} días`}</span></div>`; }).join('') : '<p class="muted">Ninguna en los próximos 15 días.</p>'}</div></div>
  </div><p class="footnote">Correos disponibles hoy: ${d.cuota}</p>`;
}
function vAdmServicios() {
  const a = S.adm;
  let list = A().servicios.slice().sort((x, y) => y.os - x.os);
  if (a.fTec) list = list.filter(s => s.tecnico_id === a.fTec);
  if (a.fCli) list = list.filter(s => aSuc(s.sucursal_id).cliente_id === a.fCli);
  return `<div class="grid2"><div class="field"><label for="ft">Técnico</label><select id="ft" data-adm="fTec"><option value="">Todos</option>${A().tecnicos.map(t => `<option value="${esc(t.id)}" ${a.fTec === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="fc">Cliente</label><select id="fc" data-adm="fCli"><option value="">Todos</option>${A().clientes.map(c => `<option value="${esc(c.id)}" ${a.fCli === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div></div>
  <div class="card" style="padding:6px 8px"><div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Orden</th><th>Sucursal</th><th>Técnico</th><th>Resultado</th><th>Correo</th><th>Factura creada</th><th>Factura enviada</th><th></th></tr></thead><tbody>
  ${list.length ? list.map(s => `<tr><td>${dmy(s.fecha)}</td><td class="mono">${osNum(s.os)}</td><td><b>${esc(s.sucursal)}</b><br><span class="muted small">${esc(s.cliente)}</span></td>
    <td>${esc(s.tecnico)}</td><td>${pillRes(s.resultado)}</td><td>${pillCorreo(s.estado_correo)}</td>
    <td><input type="checkbox" aria-label="Factura creada" data-fact="${s.os}:creada" ${s.factura_creada ? 'checked' : ''}></td>
    <td><input type="checkbox" aria-label="Factura enviada" data-fact="${s.os}:enviada" ${s.factura_enviada ? 'checked' : ''}></td>
    <td><div class="row" style="flex-wrap:nowrap"><a class="btn sm" href="${esc(s.pdf)}" target="_blank" rel="noopener">PDF</a><a class="btn sm" href="${esc(s.carpeta)}" target="_blank" rel="noopener">Fotos</a>
      <button class="btn sm" data-act="resend" data-v="${s.os}">${S.armed['r' + s.os] ? '¿Reenviar?' : 'Reenviar'}</button></div></td></tr>`).join('') : '<tr><td colspan="9" class="muted">Aún no hay servicios registrados.</td></tr>'}
  </tbody></table></div></div>`;
}
function vAdmAgenda() {
  const f = S.form.vis, d = A();
  if (!f.cliente_id && d.clientes[0]) f.cliente_id = d.clientes[0].id;
  const sucs = d.sucursales.filter(s => s.cliente_id === f.cliente_id);
  if (!sucs.some(s => s.id === f.sucursal_id)) f.sucursal_id = sucs[0] ? sucs[0].id : '';
  const activos = d.tecnicos.filter(t => t.activo);
  if (!activos.some(t => t.id === f.tecnico_id)) f.tecnico_id = activos[0] ? activos[0].id : '';
  const up = d.visitas.filter(v => daysFrom(v.fecha) >= 0).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const days = [...new Set(up.map(v => v.fecha))];
  return `<div class="card stack"><h2>Programar visita</h2><div class="grid2">
    <div class="field"><label for="vc">Cliente</label><select id="vc" data-bind="f.vis.cliente_id" data-rerender="1">${d.clientes.map(c => `<option value="${esc(c.id)}" ${f.cliente_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="vs">Sucursal</label><select id="vs" data-bind="f.vis.sucursal_id">${sucs.map(s => `<option value="${esc(s.id)}" ${f.sucursal_id === s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="vt">Técnico</label><select id="vt" data-bind="f.vis.tecnico_id">${activos.map(t => `<option value="${esc(t.id)}" ${f.tecnico_id === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="vf">Fecha</label><input id="vf" type="date" data-bind="f.vis.fecha" value="${esc(f.fecha)}"></div>
    <div class="field"><label for="vy">Tipo</label><select id="vy" data-bind="f.vis.tipo">${TIPOS.filter(t => t !== 'Otro').map(t => `<option ${f.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <button class="btn primary" style="align-self:flex-start" data-act="addVis">Agregar a la agenda</button></div>
  ${days.length ? days.map(dd => { const vs = up.filter(v => v.fecha === dd); const df = daysFrom(dd);
    return `<div class="card"><div class="spread"><h2>${df === 0 ? 'Hoy' : df === 1 ? 'Mañana' : shortD(dd)}</h2><span class="muted small">${longD(dd)}</span></div><div class="list" style="margin-top:6px">
    ${vs.map(v => { const s = aSuc(v.sucursal_id);
      return `<div class="li"><div><b>${esc(s.nombre)}</b><p class="muted small">${esc(aCli(s.cliente_id).nombre)} · ${esc(v.tipo)} · ${esc(aTec(v.tecnico_id).nombre)}</p></div>
      ${v.estado === 'completada' ? `<span class="pill ok"><i></i>${esc(v.os || 'Completada')}</span>` : `<button class="btn sm" data-act="delVis" data-v="${esc(v.id)}">${S.armed['v' + v.id] ? '¿Quitar?' : 'Quitar'}</button>`}</div>`; }).join('')}</div></div>`; }).join('') : '<p class="muted">No hay visitas programadas.</p>'}`;
}
function vAdmTecnicos() {
  const f = S.form.tec;
  return `<div class="card stack"><h2>Agregar técnico</h2><p class="muted small">No necesita correo. Entra con usuario y PIN desde su celular.</p>
    <div class="grid2"><div class="field"><label for="tn">Nombre completo</label><input id="tn" data-bind="f.tec.nombre" value="${esc(f.nombre)}"></div>
    <div class="field"><label for="tu">Usuario</label><input id="tu" autocapitalize="none" data-bind="f.tec.usuario" value="${esc(f.usuario)}" placeholder="Si lo dejas vacío se crea solo"></div>
    <div class="field"><label for="tp">PIN</label><div class="row" style="flex-wrap:nowrap"><input id="tp" inputmode="numeric" maxlength="6" data-bind="f.tec.pin" value="${esc(f.pin)}" placeholder="4 a 6 números"><button class="btn sm" data-act="genPin">Generar</button></div></div></div>
    <button class="btn primary" style="align-self:flex-start" data-act="addTec">Agregar técnico</button></div>
  <div class="card"><h2>Equipo técnico</h2><div class="list" style="margin-top:6px">
  ${A().tecnicos.map(t => { const n = A().servicios.filter(s => s.tecnico_id === t.id).length; const show = S.adm.showPin[t.id];
    return `<div class="li"><div><b>${esc(t.nombre)}</b> ${t.activo ? '' : '<span class="pill">Inactivo</span>'}
      <p class="muted small">Usuario <span class="mono">${esc(t.usuario)}</span> · PIN <span class="mono">${show ? esc(t.pin) : '••••'}</span> <button class="link small" data-act="showPin" data-v="${esc(t.id)}">${show ? 'Ocultar' : 'Ver'}</button> · ${n} servicios</p></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="newPin" data-v="${esc(t.id)}">${S.armed['p' + t.id] ? '¿Nuevo PIN?' : 'Nuevo PIN'}</button>
      <button class="btn sm" data-act="tecActivo" data-v="${esc(t.id)}">${t.activo ? 'Desactivar' : 'Activar'}</button></div></div>`; }).join('')}</div></div>`;
}
function vAdmClientes() {
  const ult = ultimoPorSucursal();
  return `<p class="hint-box">Para agregar o editar clientes, sucursales y equipos, usa la planilla. Los cambios llegan a los técnicos la próxima vez que abran la app con señal.</p>` +
    A().clientes.map(c => { const sucs = A().sucursales.filter(s => s.cliente_id === c.id);
    return `<div class="card stack"><div class="spread"><div><h2>${esc(c.nombre)}</h2><p class="muted small">RUT ${esc(c.rut)}</p></div><span class="pill">${sucs.length} sucursales</span></div>
    <div class="scroll"><table class="tbl" style="min-width:640px"><thead><tr><th>Sucursal</th><th>Encargado</th><th>Correo de respaldo</th><th>Equipos</th><th>Último servicio</th></tr></thead><tbody>
    ${sucs.map(s => { const l = ult[s.id]; return `<tr><td><b>${esc(s.nombre)}</b><br><span class="muted small">${esc(s.comuna)}</span></td><td>${esc(s.encargado)}</td>
      <td>${esc(s.correo) || '—'}${s.enviar_correo ? '' : '<br><span class="pill">Sin correo automático</span>'}</td><td>${A().equipos.filter(e => e.sucursal_id === s.id).length}</td><td>${l ? dmy(l.fecha) + ' · ' + osNum(l.os) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`; }).join('');
}
function vAdmin() {
  const tabs = [['resumen','Resumen'],['servicios','Servicios'],['agenda','Agenda'],['tecnicos','Técnicos'],['clientes','Clientes']];
  const body = {resumen:vAdmResumen, servicios:vAdmServicios, agenda:vAdmAgenda, tecnicos:vAdmTecnicos, clientes:vAdmClientes}[S.adm.tab]();
  return `<section class="portal-head"><div><p class="eyebrow">Administración</p><h1>Servicio técnico</h1></div>
    <div class="row"><a class="btn sm" href="${esc(A().planilla)}" target="_blank" rel="noopener">Abrir planilla</a><a class="btn sm" href="${esc(A().carpeta)}" target="_blank" rel="noopener">Respaldos en Drive</a>
    <button class="btn sm" data-act="admRefresh">Actualizar</button><button class="btn sm" data-act="admLogout">Salir</button></div></section>
  <nav class="tabs">${tabs.map(([k, t]) => `<button data-act="tab" data-v="${k}" aria-pressed="${S.adm.tab === k}">${t}</button>`).join('')}</nav>${body}`;
}

/* ---------- Render ---------- */
function render() {
  renderTop();
  const app = $('#app'); let html = '', bar = '';
  app.className = S.view === 'admin' ? 'wide' : '';
  if (S.view === 'setup') html = vSetup();
  else if (S.view === 'login') html = vLogin();
  else if (S.view === 'adminLogin') html = vAdmLogin();
  else if (S.view === 'admin') html = A() ? vAdmin() : '<p class="muted">Cargando panel…</p>';
  else if (!S.ses) { S.view = 'login'; html = vLogin(); }
  else if (S.view === 'firmaTec') html = vFirmaTec();
  else if (S.view === 'pick') html = vPick();
  else if (S.view === 'form' && S.draft) { html = vForm(); bar = barForm(); }
  else if (S.view === 'done') html = vDone();
  else { S.view = 'agenda'; html = vAgenda(); }
  app.innerHTML = html; $('#bar').innerHTML = bar; renderToast();
  if ((S.view === 'form' && S.step === 5 && !S.draft.ausente) || S.view === 'firmaTec') initSig();
  if (S.view === 'pick') filterPick();
}
function renderToast() { $('#toast').innerHTML = S.toast ? `<div>${esc(S.toast)}</div>` : ''; }
function filterPick() {
  const q = (S.q || '').trim().toLowerCase();
  document.querySelectorAll('#picklist [data-group]').forEach(g => {
    let any = false;
    g.querySelectorAll('button').forEach(b => { const ok = !q || b.dataset.text.includes(q); b.hidden = !ok; any = any || ok; });
    g.hidden = !any;
  });
}

/* ---------- Firma en pantalla ---------- */
let sigTarget = null;
function initSig() {
  const c = document.getElementById('sig'); if (!c) return;
  const r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = r.width * dpr; c.height = r.height * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = g.fillStyle = '#1D2520';
  const existing = S.view === 'form' ? S.draft.firma : null;
  if (existing) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, r.width, r.height); im.src = existing; }
  sigTarget = null;
  let on = false, last = null;
  const pt = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { on = true; last = pt(e); c.setPointerCapture(e.pointerId); g.beginPath(); g.arc(last[0], last[1], 1.2, 0, 7); g.fill(); const p = $('#sigph'); if (p) p.hidden = true; };
  c.onpointermove = e => { if (!on) return; const p = pt(e); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke(); last = p; };
  const end = () => {
    if (!on) return; on = false;
    const url = c.toDataURL('image/png');
    if (S.view === 'form') { S.draft.firma = url; saveDraft(); } else sigTarget = url;
  };
  c.onpointerup = end; c.onpointercancel = end;
}

function compress(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => { const k = Math.min(1, 1280 / Math.max(im.width, im.height)); const w = Math.round(im.width * k), h = Math.round(im.height * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .72)); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); }; im.src = url;
  });
}

/* ---------- PDF: compartir y descargar ---------- */
function pdfFile(x) {
  const b = atob(x.pdf); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  const name = `${osNum(x.os)} ${String(x.sucursal).replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
  return new File([u], name, {type:'application/pdf'});
}
function bytesToB64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
function download(file) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- Acciones ---------- */
const scrollTop = () => window.scrollTo({top:0});
function setPath(p, v) {
  const [r, ...ks] = p.split('.'); let o = r === 'd' ? S.draft : S.form; const last = ks.pop();
  for (const k of ks) o = o[k]; o[last] = v;
}
async function admOp(op, params, okMsg) {
  busy('Guardando…');
  try { const r = await api('admin_op', Object.assign({token:S.adm.token, op}, params)); delete r.ok; S.adm.data = r; render(); if (okMsg) toast(okMsg); }
  catch (e) { if (/^SESION/.test(e.message)) { S.adm.token = null; S.view = 'adminLogin'; S.err = 'La sesión de administración venció. Vuelve a ingresar.'; render(); } else toast(cleanMsg(e.message)); }
  finally { busy(''); }
}

const ACT = {
  async saveApi() {
    const u = (S.form.api || '').trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { S.err = 'La dirección debe empezar con https://script.google.com/ y terminar en /exec.'; return render(); }
    busy('Probando conexión…');
    try { const r = await fetch(u); const j = await r.json(); if (!j.ok) throw 0; ls.set('api', u); S.err = ''; S.view = 'login'; toast('Conexión lista.'); }
    catch (e) { S.err = 'No pude conectar con esa dirección. Revisa que la implementación sea para “Cualquier persona”.'; }
    busy(''); render();
  },
  toSetup() { S.err = ''; S.view = 'setup'; render(); },
  toLogin() { S.err = ''; S.view = 'login'; render(); },
  toAdminLogin() { S.err = ''; S.view = 'adminLogin'; render(); },
  async login() {
    const {u, p} = S.form.login;
    if (!u.trim() || !p.trim()) { S.err = 'Escribe tu usuario y PIN.'; return render(); }
    if (!navigator.onLine) { S.err = 'Necesitas señal para ingresar.'; return render(); }
    busy('Ingresando…');
    try {
      const r = await api('login', {usuario:u, pin:p});
      S.ses = {token:r.token, tecnico:r.tecnico}; ls.set('ses', S.ses);
      addOsBlock(r.osBlock); ['ok','token','tecnico','osBlock'].forEach(k => delete r[k]); S.cat = r; ls.set('cat', r);
      S.form.login = {u:'', p:''}; S.err = '';
      await loadQueues();
      const b = await idb.get('kv', 'borrador'); S.borrador = b && b.tecId === tecId() ? b : null;
      S.view = firmaTec() ? 'agenda' : 'firmaTec';
      busy(''); render(); syncCola();
    } catch (e) { busy(''); S.err = cleanMsg(e.message); render(); }
  },
  logout() { if (!arm('logout')) return; S.ses = null; ls.del('ses'); S.borrador = null; S.view = 'login'; render(); },
  saveFirmaTec() { if (!sigTarget) { S.err = 'Firma en el recuadro antes de guardar.'; return render(); } ls.set('firma.' + tecId(), sigTarget); S.err = ''; S.view = 'agenda'; toast('Firma guardada.'); render(); },
  redoFirma() { S.view = 'firmaTec'; render(); scrollTop(); },
  clearSig() { if (S.view === 'form') { S.draft.firma = null; saveDraft(); } sigTarget = null; render(); },
  sync() { syncCola(); },
  toPick() { S.q = ''; S.view = 'pick'; render(); scrollTop(); },
  toAgenda() { S.view = 'agenda'; S.err = ''; render(); scrollTop(); refreshCatalog(true); },
  start(t) {
    const v = S.cat.visitas.find(x => x.id === t.dataset.v); const su = v && suc(v.sucursal_id);
    if (!su) return toast('Esa sucursal ya no está en la planilla. Pide a la administración que la revise.');
    if (S.borrador) return toast('Primero termina o descarta el servicio sin terminar.');
    S.draft = newDraft(su, v); S.step = 1; S.err = ''; S.view = 'form'; saveDraft(); render(); scrollTop();
  },
  startFree(t) {
    if (S.borrador) return toast('Primero termina o descarta el servicio sin terminar.');
    S.draft = newDraft(suc(t.dataset.v), null); S.step = 1; S.err = ''; S.view = 'form'; saveDraft(); render(); scrollTop();
  },
  resumeDraft() { S.draft = S.borrador.draft; S.step = S.borrador.step || 1; S.borrador = null; S.err = ''; S.view = 'form'; render(); scrollTop(); },
  async discardDraft() { if (!arm('discard')) return; await idb.del('kv', 'borrador'); S.borrador = null; render(); },
  async pauseForm() {
    await idb.put('kv', {draft:S.draft, step:S.step, tecId:tecId()}, 'borrador');
    S.borrador = {draft:S.draft, step:S.step, tecId:tecId()}; S.draft = null; S.err = ''; S.view = 'agenda'; render(); scrollTop();
  },
  toggle(t) { const l = S.draft[t.dataset.list], v = t.dataset.v; const i = l.indexOf(v); i < 0 ? l.push(v) : l.splice(i, 1); S.err = ''; saveDraft(); render(); },
  set(t) { S.draft[t.dataset.k] = t.dataset.v; S.err = ''; saveDraft(); render(); },
  next() { const e = validate(); S.err = e; if (!e) { S.step++; if (S.step === 5 && !S.draft.termino) S.draft.termino = nowHM(); saveDraft(); scrollTop(); } render(); },
  prev() { S.err = ''; S.step--; saveDraft(); render(); scrollTop(); },
  addEq() { S.draft.equipos.push({id:'nuevo-' + uid().slice(0, 8), sucursal_id:S.draft.sucursal_id, modelo:'', color:'', serie:'', aroma:'', ubicacion:'', atendido:true, nuevo:true, fotos:{}, aroma_anterior:''}); saveDraft(); render(); },
  pickAroma(t) {
    const i = +t.dataset.i, v = t.dataset.v, el = document.getElementById('a' + i);
    S.draft.equipos[i].aroma = v; if (el) el.value = v;
    const box = document.getElementById('sg' + i); if (box) box.innerHTML = '';
    const h = document.getElementById('ah' + i); if (h) h.innerHTML = aromaHint(S.draft.equipos[i]);
    saveDraft();
  },
  delEq(t) { S.draft.equipos.splice(+t.dataset.v, 1); saveDraft(); render(); },
  async close() {
    const e = validate(); if (e) { S.err = e; return render(); }
    const d = S.draft; if (!d.termino) d.termino = nowHM();
    const su = suc(d.sucursal_id), c = cli(su.cliente_id);
    const firma = firmaTec();
    if (!firma) { S.err = 'Primero registra tu firma (desde la agenda, “Cambiar mi firma”).'; return render(); }
    const os = takeOs();
    if (!os) { S.err = 'Este teléfono no tiene números de orden disponibles. Conéctate a internet un momento y vuelve a intentar.'; refreshCatalog(true); return render(); }
    busy('Generando la hoja de servicio…');
    try {
      const s = Object.assign({}, JSON.parse(JSON.stringify(d)), {os, fecha:hoy(), firma:d.ausente ? null : d.firma, correo:d.correo.split(',').map(x => x.trim()).filter(Boolean).join(', ')});
      s.equipos = s.equipos.filter(q => q.atendido || !q.nuevo);
      const bytes = await EcoPDF.build(s, {osTxt:osNum(os), logo:ECO_LOGO, sucursal:su, cliente:c, tecnico:S.ses.tecnico.nombre, firmaTecnico:firma});
      const item = {uid:s.uid, os, tecId:tecId(), creado:Date.now(), fecha:s.fecha, sucursal:su.nombre, cliente:c.nombre, servicio:s, pdf:bytesToB64(bytes), estado:'pendiente'};
      await idb.put('cola', item);
      await idb.del('kv', 'borrador');
      if (S.cat) { const v = S.cat.visitas.find(x => x.id === d.visita_id); if (v) { v.estado = 'completada'; v.os = osNum(os); ls.set('cat', S.cat); } }
      S.draft = null; S.err = ''; S.lastUid = item.uid; S.view = 'done';
      await loadQueues(); busy(''); render(); scrollTop();
      syncCola();
    } catch (err) {
      busy(''); S.err = 'No se pudo generar el PDF (' + err.message + '). Tus datos siguen guardados; intenta de nuevo.'; render();
    }
  },
  async share(t) {
    const x = itemsLocales().find(i => i.uid === t.dataset.id); if (!x) return;
    const f = pdfFile(x);
    if (navigator.canShare && navigator.canShare({files:[f]})) {
      try { await navigator.share({files:[f], title:'Hoja de servicio ' + osNum(x.os), text:`Hoja de servicio ${osNum(x.os)} · ${x.sucursal}`}); }
      catch (e) { if (e.name !== 'AbortError') download(f); }
    } else { download(f); toast('Este navegador no permite compartir archivos. Se descargó el PDF.'); }
  },
  download(t) { const x = itemsLocales().find(i => i.uid === t.dataset.id); if (x) download(pdfFile(x)); },

  /* administración */
  async admLogin() {
    const {u, p} = S.form.adm;
    if (!navigator.onLine) { S.err = 'Necesitas conexión para entrar al panel.'; return render(); }
    busy('Ingresando…');
    try { const r = await api('admin_login', {usuario:u, pin:p}); S.adm.token = r.token; try { sessionStorage.setItem('eco.adm', r.token); } catch (e) {}
      delete r.ok; delete r.token; S.adm.data = r; S.form.adm = {u:'', p:''}; S.err = ''; S.view = 'admin'; }
    catch (e) { S.err = cleanMsg(e.message); }
    busy(''); render();
  },
  async admRefresh() {
    busy('Actualizando…');
    try { const r = await api('admin_datos', {token:S.adm.token}); delete r.ok; S.adm.data = r; render(); }
    catch (e) { if (/^SESION/.test(e.message)) { S.view = 'adminLogin'; S.err = 'La sesión venció. Vuelve a ingresar.'; render(); } else toast(cleanMsg(e.message)); }
    busy('');
  },
  admLogout() { S.adm = {token:null, data:null, tab:'resumen', fTec:'', fCli:'', showPin:{}}; try { sessionStorage.removeItem('eco.adm'); } catch (e) {} S.view = S.ses ? 'agenda' : 'login'; render(); },
  tab(t) { S.adm.tab = t.dataset.v; render(); },
  showPin(t) { S.adm.showPin[t.dataset.v] = !S.adm.showPin[t.dataset.v]; render(); },
  genPin() { S.form.tec.pin = String(1000 + Math.floor(Math.random() * 9000)); render(); },
  addTec() {
    const f = S.form.tec, nombre = f.nombre.trim(), partes = nombre.split(/\s+/);
    if (partes.length < 2) return toast('Escribe nombre y apellido.');
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const usuario = norm(f.usuario) || norm(partes[0][0] + partes[1]);
    const pin = /^\d{4,6}$/.test(f.pin) ? f.pin : String(1000 + Math.floor(Math.random() * 9000));
    S.form.tec = {nombre:'', usuario:'', pin:''};
    admOp('tecnico_add', {nombre, usuario, pin}, `${nombre} agregado. Usuario: ${usuario} · PIN: ${pin}`);
  },
  tecActivo(t) { const x = aTec(t.dataset.v); admOp('tecnico_estado', {id:x.id, activo:!x.activo}, x.activo ? `${x.nombre} ya no puede ingresar. Su historial se mantiene.` : `${x.nombre} puede volver a ingresar.`); },
  newPin(t) { if (!arm('p' + t.dataset.v)) return; const pin = String(1000 + Math.floor(Math.random() * 9000)); S.adm.showPin[t.dataset.v] = true; admOp('tecnico_pin', {id:t.dataset.v, pin}, `Nuevo PIN: ${pin}`); },
  addVis() {
    const f = S.form.vis;
    if (!f.sucursal_id || !f.tecnico_id) return toast('Elige sucursal y técnico.');
    if (!f.fecha || daysFrom(f.fecha) < 0) return toast('Elige una fecha de hoy en adelante.');
    admOp('visita_add', {fecha:f.fecha, sucursal_id:f.sucursal_id, tecnico_id:f.tecnico_id, tipo:f.tipo}, `Visita agregada a la agenda de ${aTec(f.tecnico_id).nombre}.`);
  },
  delVis(t) { if (!arm('v' + t.dataset.v)) return; admOp('visita_del', {id:t.dataset.v}, 'Visita quitada de la agenda.'); },
  resend(t) { if (!arm('r' + t.dataset.v)) return; admOp('reenviar', {os:Number(t.dataset.v)}, 'Respaldo reenviado al cliente.'); }
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'BUTTON' && t.type !== 'submit') e.preventDefault();
  if (ACT[t.dataset.act]) ACT[t.dataset.act](t, e);
});
document.addEventListener('submit', e => { e.preventDefault(); const a = e.target.dataset.submit; if (ACT[a]) ACT[a](e.target, e); });
function onBind(e) {
  const el = e.target;
  if (el.dataset.filter) { S.q = el.value; filterPick(); return; }
  if (el.dataset.adm && e.type === 'change') { S.adm[el.dataset.adm] = el.value; return render(); }
  if (el.dataset.fact && e.type === 'change') { const [os, campo] = el.dataset.fact.split(':'); admOp('factura', {os:Number(os), campo, valor:el.checked}); return; }
  const p = el.dataset.bind; if (!p) return;
  if (el.type === 'checkbox' && e.type !== 'change') return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.fmt === 'rut') { v = fmtRut(v); if (el.value !== v) el.value = v; }
  setPath(p, v);
  if (p.startsWith('d.')) saveDraft();
  if (el.dataset.aroma !== undefined) { if (e.type === 'input') aromaSuggest(+el.dataset.aroma); const h = document.getElementById('ah' + el.dataset.aroma); if (h) h.innerHTML = aromaHint(S.draft.equipos[+el.dataset.aroma]); }
  if (el.dataset.rerender && e.type === 'change') render();
}
document.addEventListener('input', onBind);
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-act=pickAroma]')) e.preventDefault(); });
document.addEventListener('focusin', e => { const el = e.target; if (el.dataset && el.dataset.aroma !== undefined) { try { el.select(); } catch (x) {} } });
document.addEventListener('focusout', e => { const el = e.target; if (el.dataset && el.dataset.aroma !== undefined) setTimeout(() => { const b = document.getElementById('sg' + el.dataset.aroma); if (b && document.activeElement !== el) b.innerHTML = ''; }, 250); });
document.addEventListener('change', async e => {
  onBind(e);
  const el = e.target; if (!el.dataset.photo || !el.files || !el.files[0]) return;
  const [i, k] = el.dataset.photo.split(':');
  busy('Procesando foto…');
  try { const url = await compress(el.files[0]); S.draft.equipos[+i].fotos[k] = url; S.err = ''; saveDraft(); render(); }
  catch (err) { toast('No se pudo leer esa imagen. Prueba sacando la foto de nuevo.'); }
  busy('');
});

/* ---------- Inicio ---------- */
(async function boot() {
  try { await idbOpen(); } catch (e) { $('#app').innerHTML = '<p class="err">Este navegador no permite guardar datos. Abre la app en Chrome o Safari, fuera del modo incógnito.</p>'; return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await loadQueues();
  if (!apiUrl()) S.view = 'setup';
  else if (S.adm.token) { S.view = 'admin'; ACT.admRefresh(); }
  else if (S.ses) {
    const b = await idb.get('kv', 'borrador'); S.borrador = b && b.tecId === tecId() ? b : null;
    S.view = firmaTec() ? 'agenda' : 'firmaTec';
  } else S.view = 'login';
  render();
  if (S.ses) { refreshCatalog(); syncCola(); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
