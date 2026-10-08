'use strict';
/* Practice: flip cards with swipe grading, and typed answers. Exposes F.practice.{open,refresh}. */
(function (F) {
  const $ = F.$;
  const P = { queue: [], i: 0, revealed: false, checked: null, ok: 0, bad: 0, total: 0, tag: '' };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const dirOf = () => F.prefs.dir === 'mix' ? (Math.random() < 0.5 ? 'es-en' : 'en-es') : F.prefs.dir;

  function build(extra) {
    let pool = extra ? shuffle(F.cards).slice(0, 10) : shuffle(F.due());
    if (P.tag) pool = pool.filter(c => c.tag === P.tag);
    P.queue = pool.map(c => ({ c, dir: dirOf(), retried: false }));
    P.i = 0; P.revealed = false; P.checked = null; P.ok = 0; P.bad = 0; P.total = P.queue.length;
  }

  function header() {
    const due = F.due().length;
    $('#stats').innerHTML = '<div class="stat"><b>' + due + '</b><span>pendientes</span></div><div class="stat"><b>' + F.learned() + '</b><span>aprendidas</span></div><div class="stat"><b>' + F.cards.length + '</b><span>en total</span></div>';
    $$('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.m === F.prefs.mode));
    const dirs = [['es-en', 'ES → EN'], ['en-es', 'EN → ES'], ['mix', 'Mixto']];
    const tags = [...new Set(F.cards.map(c => c.tag).filter(Boolean))];
    $('#dir-chips').innerHTML = dirs.map(d => '<button class="chip' + (F.prefs.dir === d[0] ? ' on' : '') + '" data-dir="' + d[0] + '">' + d[1] + '</button>').join('') +
      tags.map(t => '<button class="chip' + (P.tag === t ? ' on' : '') + '" data-tag="' + F.esc(t) + '">#' + F.esc(t) + '</button>').join('');
    $('#bar-i').style.width = (P.total ? Math.round(((P.ok + P.bad) / Math.max(P.total, P.ok + P.bad)) * 100) : 0) + '%';
  }
  const $$ = F.$$;

  function dots(c) { let s = ''; for (let n = 1; n <= F.MAXBOX; n++) s += '<i class="' + (n <= c.box ? 'on' : '') + '"></i>'; return '<div class="box" aria-label="Nivel ' + c.box + ' de ' + F.MAXBOX + '">' + s + '</div>'; }
  const speakBtn = (t) => F.canSpeak() ? '<button class="icon-btn speak" data-say="' + F.esc(t) + '" aria-label="Escuchar"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg></button>' : '';

  function render() {
    header();
    const st = $('#stage');
    if (!F.cards.length) { st.innerHTML = '<div class="done"><h2>Aún no hay tarjetas</h2><p class="hint">Busca una palabra y añádela, o importa la lista de clase en Ajustes.</p></div>'; return; }
    if (P.i >= P.queue.length) {
      const had = P.ok + P.bad > 0;
      st.innerHTML = '<div class="done"><h2>' + (had ? 'Sesión terminada' : 'Todo al día') + '</h2><p class="hint">' + (had ? P.ok + ' bien, ' + P.bad + ' para repasar.' : 'No hay tarjetas pendientes' + (P.tag ? ' en #' + F.esc(P.tag) : '') + '. Vuelve más tarde.') + '</p><button class="btn" id="more" style="margin-top:18px">Repasar 10 al azar</button></div>';
      $('#more').onclick = () => { build(true); render(); };
      return;
    }
    const q = P.queue[P.i], c = q.c, es2en = q.dir === 'es-en';
    const front = es2en ? c.es : c.en, back = es2en ? c.en : c.es;
    const lang = es2en ? 'Español' : 'English';
    const exs = F.examplesOf(c);
    const ex = exs.length ? '<ol class="exs">' + exs.map(e => '<li>' + F.esc(e.es) + (e.en ? '<small>' + F.esc(e.en) + '</small>' : '') + '</li>').join('') + '</ol>' : '';
    const note = c.grammarNote ? '<div class="ex"><b>' + F.esc(c.grammarNote) + '</b></div>' : '';
    if (F.prefs.mode === 'flip') {
      st.innerHTML = '<div class="deck"><div class="card" id="card" tabindex="0" role="button" aria-label="Voltear tarjeta">' +
        (es2en || P.revealed ? speakBtn(c.es) : '') + '<div class="lang">' + lang + '</div><div class="word">' + F.esc(front) + '</div>' +
        (P.revealed ? '<div class="back">' + F.esc(back) + '</div>' + ex + note : '<div class="tap">Toca para ver la respuesta</div>') + dots(c) + '</div></div>' +
        (P.revealed ? '<div class="grade"><button class="btn bad" id="g-bad">Otra vez</button><button class="btn good" id="g-ok">Lo sé</button></div><p class="hint" style="text-align:center;margin-top:10px">También puedes deslizar la tarjeta</p>' : '');
      wireCard();
    } else {
      const ch = P.checked;
      st.innerHTML = '<div class="deck"><div class="card" id="card">' + (es2en ? speakBtn(c.es) : '') + '<div class="lang">' + lang + '</div><div class="word">' + F.esc(front) + '</div>' +
        (ch ? '<div class="verdict ' + (ch.ok ? 'ok' : 'no') + '">' + (ch.ok ? (ch.close ? 'Correcto, con una pequeña errata' : 'Correcto') : 'No exactamente') + '</div><div class="back">' + F.esc(back) + '</div>' + ex + note
          : '<form class="answer" id="ans"><input id="ans-in" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="' + (es2en ? 'Traducción en inglés' : 'Traducción en español') + '" aria-label="Tu respuesta"/></form>') + dots(c) + '</div></div>' +
        (ch ? '<div class="grade">' + (ch.ok ? '' : '<button class="btn ghost" id="g-ok">Contar como acierto</button>') + '<button class="btn" id="g-next">Siguiente</button></div>' : '<div class="grade"><button class="btn ghost" id="g-skip">No lo sé</button><button class="btn" id="g-check">Comprobar</button></div>');
      wireType(q);
    }
    $$('[data-say]', st).forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); F.speak(b.dataset.say); }));
  }

  function advance(ok) {
    const q = P.queue[P.i]; F.grade(q.c, ok);
    if (ok) P.ok++; else { P.bad++; if (!q.retried) { P.queue.push({ c: q.c, dir: q.dir, retried: true }); P.total++; } }
    P.i++; P.revealed = false; P.checked = null; F.onChange && F.onChange(); render();
  }

  function wireCard() {
    const card = $('#card'); if (!card) return;
    const reveal = () => { if (!P.revealed) { P.revealed = true; render(); } };
    let x0 = null, dx = 0, moved = false;
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
    card.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-say]')) return; x0 = e.clientX; dx = 0; moved = false; if (P.revealed) { card.classList.add('drag'); card.setPointerCapture(e.pointerId); } });
    card.addEventListener('pointermove', (e) => { if (x0 === null || !P.revealed) return; dx = e.clientX - x0; if (Math.abs(dx) > 6) moved = true;
      card.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 24 + 'deg)'; card.classList.toggle('go-good', dx > 60); card.classList.toggle('go-bad', dx < -60); });
    const end = () => { if (x0 === null) return; const d = dx; x0 = null; card.classList.remove('drag');
      if (P.revealed && Math.abs(d) > 100) { card.style.transform = 'translateX(' + (d > 0 ? 500 : -500) + 'px)'; setTimeout(() => advance(d > 0), 140); }
      else { card.style.transform = ''; card.classList.remove('go-good', 'go-bad'); if (!moved) reveal(); } };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', () => { x0 = null; card.style.transform = ''; card.classList.remove('drag', 'go-good', 'go-bad'); });
    const b = $('#g-bad'), o = $('#g-ok'); if (b) b.onclick = () => advance(false); if (o) o.onclick = () => advance(true);
  }

  function wireType(q) {
    const es2en = q.dir === 'es-en', target = es2en ? q.c.en : q.c.es;
    const inp = $('#ans-in'), doCheck = () => { P.checked = F.check(inp ? inp.value : '', target); render(); };
    if (inp) { inp.focus({ preventScroll: true }); $('#ans').addEventListener('submit', (e) => { e.preventDefault(); doCheck(); }); }
    const c = $('#g-check'), s = $('#g-skip'), n = $('#g-next'), o = $('#g-ok');
    if (c) c.onclick = doCheck; if (s) s.onclick = () => advance(false);
    if (n) n.onclick = () => advance(P.checked.ok); if (o) o.onclick = () => advance(true);
  }

  document.addEventListener('keydown', (e) => {
    if (!$('#v-practicar').classList.contains('on') || e.target.tagName === 'INPUT') return;
    if (F.prefs.mode !== 'flip' || P.i >= P.queue.length) return;
    if (e.key === ' ' && !P.revealed) { e.preventDefault(); P.revealed = true; render(); }
    else if (P.revealed && e.key === 'ArrowRight') advance(true); else if (P.revealed && e.key === 'ArrowLeft') advance(false);
  });

  document.addEventListener('click', (e) => {
    const m = e.target.closest('#mode-seg button'); if (m) { F.prefs.mode = m.dataset.m; F.savePrefs(); P.revealed = false; P.checked = null; render(); return; }
    const d = e.target.closest('[data-dir]'); if (d) { F.prefs.dir = d.dataset.dir; F.savePrefs(); build(); render(); return; }
    const t = e.target.closest('#dir-chips [data-tag]'); if (t) { P.tag = P.tag === t.dataset.tag ? '' : t.dataset.tag; build(); render(); }
  });

  F.practice = { open: () => { build(); render(); }, refresh: header, _state: P };
})(window.F);
