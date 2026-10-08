'use strict';
/* Lookup chain: Claude (if API key) -> free dictionary (MyMemory + Wiktionary). Any failure falls through. */
(function (F) {
  const TIMEOUT = 10000;
  const get = async (url, opt, ms) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms || TIMEOUT);
    try { return await fetch(url, Object.assign({ signal: ac.signal }, opt || {})); } finally { clearTimeout(t); }
  };
  const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const reflexive = (w) => /^[a-záéíóúñü]+(ar|er|ir|ír)se$/i.test(w.trim()) ? 'verbo reflexivo' : '';

  // Normalised result: senses = [{ es, en, pos, note, examples: [{ es, en }] }], most common first. Top-level fields mirror senses[0].
  const ex3 = (l) => (l || []).map(e => ({ es: strip(e && e.es), en: strip(e && e.en) })).filter(e => e.es).slice(0, 3);
  function finish(r) {
    const seen = new Set();
    const self = F.stripArt(F.norm(r.spanish)), real = r.senses.filter(s => F.stripArt(F.norm(s.en)) !== self);
    if (real.length) r.senses = real; // drop "mesa = mesa"-style loanword glosses when there are real translations
    r.senses = r.senses.filter(s => { const k = F.norm(s.en) + '|' + F.norm(s.es); if (!s.en || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
    const s0 = r.senses[0], e0 = s0.examples[0];
    return Object.assign(r, { english: s0.en, alt: r.senses.slice(1).map(s => s.en), partOfSpeech: r.partOfSpeech || s0.pos, example_es: e0 ? e0.es : '', example_en: e0 ? e0.en : '' });
  }

  async function claude(q, dir, key) {
    const hint = dir === 'es-en' ? 'The input is Spanish; translate it to English.' : 'The input is English; translate it to Spanish.';
    const prompt = 'You are a precise Spanish-English learner dictionary (learner level B1). ' + hint + '\nInput: ' + JSON.stringify(q) +
      '\nReply with ONLY a JSON object, no markdown:\n{"spanish":"headword in Spanish (infinitive for verbs, singular for nouns, with article for nouns e.g. \\"la casa\\")","partOfSpeech":"noun f. / verb / adj. ...","grammarNote":"short flag only if relevant e.g. verbo reflexivo, irregular yo-go, ser vs estar; else empty string",' +
      '"senses":[{"spanish":"Spanish word for this meaning (normally the headword; differs only when the English input needs another Spanish word for this meaning)","english":"1-2 English translations for this meaning, comma-separated","partOfSpeech":"noun m. / verb / ...","note":"2-4 words in Spanish saying which meaning this is, e.g. \\"institución financiera\\"","examples":[{"es":"short natural sentence using the word in this meaning","en":"its English translation"}]}]}' +
      '\nList the distinct meanings a learner may meet (different meanings, not synonyms), most common first, at most 4. A word with only one meaning gets one sense. Every sense must have exactly 3 examples with varied structure.';
    const res = await get('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    }, 25000);
    if (!res.ok) { let m = 'HTTP ' + res.status; try { const j = await res.json(); if (j.error && j.error.message) m = j.error.message; } catch (e) {} throw new Error(m); }
    const d = await res.json();
    const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('Respuesta ilegible');
    const j = JSON.parse(txt.slice(a, b + 1));
    const senses = (j.senses || []).map(s => ({ es: String(s.spanish || j.spanish || '').trim(), en: String(s.english || '').trim(), pos: s.partOfSpeech || '', note: s.note || '', examples: ex3(s.examples) }));
    if (!j.spanish || !senses.some(s => s.en)) throw new Error('Respuesta incompleta');
    return finish({ spanish: j.spanish, senses, partOfSpeech: j.partOfSpeech || '', grammarNote: j.grammarNote || '', source: 'claude' });
  }

  async function myMemory(q, dir) {
    const res = await get('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=' + (dir === 'es-en' ? 'es|en' : 'en|es'));
    if (!res.ok) throw new Error('MyMemory HTTP ' + res.status);
    const d = await res.json();
    if (Number(d.responseStatus) !== 200) throw new Error(d.responseDetails || 'MyMemory');
    const main = strip(d.responseData && d.responseData.translatedText);
    if (!main || /MYMEMORY WARNING/i.test(main)) throw new Error('MyMemory: límite diario alcanzado');
    const seen = new Set([F.norm(main)]); const alt = [];
    (d.matches || []).forEach(m => { const t = strip(m.translation); const k = F.norm(t);
      if (t && !seen.has(k) && t.length <= 40 && alt.length < 2 && (m.quality === undefined || Number(m.quality) >= 50)) { seen.add(k); alt.push(t); } });
    return { main, alt };
  }

  // Each Wiktionary definition (across all parts of speech) becomes one sense; inflected-form entries are skipped.
  async function wiktionary(word) {
    const w = F.stripArt(String(word).trim().toLowerCase()).replace(/^(el|la|los|las) /, '');
    const res = await get('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('Wiktionary HTTP ' + res.status);
    const d = await res.json(); const es = d.es; if (!es || !es.length) throw new Error('Wiktionary: sin entrada');
    const senses = [];
    for (const e of es) for (const df of e.definitions || []) {
      if (/form-of-definition/.test(df.definition || '')) continue;
      let g = strip(df.definition), note = '';
      const m = g.match(/^\(([^)]*)\)\s*(.*)$/); if (m) { note = m[1]; g = m[2]; }
      if (!g || g.length > 90) continue;
      senses.push({ es: '', en: g, pos: (e.partOfSpeech || '').toLowerCase(), note, examples: ex3((df.parsedExamples || []).map(p => ({ es: p.example, en: p.translation }))) });
    }
    if (!senses.length) throw new Error('Wiktionary: sin definiciones');
    return { pos: senses[0].pos, senses: senses.slice(0, 4) };
  }

  // Spanish Wiktionary: numbered definitions with {{ejemplo|…}} sentences, and an English translation table that says
  // which definition numbers each translation belongs to ({{t|en|a1=1|t1=bank|a2=2,3|t2=bench}}).
  const splitTop = (t) => { const out = []; let d = 0, cur = '';
    for (let i = 0; i < t.length; i++) { const two = t.substr(i, 2);
      if (two === '{{' || two === '[[') { d++; cur += two; i++; continue; } if (two === '}}' || two === ']]') { d--; cur += two; i++; continue; }
      if (t[i] === '|' && !d) { out.push(cur); cur = ''; } else cur += t[i]; }
    out.push(cur); return out; };
  const wikiText = (t) => {
    t = String(t).replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<br\s*\/?>/gi, ' ');
    for (let k = 0; k < 3; k++) t = t.replace(/\{\{([^{}]*)\}\}/g, (m, x) => { const p = x.split('|'), n = p[0].trim();
      if (n === 'plm' || n === 'ucf') return p[1] ? p[1].charAt(0).toUpperCase() + p[1].slice(1) : '';
      return n === 'impropia' || n === 'l' ? (p[n === 'l' ? 2 : 1] || '') : ''; });
    return strip(t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, ''));
  };
  async function esWiktionary(word) {
    const w = F.stripArt(String(word).trim().toLowerCase()).replace(/^(el|la|los|las) /, '');
    const res = await get('https://es.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*&page=' + encodeURIComponent(w));
    if (!res.ok) throw new Error('es.wiktionary HTTP ' + res.status);
    const d = await res.json(); const wt = d.parse && d.parse.wikitext; if (!wt) throw new Error('es.wiktionary: sin entrada');
    const a = wt.indexOf('== {{lengua|es}} =='); if (a < 0) throw new Error('es.wiktionary: sin español');
    const b = wt.indexOf('\n== ', a + 5), body = wt.slice(a, b < 0 ? undefined : b);
    const defs = {}, tr = []; let blk = 0, last = null;
    for (const line of body.split('\n')) {
      if (/^===\s*Etimología/.test(line)) { blk++; last = null; continue; }
      const m = line.match(/^;(\d+)[^:]*:\s*(.*)$/);
      if (m) { const k = blk + ':' + m[1]; last = defs[k] ? null : (defs[k] = { def: wikiText(m[2]), examples: [] }); continue; } // later sections (e.g. verb forms) restart numbering
      const e = line.match(/^\{\{ejemplo\|(.*)\}\}\s*$/);
      if (e && last) { const ex = wikiText(splitTop(e[1])[0]); if (ex && ex.length <= 140) last.examples.push({ es: ex, en: '' }); continue; }
      const t = line.match(/^\{\{t\|en\|(.*)\}\}\s*$/);
      if (t) { const kv = {}; splitTop(t[1]).forEach(x => { const i = x.indexOf('='); if (i > 0) kv[x.slice(0, i).trim()] = x.slice(i + 1).trim(); });
        for (let n = 1; kv['t' + n]; n++) { const nums = [];
          String(kv['a' + n] || '1').split(',').forEach(r => { const q = r.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (q) for (let k = +q[1]; k <= +(q[2] || q[1]); k++) nums.push(blk + ':' + k); });
          tr.push({ en: wikiText(kv['t' + n]), keys: nums }); } }
    }
    return { defs, tr };
  }
  // Attach Spanish-Wiktionary examples (and a short Spanish definition as hint) to the senses whose English matches.
  function mergeEs(senses, ew, spanish) {
    const short = (t) => { t = t.replace(/\.$/, ''); return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, '') + '…' : t; };
    const owner = new Map(); // each Spanish definition feeds one sense only
    for (const t of ew.tr) {
      const defs = t.keys.filter(k => ew.defs[k] && !owner.has(k)).map(k => ew.defs[k]); if (!t.en || !defs.length) continue;
      const key = F.stripArt(F.norm(t.en)); let s = senses.find(x => F.alts(x.en).includes(key));
      if (!s) { if (senses.length >= 5) continue; s = { es: spanish, en: t.en, pos: '', note: '', examples: [] }; senses.push(s); }
      t.keys.forEach(k => { if (ew.defs[k] && !owner.has(k)) owner.set(k, s); });
      if (!s.note) s.note = short(defs[0].def);
      for (const df of defs) for (const e of df.examples) if (s.examples.length < 3 && !s.examples.some(x => F.norm(x.es) === F.norm(e.es))) s.examples.push(e);
    }
    return senses;
  }

  async function free(q, dir) {
    const wantWik = dir === 'es-en', skip = Promise.reject(new Error('skip')); skip.catch(() => {});
    const [mm, wk, ewk] = await Promise.allSettled([myMemory(q, dir), wantWik ? wiktionary(q) : skip, wantWik ? esWiktionary(q) : skip]);
    let spanish, english, alt = [], wik = wk.status === 'fulfilled' ? wk.value : null, ew = ewk.status === 'fulfilled' ? ewk.value : null;
    const ewFirst = () => ew && ew.tr.find(t => t.en && t.keys.length);
    if (mm.status === 'fulfilled') {
      english = dir === 'es-en' ? mm.value.main : q; spanish = dir === 'es-en' ? q : mm.value.main; alt = mm.value.alt;
      if (dir === 'en-es') { const [a, b] = await Promise.allSettled([wiktionary(spanish), esWiktionary(spanish)]);
        if (a.status === 'fulfilled') wik = a.value; if (b.status === 'fulfilled') ew = b.value; }
    } else if (wik) {
      spanish = q; english = wik.senses[0].en;
    } else if (ewFirst()) {
      spanish = q; english = ewFirst().en;
    } else {
      throw new Error(navigator.onLine === false ? 'Sin conexión. Conéctate a internet para buscar palabras nuevas.' : 'No se pudo traducir ahora mismo (' + (mm.reason && mm.reason.message || 'sin respuesta') + '). Inténtalo de nuevo.');
    }
    if (F.norm(spanish) === F.norm(english) && !wik && !ew) throw new Error('No encontré una traducción fiable para «' + q + '». Revisa la ortografía.');
    spanish = spanish.trim();
    // Wiktionary senses carry the meanings; MyMemory's translation is added when Wiktionary doesn't already cover it (last, as it is less reliable).
    let senses = wik ? wik.senses.map(s => Object.assign(s, { es: spanish })) : [];
    const covered = (t) => senses.some(s => F.alts(s.en).includes(F.stripArt(F.norm(t))));
    if (!covered(english)) senses[wik ? 'push' : 'unshift']({ es: spanish, en: english.trim(), pos: wik ? wik.pos : '', note: '', examples: [] });
    if (!wik) alt.forEach(a => { if (!covered(a)) senses.push({ es: spanish, en: a, pos: '', note: '', examples: [] }); });
    if (ew) mergeEs(senses, ew, spanish);
    return finish({ spanish, senses, partOfSpeech: wik ? wik.pos : '', grammarNote: reflexive(spanish), source: 'free' });
  }

  F.lookup = async (q, dir) => {
    const key = F.getKey(); let warn = '';
    if (key) { try { return await claude(q, dir, key); } catch (e) { warn = 'Claude no respondió (' + (e.message || e.name) + '). Resultado del diccionario gratuito.'; } }
    const r = await free(q, dir); if (warn) r.warn = warn; return r;
  };

  F.speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 0.9;
      const v = speechSynthesis.getVoices().find(v => /^es(-|_)ES/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^es/i.test(v.lang)); if (v) u.voice = v; speechSynthesis.speak(u); } catch (e) {}
  };
  F.canSpeak = () => 'speechSynthesis' in window;
  F._lookupInternals = { claude, free, myMemory, wiktionary, esWiktionary };
})(window.F);
