'use strict';
/* Fichero core: storage, spaced repetition, text helpers. Keys/schema match the earlier deployed version. */
window.F = window.F || {};
(function (F) {
  const K = { vocab: 'fichero:vocab', key: 'fichero:apikey', prefs: 'fichero:prefs', recent: 'fichero:recent' };
  const DAY = 86400000;
  F.DAYS = [0, 0, 1, 3, 7, 16, 35]; // index = box (1..6)
  F.MAXBOX = 6;

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  F.read = read; F.write = write;
  F.getKey = () => { try { return localStorage.getItem(K.key) || ''; } catch (e) { return ''; } };
  F.setKey = (v) => { try { v ? localStorage.setItem(K.key, v) : localStorage.removeItem(K.key); } catch (e) {} };
  F.prefs = Object.assign({ theme: 'auto', mode: 'flip', dir: 'es-en', lookup: 'es-en' }, read(K.prefs, {}));
  F.savePrefs = () => write(K.prefs, F.prefs);

  const clean = (c) => ({
    id: c.id || ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    es: String(c.es || '').trim(), en: String(c.en || '').trim(),
    pos: c.pos || '', example_es: c.example_es || '', example_en: c.example_en || '',
    grammarNote: c.grammarNote || '', tag: c.tag || '',
    box: Math.min(Math.max(parseInt(c.box, 10) || 1, 1), F.MAXBOX),
    nextReview: Number.isFinite(c.nextReview) ? c.nextReview : Date.now(),
    createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
    reps: c.reps || 0, lapses: c.lapses || 0
  });
  F.cards = read(K.vocab, []).filter(c => c && c.es).map(clean);
  F.persist = () => write(K.vocab, F.cards);

  F.norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:"“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  F.stripArt = (s) => s.replace(/^(el|la|los|las|un|una|the|a|an|to) /, '');
  F.has = (es, en) => { const a = F.norm(es), b = F.norm(en); return F.cards.find(c => F.norm(c.es) === a && (!b || F.norm(c.en) === b)); };
  F.hasEs = (es) => F.cards.find(c => F.norm(c.es) === F.norm(es));

  F.add = (c) => { if (!c.es || !c.en) return null; if (F.hasEs(c.es)) return null; const n = clean(c); F.cards.push(n); F.persist(); return n; };
  F.remove = (id) => { F.cards = F.cards.filter(c => c.id !== id); F.persist(); };
  F.due = () => F.cards.filter(c => c.nextReview <= Date.now());
  F.learned = () => F.cards.filter(c => c.box >= 5).length;

  F.grade = (c, ok) => {
    c.reps++;
    if (ok) c.box = Math.min(c.box + 1, F.MAXBOX); else { c.box = 1; c.lapses++; }
    c.nextReview = Date.now() + F.DAYS[c.box] * DAY;
    F.persist();
  };

  // Typed-answer checking: accepts alternatives (a, b / c), ignores accents/articles, tolerates one typo on longer words.
  const lev = (a, b) => { const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const q = [i]; for (let j = 1; j <= n; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; }
    return p[n]; };
  F.alts = (s) => String(s || '').replace(/\([^)]*\)/g, ' ').split(/[,;/]| or /).map(x => F.stripArt(F.norm(x))).filter(Boolean);
  F.check = (input, target) => {
    const i = F.stripArt(F.norm(input)); if (!i) return { ok: false };
    let best = 99;
    for (const a of F.alts(target)) { if (a === i) return { ok: true, exact: true }; best = Math.min(best, lev(a, i)); if (a.length >= 5 && lev(a, i) <= 1) return { ok: true, close: true }; }
    return { ok: false, dist: best };
  };

  // Import parser: "#tag" lines, then "es - en" | "es = en" | "es;en" | tab | bare word.
  F.parseList = (text) => {
    const out = []; let tag = '';
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      if (line[0] === '#') { tag = line.replace(/^#+\s*/, '').trim(); continue; }
      const m = line.split(/\s+[-–—]\s+|\s*=\s*|\s*;\s*|\t+/);
      const es = (m[0] || '').trim(); const en = (m.slice(1).join(', ') || '').trim();
      if (es) out.push({ es, en, tag });
    }
    return out;
  };

  F.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  F.$ = (s, r) => (r || document).querySelector(s);
  F.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  let tt; F.toast = (m) => { const t = F.$('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2200); };
  F.recent = () => read(K.recent, []);
  F.pushRecent = (r) => { const l = F.recent().filter(x => F.norm(x.spanish) !== F.norm(r.spanish)); l.unshift({ spanish: r.spanish, english: r.english }); write(K.recent, l.slice(0, 8)); };
  F.exportJSON = () => JSON.stringify(F.cards, null, 2);
  F.importJSON = (text) => { const arr = JSON.parse(text); if (!Array.isArray(arr)) throw new Error('Formato no válido'); let n = 0;
    for (const c of arr) { if (c && c.es && c.en && !F.hasEs(c.es)) { F.cards.push(clean(c)); n++; } } F.persist(); return n; };
  F.wipe = () => { F.cards = []; F.persist(); };
})(window.F);
