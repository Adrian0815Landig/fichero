'use strict';
/* Lookup chain: Claude (if API key) -> free dictionary (MyMemory + Wiktionary). Any failure falls through. */
(function (F) {
  const TIMEOUT = 10000;
  const get = async (url, opt) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
    try { return await fetch(url, Object.assign({ signal: ac.signal }, opt || {})); } finally { clearTimeout(t); }
  };
  const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const reflexive = (w) => /^[a-záéíóúñü]+(ar|er|ir|ír)se$/i.test(w.trim()) ? 'verbo reflexivo' : '';

  async function claude(q, dir, key) {
    const hint = dir === 'es-en' ? 'The input is Spanish; translate it to English.' : 'The input is English; translate it to Spanish.';
    const prompt = 'You are a precise Spanish-English learner dictionary (learner level B1). ' + hint + '\nInput: ' + JSON.stringify(q) +
      '\nReply with ONLY a JSON object, no markdown:\n{"spanish":"headword in Spanish (infinitive for verbs, singular for nouns, with article for nouns e.g. \\"la casa\\")","english":"main translation","alt":["up to 2 other common translations"],"partOfSpeech":"noun f. / verb / adj. ...","example_es":"short natural sentence","example_en":"its English translation","grammarNote":"short flag only if relevant e.g. verbo reflexivo, irregular yo-go, ser vs estar; else empty string"}';
    const res = await get('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) { let m = 'HTTP ' + res.status; try { const j = await res.json(); if (j.error && j.error.message) m = j.error.message; } catch (e) {} throw new Error(m); }
    const d = await res.json();
    const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('Respuesta ilegible');
    const j = JSON.parse(txt.slice(a, b + 1));
    if (!j.spanish || !j.english) throw new Error('Respuesta incompleta');
    return { spanish: j.spanish, english: j.english, alt: (j.alt || []).filter(Boolean).slice(0, 2), partOfSpeech: j.partOfSpeech || '', example_es: j.example_es || '', example_en: j.example_en || '', grammarNote: j.grammarNote || '', source: 'claude' };
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

  async function wiktionary(word) {
    const w = F.stripArt(String(word).trim().toLowerCase()).replace(/^(el|la|los|las) /, '');
    const res = await get('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('Wiktionary HTTP ' + res.status);
    const d = await res.json(); const es = d.es; if (!es || !es.length) throw new Error('Wiktionary: sin entrada');
    const e = es[0]; const defs = (e.definitions || []).slice(0, 3);
    const gloss = defs.map(x => strip(x.definition)).filter(Boolean);
    let ex = null;
    for (const df of e.definitions || []) { const p = (df.parsedExamples || [])[0]; if (p && p.example && p.translation) { ex = { es: strip(p.example), en: strip(p.translation) }; break; } }
    return { pos: (e.partOfSpeech || '').toLowerCase(), gloss, ex };
  }

  async function free(q, dir) {
    const wantWik = dir === 'es-en';
    const [mm, wk] = await Promise.allSettled([myMemory(q, dir), wantWik ? wiktionary(q) : Promise.reject(new Error('skip'))]);
    let spanish, english, alt = [], wik = wk.status === 'fulfilled' ? wk.value : null;
    if (mm.status === 'fulfilled') {
      english = dir === 'es-en' ? mm.value.main : q; spanish = dir === 'es-en' ? q : mm.value.main; alt = mm.value.alt;
      if (dir === 'en-es') { try { wik = await wiktionary(spanish); } catch (e) {} }
    } else if (wik && wik.gloss.length) {
      spanish = q; english = wik.gloss[0].replace(/^\([^)]*\)\s*/, '') || wik.gloss[0]; alt = wik.gloss.slice(1, 2);
    } else {
      throw new Error(navigator.onLine === false ? 'Sin conexión. Conéctate a internet para buscar palabras nuevas.' : 'No se pudo traducir ahora mismo (' + (mm.reason && mm.reason.message || 'sin respuesta') + '). Inténtalo de nuevo.');
    }
    if (F.norm(spanish) === F.norm(english) && !wik) throw new Error('No encontré una traducción fiable para «' + q + '». Revisa la ortografía.');
    const r = { spanish: spanish.trim(), english: english.trim(), alt: alt.filter(a => F.norm(a) !== F.norm(english)), partOfSpeech: wik ? wik.pos : '', example_es: wik && wik.ex ? wik.ex.es : '', example_en: wik && wik.ex ? wik.ex.en : '', grammarNote: reflexive(spanish), source: 'free' };
    if (wik && wik.gloss.length && !r.alt.length) r.alt = wik.gloss.slice(0, 1).filter(g => g.length <= 60 && F.norm(g) !== F.norm(english));
    return r;
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
  F._lookupInternals = { claude, free, myMemory, wiktionary };
})(window.F);
