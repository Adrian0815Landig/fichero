'use strict';
/* Fichero UI: navigation, lookup, card list, settings, import. */
(function (F) {
  const { $, $$, esc } = F;
  const TITLES = { buscar: 'Buscar', practicar: 'Practicar', tarjetas: 'Tarjetas', ajustes: 'Ajustes' };
  let current = 'buscar', lastResult = null, busy = false, tagFilter = '';

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
  function renderResult() {
    const box = $('#result'), r = lastResult; if (!r) { box.innerHTML = ''; return; }
    const have = F.hasEs(r.spanish);
    const en = r.source === 'claude' && r.alt && r.alt.length ? [r.english].concat(r.alt).join(', ') : r.english;
    box.innerHTML = (r.warn ? '<div class="msg info">' + esc(r.warn) + '</div>' : '') +
      '<article class="entry"><div class="lemma">' + esc(r.spanish) + '</div>' + (r.partOfSpeech ? '<div class="pos">' + esc(r.partOfSpeech) + '</div>' : '') +
      '<div class="tr">' + esc(r.english) + '</div>' + (r.alt && r.alt.length ? '<div class="alt">también: ' + esc(r.alt.join(', ')) + '</div>' : '') +
      (r.grammarNote ? '<span class="note">' + esc(r.grammarNote) + '</span>' : '') +
      (r.example_es ? '<div class="ex">' + esc(r.example_es) + (r.example_en ? '<small>' + esc(r.example_en) + '</small>' : '') + '</div>' : '') +
      '<div class="row"><button class="btn' + (have ? ' ghost' : '') + '" id="add" ' + (have ? 'disabled' : '') + '>' + (have ? '✓ Ya está en tus tarjetas' : 'Añadir a mis tarjetas') + '</button>' +
      (F.canSpeak() ? '<button class="icon-btn" id="say" aria-label="Escuchar"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg></button>' : '') + '</div>' +
      '<div class="src">' + (r.source === 'claude' ? 'Traducido con Claude' : 'Diccionario gratuito. Con una clave de Claude obtienes ejemplos y notas en cada búsqueda.') + '</div></article>';
    const a = $('#add'); if (a && !have) a.onclick = () => { F.add({ es: r.spanish, en: en, pos: r.partOfSpeech, example_es: r.example_es, example_en: r.example_en, grammarNote: r.grammarNote }); F.toast('Añadida: ' + r.spanish); renderResult(); status(); };
    const s = $('#say'); if (s) s.onclick = () => F.speak(r.spanish);
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
    try { lastResult = await F.lookup(q, F.prefs.lookup); F.pushRecent(lastResult); renderResult(); renderRecent(); }
    catch (e) { lastResult = null; $('#result').innerHTML = '<div class="msg">' + esc(e.message || 'No se pudo buscar.') + '</div>'; }
    busy = false; $('#q-go').disabled = false;
  }

  /* ---- Tarjetas ---- */
  function renderList() {
    const f = F.norm($('#filter').value), tags = [...new Set(F.cards.map(c => c.tag).filter(Boolean))];
    if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
    $('#tag-chips').innerHTML = tags.length ? ['<button class="chip' + (!tagFilter ? ' on' : '') + '" data-t="">Todas</button>'].concat(tags.map(t => '<button class="chip' + (tagFilter === t ? ' on' : '') + '" data-t="' + esc(t) + '">#' + esc(t) + '</button>')).join('') : '';
    const items = F.cards.slice().sort((a, b) => b.createdAt - a.createdAt).filter(c => (!f || F.norm(c.es).includes(f) || F.norm(c.en).includes(f)) && (!tagFilter || c.tag === tagFilter));
    $('#list').innerHTML = items.length ? items.map(c => '<div class="row-item"><div class="t"><b>' + esc(c.es) + '</b><div class="e">' + esc(c.en) + '</div></div><span class="lvl">Nivel ' + c.box + '</span><button class="icon-btn del" data-id="' + c.id + '" aria-label="Eliminar ' + esc(c.es) + '"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button></div>').join('')
      : '<p class="hint" style="padding:30px 4px;text-align:center">' + (F.cards.length ? 'Sin resultados.' : 'Todavía no hay tarjetas. Busca una palabra o importa tu lista de clase en Ajustes.') + '</p>';
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
        else { const x = await F.lookup(r.es, 'es-en'); const en = x.source === 'claude' && x.alt && x.alt.length ? [x.english].concat(x.alt).join(', ') : x.english;
          const n = F.add({ es: F.norm(x.spanish) === F.norm(r.es) ? r.es : x.spanish, en, pos: x.partOfSpeech, example_es: x.example_es, example_en: x.example_en, grammarNote: x.grammarNote, tag: r.tag }); n ? added++ : dup++; }
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
    $('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; const c = F.cards.find(x => x.id === b.dataset.id); if (c && confirm('¿Eliminar «' + c.es + '»?')) { F.remove(c.id); renderList(); status(); } });
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
