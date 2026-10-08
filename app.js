'use strict';
/* Fichero UI: navigation, lookup, card list, settings, import. */
(function (F) {
  const { $, $$, esc } = F;
  const TITLES = { buscar: 'Buscar', practicar: 'Practicar', tarjetas: 'Tarjetas', ajustes: 'Ajustes' };
  let current = 'buscar', lastResult = null, pick = 0, busy = false, tagFilter = '', openId = '';

  function applyTheme() { const r = document.documentElement; F.prefs.theme === 'auto' ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', F.prefs.theme);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = (F.prefs.theme === 'dark' || (F.prefs.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches)) ? '#0A1124' : '#1F4FD8'; }

  function go(v) {
    current = v;
    $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
    $$('.tab').forEach(t => { t.classList.toggle('on', t.dataset.v === v); t.setAttribute('aria-current', t.dataset.v === v ? 'page' : 'false'); });
    $('#title').textContent = TITLES[v]; $('#main').scrollTop = 0;
    if (v === 'practicar') F.practice.open(); if (v === 'tarjetas') renderList(); if (v === 'ajustes') renderSettings(); if (v === 'buscar') renderRecent();
    status();
  }
  function status() {
    const n = F.cards.length, d = F.due().length;
    $('#sub').textContent = (current === 'practicar' || current === 'ajustes') ? '' : n + (n === 1 ? ' tarjeta guardada' : ' tarjetas guardadas');
    const dot = $('#due-dot'); dot.textContent = d > 99 ? '99+' : d; dot.classList.toggle('show', d > 0);
  }
  F.onChange = status;

  /* ---- Buscar ---- */
  // Shared by Buscar and Tarjetas: example list, and a list of meanings to choose from.
  const exList = (l) => l.length ? '<ol class="exs">' + l.map(e => '<li>' + esc(e.es) + (e.en ? '<small>' + esc(e.en) + '</small>' : '') + '</li>').join('') + '</ol>' : '';
  const senseList = (senses, on, head, attr, exs) => { const showEs = senses.some(x => x.es && F.norm(x.es) !== F.norm(senses[0].es)); return '<div class="senses-h">' + senses.length + ' significados · ' + esc(head) + '</div>' +
    senses.map((s, i) => '<button class="sense' + (i === on ? ' on' : '') + '" ' + attr + ' data-sense="' + i + '" aria-pressed="' + (i === on) + '"><span class="n">' + (i + 1) + '</span><span class="sx"><b>' + esc(s.en) + '</b>' +
      (showEs && s.es ? ' <i>' + esc(s.es) + '</i>' : '') + ([s.note, s.pos].filter(Boolean).length ? '<small>' + esc([s.note, s.pos].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></button>' +
      (i === on && exs ? exList(s.examples) : '')).join(''); };

  function renderResult() {
    const box = $('#result'), r = lastResult; if (!r) { box.innerHTML = ''; return; }
    const s = r.senses[pick] || r.senses[0], es = s.es || r.spanish, have = F.hasEs(es);
    const same = have && F.norm(have.en) === F.norm(s.en);
    const multi = r.senses.length > 1;
    box.innerHTML = (r.warn ? '<div class="msg info">' + esc(r.warn) + '</div>' : '') +
      '<article class="entry"><div class="lemma">' + esc(es) + '</div>' + ((s.pos || r.partOfSpeech) ? '<div class="pos">' + esc(s.pos || r.partOfSpeech) + '</div>' : '') +
      (r.grammarNote ? '<span class="note">' + esc(r.grammarNote) + '</span>' : '') +
      (multi ? senseList(r.senses, pick, 'elige el que quieres guardar', '', true)
        : '<div class="tr">' + esc(s.en) + '</div>' + (s.note ? '<div class="alt">' + esc(s.note) + '</div>' : '') + exList(s.examples)) +
      '<div class="row"><button class="btn' + (same ? ' ghost' : '') + '" id="add" ' + (same ? 'disabled' : '') + '>' +
        (same ? '✓ Ya está en tus tarjetas' : have ? 'Usar este significado en mi tarjeta' : multi ? 'Añadir con este significado' : 'Añadir a mis tarjetas') + '</button>' +
      (F.canSpeak() ? '<button class="icon-btn" id="say" aria-label="Escuchar"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg></button>' : '') + '</div>' +
      '<div class="src">' + (r.source === 'claude' ? 'Traducido con Claude' : 'Diccionario gratuito (Wiktionary y MyMemory): no siempre hay ejemplos para cada significado. Con una clave de Claude obtienes 3 por significado, con traducción.') + '</div></article>';
    $$('[data-sense]', box).forEach(b => b.onclick = () => { pick = +b.dataset.sense; renderResult(); });
    const a = $('#add'); if (a && !same) a.onclick = () => {
      if (have) { F.attachSenses(have, r, pick) ? F.toast('Tarjeta actualizada: ' + s.en) : F.toast('No se pudo cambiar el significado'); }
      else { F.add(F.fromLookup(r, pick)); F.toast('Añadida: ' + es); }
      renderResult(); status(); };
    const sy = $('#say'); if (sy) sy.onclick = () => F.speak(es);
  }
  function renderRecent() {
    const l = F.recent(); const el = $('#recent');
    el.innerHTML = !l.length ? (lastResult ? '' : '<p class="hint" style="margin-top:18px">Escribe una palabra o frase. Se traduce al momento y la guardas con un toque para practicarla después.</p>') : l.length ? '<h2 class="sect">Búsquedas recientes</h2>' + l.map((x, i) => '<button class="mini" data-i="' + i + '"><b>' + esc(x.spanish) + '</b><span>' + esc(x.english) + '</span></button>').join('') : '';
    $$('.mini', el).forEach(b => b.onclick = () => { const x = l[+b.dataset.i]; setDir('es-en'); $('#q').value = x.spanish; search(); });
  }
  function setDir(d) { F.prefs.lookup = d; F.savePrefs(); $$('#dir-seg button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); $('#q').placeholder = d === 'es-en' ? 'Palabra o frase en español' : 'Word or phrase in English'; }
  async function search() {
    const q = $('#q').value.trim(); if (!q || busy) return; busy = true; $('#q-go').disabled = true; $('#q').blur();
    $('#result').innerHTML = '<p class="hint" style="margin-top:16px">Buscando…</p>';
    try { lastResult = await F.lookup(q, F.prefs.lookup); pick = 0; F.pushRecent(lastResult); renderResult(); renderRecent(); }
    catch (e) { lastResult = null; $('#result').innerHTML = '<div class="msg">' + esc(e.message || 'No se pudo buscar.') + '</div>'; }
    busy = false; $('#q-go').disabled = false;
  }

  /* ---- Tarjetas ---- */
  function renderList() {
    const f = F.norm($('#filter').value), tags = [...new Set(F.cards.map(c => c.tag).filter(Boolean))];
    if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
    $('#tag-chips').innerHTML = tags.length ? ['<button class="chip' + (!tagFilter ? ' on' : '') + '" data-t="">Todas</button>'].concat(tags.map(t => '<button class="chip' + (tagFilter === t ? ' on' : '') + '" data-t="' + esc(t) + '">#' + esc(t) + '</button>')).join('') : '';
    const items = F.cards.slice().sort((a, b) => b.createdAt - a.createdAt).filter(c => (!f || F.norm(c.es).includes(f) || F.norm(c.en).includes(f)) && (!tagFilter || c.tag === tagFilter));
    $('#list').innerHTML = items.length ? items.map(c => { const open = c.id === openId, n = c.senses.length;
      return '<div class="row-item' + (open ? ' open' : '') + '"><div class="row-top"><button class="t" data-open="' + c.id + '" aria-expanded="' + open + '"><b>' + esc(c.es) + '</b><div class="e">' + esc(c.en) + (n > 1 ? ' · ' + n + ' significados' : '') + '</div></button><span class="lvl">Nivel ' + c.box + '</span><button class="icon-btn del" data-id="' + c.id + '" aria-label="Eliminar ' + esc(c.es) + '"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button></div>' +
        (open ? '<div class="detail">' + (n > 1 ? senseList(c.senses, c.sense, 'toca el que quieres aprender', 'data-card="' + c.id + '"', true) : exList(F.examplesOf(c)) || '<p class="hint">Sin ejemplos.</p>') +
          (!n ? '<button class="btn ghost sm" data-fetch="' + c.id + '" style="margin-top:10px">Buscar significados y ejemplos</button>' : '') + '</div>' : '') + '</div>'; }).join('')
      : '<p class="hint" style="padding:30px 4px;text-align:center">' + (F.cards.length ? 'Sin resultados.' : 'Todavía no hay tarjetas. Busca una palabra o importa tu lista de clase en Ajustes.') + '</p>';
  }
  async function fetchSenses(c, btn) {
    btn.disabled = true; btn.textContent = 'Buscando…';
    try { const r = await F.lookup(c.es, 'es-en'); if (!F.attachSenses(c, r)) throw new Error(); F.toast(c.senses.length > 1 ? c.senses.length + ' significados encontrados' : 'Ejemplos añadidos'); }
    catch (e) { F.toast(navigator.onLine === false ? 'Sin conexión' : 'No se encontraron significados'); }
    renderList();
  }

  /* ---- Ajustes ---- */
  function renderSettings() {
    $$('#theme-seg button').forEach(b => b.classList.toggle('on', b.dataset.t === F.prefs.theme));
    $('#key').value = F.getKey(); $('#data-info').textContent = F.cards.length + ' tarjetas guardadas solo en este dispositivo. Exporta de vez en cuando una copia.';
  }
  function openImport(on) { $('#sheet-bg').classList.toggle('on', on); if (on) { $('#import-status').textContent = ''; setTimeout(() => $('#import-text').focus(), 50); } }
  async function runImport() {
    const rows = F.parseList($('#import-text').value); if (!rows.length) { $('#import-status').textContent = 'No hay líneas que importar.'; return; }
    const go = $('#import-go'); go.disabled = true; let added = 0, dup = 0; const failed = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; $('#import-status').textContent = 'Procesando ' + (i + 1) + ' de ' + rows.length + '…';
      const ex = F.hasEs(r.es); if (ex) { if (r.tag && !ex.tag) { ex.tag = r.tag; F.persist(); } dup++; continue; }
      try {
        if (r.en) { F.add({ es: r.es, en: r.en, tag: r.tag }); added++; }
        else { const x = await F.lookup(r.es, 'es-en');
          const n = F.add(F.fromLookup(x, 0, { es: F.norm(x.spanish) === F.norm(r.es) ? r.es : x.spanish, tag: r.tag })); n ? added++ : dup++; }
      } catch (e) { failed.push(r); }
    }
    go.disabled = false; status();
    $('#import-text').value = failed.map(r => (r.tag ? '' : '') + r.es + (r.en ? ' - ' + r.en : '')).join('\n');
    $('#import-status').textContent = added + ' añadidas' + (dup ? ', ' + dup + ' ya existían' : '') + (failed.length ? ', ' + failed.length + ' sin traducir (siguen en el cuadro; inténtalo de nuevo con conexión).' : '.');
    if (!failed.length) { F.toast(added + ' tarjetas añadidas'); openImport(false); $('#import-text').value = ''; }
  }

  /* ---- Wiring ---- */
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(); setDir(F.prefs.lookup || 'es-en'); renderRecent(); status();
    $$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.v)));
    $$('#dir-seg button').forEach(b => b.addEventListener('click', () => { setDir(b.dataset.d); $('#q').focus(); }));
    $('#q-form').addEventListener('submit', (e) => { e.preventDefault(); search(); });
    $('#filter').addEventListener('input', renderList);
    $('#tag-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { tagFilter = b.dataset.t; renderList(); } });
    $('#list').addEventListener('click', (e) => {
      const card = (id) => F.cards.find(x => x.id === id);
      const o = e.target.closest('[data-open]'); if (o) { openId = openId === o.dataset.open ? '' : o.dataset.open; renderList(); return; }
      const sn = e.target.closest('[data-card]'); if (sn) { const c = card(sn.dataset.card);
        if (c && +sn.dataset.sense !== c.sense) { F.setSense(c, +sn.dataset.sense) ? F.toast('Ahora aprendes: ' + c.en) : F.toast('Ya tienes una tarjeta para esa palabra'); renderList(); } return; }
      const fe = e.target.closest('[data-fetch]'); if (fe) { const c = card(fe.dataset.fetch); if (c) fetchSenses(c, fe); return; }
      const b = e.target.closest('[data-id]'); if (!b) return; const c = card(b.dataset.id); if (c && confirm('¿Eliminar «' + c.es + '»?')) { F.remove(c.id); renderList(); status(); } });
    $$('#theme-seg button').forEach(b => b.addEventListener('click', () => { F.prefs.theme = b.dataset.t; F.savePrefs(); applyTheme(); renderSettings(); }));
    $('#key-save').addEventListener('click', () => { const v = $('#key').value.trim(); F.setKey(v); $('#key-st').textContent = v ? 'Clave guardada en este dispositivo.' : 'Clave eliminada.'; });
    $('#open-import').addEventListener('click', () => openImport(true)); $('#import-cancel').addEventListener('click', () => openImport(false));
    $('#sheet-bg').addEventListener('click', (e) => { if (e.target.id === 'sheet-bg') openImport(false); });
    $('#import-go').addEventListener('click', runImport);
    $('#export').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([F.exportJSON()], { type: 'application/json' })); a.download = 'fichero-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
    $('#import-file').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const n = F.importJSON(await f.text()); F.toast(n + ' tarjetas importadas'); status(); renderSettings(); } catch (err) { F.toast('Archivo no válido'); } e.target.value = ''; });
    $('#wipe').addEventListener('click', () => { if (confirm('¿Borrar TODAS las tarjetas? No se puede deshacer.')) { F.wipe(); status(); renderSettings(); F.toast('Tarjetas borradas'); } });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    matchMedia('(prefers-color-scheme:dark)').addEventListener && matchMedia('(prefers-color-scheme:dark)').addEventListener('change', applyTheme);
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  });
})(window.F);
