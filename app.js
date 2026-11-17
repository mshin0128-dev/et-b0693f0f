/* 英単語帳 — アプリ本体。ビルド不要、file:// で動作。 */
(() => {
  'use strict';

  const TOTAL_SETS = 5;
  const SET_SIZE = 100;
  const TEST_LEN = 10;
  const KEY = 'eitango:v1';

  /* ---------- データ ---------- */
  const bySet = {};
  for (let s = 1; s <= TOTAL_SETS; s++) bySet[s] = WORDS.filter(w => w.set === s);
  const hasData = s => bySet[s].length > 0;
  const wid = w => w.set + ':' + w.word;
  const byId = new Map(WORDS.map(w => [wid(w), w]));

  /* ---------- 保存 ---------- */
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function normalize(d) {
    d = isObj(d) ? d : {};
    return {
      learned: isObj(d.learned) ? d.learned : {},
      wrong: isObj(d.wrong) ? d.wrong : {},
      results: Array.isArray(d.results) ? d.results : [],
    };
  }
  let storageOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { storageOk = false; }
    return normalize({});
  }
  const state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { storageOk = false; }
    document.getElementById('notice').hidden = storageOk;
  }
  document.getElementById('notice').hidden = storageOk;

  /* ---------- 集計 ---------- */
  const learnedIn = s => bySet[s].filter(w => state.learned[wid(w)]).length;
  const learnedAll = () => WORDS.filter(w => state.learned[wid(w)]).length;
  const wrongWords = () => Object.keys(state.wrong).map(id => byId.get(id)).filter(Boolean);
  const setResults = s => state.results.filter(r => r.set === s);
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); };

  /* ---------- ユーティリティ ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
  const bar = (n, d) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${d}" aria-valuenow="${n}"><i style="width:${pct(n, d)}%"></i></div>`;
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    next: svg('<path d="M9 5l7 7-7 7"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  };
  const posLabel = w => w.pos;

  /* ---------- 状態（メモリ上） ---------- */
  let study = null;   // {set, deck, i, flipped, filter}
  let session = null; // テスト中の状態

  /* ---------- ルーティング ---------- */
  const app = document.getElementById('app');
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
  const route = () => {
    const [, name, arg] = location.hash.split('/');
    return { name: name || 'home', set: parseInt(arg, 10) };
  };

  function render() {
    const r = route();
    let html = '', focusSel = '[data-title]';
    if (r.name === 'study' && r.set >= 1 && r.set <= TOTAL_SETS && hasData(r.set)) {
      if (!study || study.set !== r.set) startStudy(r.set);
      html = viewStudy();
    } else if (r.name === 'test' && session && session.kind === 'set' && session.set === r.set) {
      ({ html, focusSel } = viewTest());
    } else if (r.name === 'retest' && session && session.kind === 'retest') {
      ({ html, focusSel } = viewTest());
    } else if (r.name === 'wrong') {
      html = viewWrong();
    } else {
      if (r.name !== 'home') { history.replaceState(null, '', location.pathname + location.search); }
      html = viewHome();
    }
    app.innerHTML = html;
    const f = app.querySelector(focusSel) || app.querySelector('[data-title]');
    if (f) f.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ---------- ホーム ---------- */
  function nextAction() {
    for (let s = 1; s <= TOTAL_SETS; s++) {
      if (!hasData(s)) continue;
      const idx = bySet[s].findIndex(w => !state.learned[wid(w)]);
      if (idx >= 0) return { kind: 'study', set: s, label: `セット${s}の学習を続ける`, sub: idx === 0 ? '1語目から' : `${idx + 1}語目から` };
    }
    return { kind: 'test', set: 1, label: 'セット1のテストを受ける', sub: '全語を学習済み' };
  }

  function viewHome() {
    const na = nextAction();
    const wrongN = wrongWords().length;
    const totalAvail = TOTAL_SETS * SET_SIZE;
    const lAll = learnedAll();
    const sets = [];
    for (let s = 1; s <= TOTAL_SETS; s++) {
      if (!hasData(s)) {
        sets.push(`<li class="set soon"><div class="set-head"><h3>セット${s}</h3><span class="soon-tag">準備中</span></div><p class="set-score">100語・近日公開</p></li>`);
        continue;
      }
      const n = bySet[s].length, l = learnedIn(s);
      const rs = setResults(s);
      const last = rs[rs.length - 1];
      const best = rs.reduce((m, r) => Math.max(m, r.score), 0);
      const score = last
        ? `前回 ${last.score}/${last.total}（${fmtDate(last.at)}）・最高 ${best}/${last.total}`
        : 'テスト未受験';
      sets.push(`<li class="set">
        <div class="set-head"><h3>セット${s}</h3><span class="num">覚えた ${l} / ${n}語</span></div>
        ${bar(l, n)}
        <p class="set-score num">${score}</p>
        <div class="set-actions">
          <button class="btn" data-action="study" data-set="${s}">学習</button>
          <button class="btn" data-action="start-test" data-set="${s}">テスト</button>
        </div></li>`);
    }
    return `<div class="screen">
      <header class="masthead"><h1 tabindex="-1" data-title>英単語帳</h1><p>TOEIC高得点レベルの500語</p></header>
      <section class="next" aria-label="次にやること">
        <button class="btn btn-primary" data-action="${na.kind === 'study' ? 'study' : 'start-test'}" data-set="${na.set}"><span>${na.label}</span><small>${na.sub}</small></button>
      </section>
      <section class="overall" aria-label="全体の進捗">
        <p><span>全体の進捗</span><span class="num"><strong>${lAll}</strong> / ${totalAvail}語</span></p>
        ${bar(lAll, totalAvail)}
      </section>
      ${wrongN ? `<button class="queue" data-action="wrong"><span><b class="num">${wrongN}語</b>の間違いを復習する</span>${ICON.next}</button>` : ''}
      <h2 class="sets-title">セット</h2>
      <ul class="sets">${sets.join('')}</ul>
    </div>`;
  }

  /* ---------- 学習 ---------- */
  function startStudy(s, filter = 'all') {
    const all = bySet[s];
    let deck = all;
    if (filter === 'unlearned') deck = all.filter(w => !state.learned[wid(w)]);
    let i = 0;
    if (filter === 'all') { const f = all.findIndex(w => !state.learned[wid(w)]); i = f < 0 ? 0 : f; }
    study = { set: s, deck, i, flipped: false, filter };
  }

  function viewStudy() {
    const st = study, deck = st.deck;
    if (!deck.length) {
      return `<div class="screen study">
        <div class="topbar"><button class="icon-btn" data-action="home" aria-label="ホームへ戻る">${ICON.back}</button><h1 tabindex="-1" data-title>セット${st.set}</h1><span></span></div>
        <div class="empty"><h2>未習得の単語はありません</h2><p>セット${st.set}の全${bySet[st.set].length}語を覚えました。テストで定着を確かめましょう。</p></div>
        <div class="actions">
          <button class="btn btn-primary" data-action="start-test" data-set="${st.set}">セット${st.set}のテストを受ける</button>
          <button class="btn" data-action="filter" data-filter="all">すべての単語を見る</button>
        </div></div>`;
    }
    const w = deck[st.i];
    const learned = !!state.learned[wid(w)];
    const last = st.i === deck.length - 1;
    return `<div class="screen study">
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="ホームへ戻る">${ICON.back}</button>
        <h1 tabindex="-1" data-title>セット${st.set}</h1>
        <span class="count num" id="count">${st.i + 1} / ${deck.length}</span>
      </div>
      <div id="deckbar">${bar(st.i + 1, deck.length)}</div>
      <div class="seg" role="group" aria-label="表示する単語">
        <button data-action="filter" data-filter="all" aria-pressed="${st.filter === 'all'}">すべて</button>
        <button data-action="filter" data-filter="unlearned" aria-pressed="${st.filter === 'unlearned'}">未習得のみ</button>
      </div>
      <div class="deck">
        <button class="card ${st.flipped ? 'is-flipped' : ''} ${learned ? 'is-learned' : ''}" id="card" data-action="flip" aria-label="カード：タップして表と裏を切り替え">
          <span class="card-inner">
            <span class="face front" id="front" ${st.flipped ? 'aria-hidden="true"' : ''}>
              <span class="headword en">${esc(w.word)}</span>
              <span class="pos">${esc(posLabel(w))}</span>
              <span class="flip-hint">タップして意味を見る</span>
            </span>
            <span class="face back" id="back" ${st.flipped ? '' : 'aria-hidden="true"'}>
              <span class="back-top"><span class="en">${esc(w.word)}</span><span class="pos">${esc(posLabel(w))}</span></span>
              <span class="meaning">${esc(w.meaning)}</span>
              <span class="field"><span class="field-label">例文</span><span class="example en">${esc(w.example)}</span><span class="example-ja">${esc(w.exampleJa)}</span></span>
              <span class="field"><span class="field-label">覚え方</span><span class="hint">${esc(w.hint)}</span></span>
            </span>
          </span>
        </button>
      </div>
      <div class="dock">
        <button class="btn btn-block learn-btn" id="learn" data-action="learned" aria-pressed="${learned}"><span class="box">${ICON.check}</span><span id="learn-label">${learned ? '覚えた' : '覚えたらチェック'}</span></button>
        <div class="dock-nav">
          <button class="btn" data-action="prev" ${st.i === 0 ? 'disabled' : ''}>${ICON.back}前へ</button>
          ${last
            ? `<button class="btn btn-primary" data-action="start-test" data-set="${st.set}">テストへ${ICON.next}</button>`
            : `<button class="btn btn-primary" data-action="next">次へ${ICON.next}</button>`}
        </div>
      </div>
    </div>`;
  }

  function flipCard() {
    if (!study) return;
    study.flipped = !study.flipped;
    const card = document.getElementById('card');
    card.classList.toggle('is-flipped', study.flipped);
    document.getElementById('front').setAttribute('aria-hidden', String(study.flipped));
    document.getElementById('back').setAttribute('aria-hidden', String(!study.flipped));
  }

  function toggleLearned() {
    const w = study.deck[study.i], id = wid(w);
    if (state.learned[id]) delete state.learned[id]; else state.learned[id] = new Date().toISOString();
    save();
    const on = !!state.learned[id];
    const btn = document.getElementById('learn');
    btn.setAttribute('aria-pressed', String(on));
    document.getElementById('learn-label').textContent = on ? '覚えた' : '覚えたらチェック';
    document.getElementById('card').classList.toggle('is-learned', on);
  }

  function moveStudy(d) {
    const n = study.i + d;
    if (n < 0 || n >= study.deck.length) return;
    study.i = n; study.flipped = false;
    const keep = d > 0 ? '[data-action="next"],[data-action="start-test"]' : '[data-action="prev"]';
    app.innerHTML = viewStudy();
    const f = app.querySelector(keep) || app.querySelector('[data-title]');
    if (f && !f.disabled) f.focus({ preventScroll: true });
  }

  /* ---------- テスト ---------- */
  const tokens = m => m.split(/[、／]/).map(t => t.trim()).filter(Boolean);
  function buildChoices(w, taken) {
    // 似た意味（語句が重なるもの）を誤答から除外し、品詞が同じものを優先
    const good = tokens(w.meaning);
    const chosen = [w.meaning];
    let used = new Set(good);
    const pool = shuffle(WORDS.filter(x => x !== w && x.meaning !== w.meaning));
    const samePos = pool.filter(x => x.pos.split('・')[0] === w.pos.split('・')[0]);
    for (const x of samePos.concat(pool)) {
      if (chosen.length === 4) break;
      if (chosen.includes(x.meaning)) continue;
      const t = tokens(x.meaning);
      if (t.some(k => used.has(k))) continue;
      chosen.push(x.meaning); t.forEach(k => used.add(k));
    }
    return shuffle(chosen);
  }

  function startTest(kind, s) {
    let words;
    if (kind === 'retest') words = shuffle(wrongWords()).slice(0, TEST_LEN);
    else words = shuffle(bySet[s]).slice(0, TEST_LEN);
    if (!words.length) { go('#/'); return; }
    session = {
      kind, set: s || 0, i: 0, done: false,
      qs: words.map(w => ({ w, choices: buildChoices(w), picked: null })),
    };
    go(kind === 'retest' ? '#/retest' : '#/test/' + s);
  }

  const title = () => session.kind === 'retest' ? '再テスト' : `セット${session.set} テスト`;

  function viewTest() {
    const ss = session;
    if (ss.done) return { html: viewResult(), focusSel: '[data-title]' };
    const q = ss.qs[ss.i], w = q.w, answered = q.picked !== null;
    const correct = answered && q.picked === w.meaning;
    const choices = q.choices.map((c, idx) => {
      let cls = '', icon = '';
      if (answered) {
        if (c === w.meaning) { cls = 'is-right'; icon = ICON.check; }
        else if (c === q.picked) { cls = 'is-wrong'; icon = ICON.cross; }
        else cls = 'is-dim';
      }
      return `<li><button class="choice ${cls}" data-action="answer" data-idx="${idx}" ${answered ? 'disabled' : ''}><span>${esc(c)}</span>${icon}</button></li>`;
    }).join('');
    const verdict = answered ? `<div class="verdict" role="status">
        <strong class="${correct ? 'right' : 'wrong'}">${correct ? '正解' : '不正解'}</strong>
        ${correct ? '' : `<p class="hint">${esc(w.hint)}</p>`}
      </div>` : '<div class="verdict"></div>';
    const lastQ = ss.i === ss.qs.length - 1;
    const html = `<div class="screen test">
      <div class="topbar">
        <button class="icon-btn" data-action="quit-test" aria-label="テストをやめてホームへ戻る">${ICON.back}</button>
        <h1 data-title tabindex="-1">${title()}</h1>
        <span class="count num">${ss.i + 1} / ${ss.qs.length}</span>
      </div>
      ${bar(ss.i + (answered ? 1 : 0), ss.qs.length)}
      <div class="q"><div class="headword en">${esc(w.word)}</div><div class="pos">${esc(posLabel(w))}</div></div>
      <ul class="choices">${choices}</ul>
      ${verdict}
      <div class="actions" style="margin-top:auto">
        ${answered ? `<button class="btn btn-primary btn-block" data-action="next-q" data-autofocus>${lastQ ? '結果を見る' : '次の問題'}${ICON.next}</button>` : ''}
      </div>
    </div>`;
    return { html, focusSel: answered ? '[data-autofocus]' : '[data-title]' };
  }

  function answer(idx) {
    const q = session.qs[session.i];
    if (q.picked !== null) return;
    q.picked = q.choices[idx];
    const id = wid(q.w);
    if (q.picked === q.w.meaning) { delete state.wrong[id]; }
    else { state.wrong[id] = new Date().toISOString(); }
    save();
    const r = viewTest();
    app.innerHTML = r.html;
    const f = app.querySelector(r.focusSel);
    if (f) f.focus({ preventScroll: true });
  }

  function nextQ() {
    const q = session.qs[session.i];
    if (q.picked === null) return;
    if (session.i < session.qs.length - 1) session.i++;
    else {
      session.done = true;
      if (session.kind === 'set') {
        const score = session.qs.filter(x => x.picked === x.w.meaning).length;
        state.results.push({ set: session.set, score, total: session.qs.length, at: new Date().toISOString() });
        if (state.results.length > 200) state.results = state.results.slice(-200);
        save();
      }
    }
    render();
  }

  function viewResult() {
    const ss = session;
    const total = ss.qs.length;
    const missed = ss.qs.filter(q => q.picked !== q.w.meaning);
    const score = total - missed.length;
    const remaining = wrongWords().length;
    const msg = missed.length === 0
      ? '全問正解です。'
      : `${missed.length}語を間違えました。下の単語は復習リストに入っています。`;
    const retake = ss.kind === 'retest'
      ? (remaining ? `<button class="btn btn-primary" data-action="restart">残り${remaining}語を再テスト</button>` : '')
      : `<button class="btn" data-action="restart">もう一度テスト</button>`;
    return `<div class="screen result">
      <div class="topbar"><button class="icon-btn" data-action="quit-test" aria-label="ホームへ戻る">${ICON.back}</button><h1 data-title tabindex="-1">${title()}の結果</h1><span></span></div>
      <section class="score">
        <p class="big num">${score} / ${total}</p>
        <p>${msg}</p>
      </section>
      ${missed.length ? `<section><h2 class="section-title">間違えた単語</h2><ul class="list">${missed.map(q => `<li>
          <div class="row"><span class="en">${esc(q.w.word)}</span><span class="meta">${esc(posLabel(q.w))}</span></div>
          <span class="m">${esc(q.w.meaning)}</span><span class="h">${esc(q.w.hint)}</span></li>`).join('')}</ul></section>` : ''}
      <div class="actions">
        ${missed.length && ss.kind === 'set' ? `<button class="btn btn-primary" data-action="wrong">間違えた単語を復習する</button>` : ''}
        ${retake}
        <button class="btn" data-action="home">ホームへ</button>
      </div>
    </div>`;
  }

  /* ---------- 間違えた単語 ---------- */
  function viewWrong() {
    const list = wrongWords();
    const head = `<div class="topbar"><button class="icon-btn" data-action="home" aria-label="ホームへ戻る">${ICON.back}</button><h1 tabindex="-1" data-title>間違えた単語</h1><span class="count num">${list.length}語</span></div>`;
    if (!list.length) {
      return `<div class="screen">${head}
        <div class="empty"><h2>復習する単語はありません</h2><p>テストで間違えた単語がここに集まり、再テストで正解すると消えます。</p></div>
        <div class="actions"><button class="btn btn-primary" data-action="home">ホームへ</button></div></div>`;
    }
    const sorted = list.slice().sort((a, b) => state.wrong[wid(b)].localeCompare(state.wrong[wid(a)]));
    return `<div class="screen">${head}
      <div class="actions" style="margin:1rem 0 0.5rem">
        <button class="btn btn-primary" data-action="start-retest">再テストを始める${list.length > TEST_LEN ? `（${TEST_LEN}問）` : ''}</button>
      </div>
      <ul class="list">${sorted.map(w => `<li>
        <div class="row"><span class="en">${esc(w.word)}</span><span class="meta num">セット${w.set}・${fmtDate(state.wrong[wid(w)])}</span></div>
        <span class="m">${esc(w.meaning)}</span><span class="h">${esc(w.hint)}</span></li>`).join('')}</ul>
    </div>`;
  }

  /* ---------- イベント ---------- */
  app.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action, s = parseInt(el.dataset.set, 10);
    switch (a) {
      case 'home': go('#/'); break;
      case 'study': study = null; go('#/study/' + s); break;
      case 'wrong': go('#/wrong'); break;
      case 'start-test': startTest('set', s); break;
      case 'start-retest': startTest('retest'); break;
      case 'restart': session.kind === 'retest' ? startTest('retest') : startTest('set', session.set); break;
      case 'quit-test': session = null; go('#/'); break;
      case 'flip': flipCard(); break;
      case 'learned': toggleLearned(); break;
      case 'prev': moveStudy(-1); break;
      case 'next': moveStudy(1); break;
      case 'filter': startStudy(study.set, el.dataset.filter); render(); break;
      case 'answer': answer(parseInt(el.dataset.idx, 10)); break;
      case 'next-q': nextQ(); break;
    }
  });

  // スワイプで前後へ
  let tx = 0, ty = 0;
  app.addEventListener('touchstart', e => { if (e.target.closest('#card')) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } else tx = 0; }, { passive: true });
  app.addEventListener('touchend', e => {
    if (!tx || !study) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    tx = 0;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) moveStudy(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (!study || route().name !== 'study' || !study.deck.length) return;
    if (e.key === 'ArrowRight') moveStudy(1);
    else if (e.key === 'ArrowLeft') moveStudy(-1);
  });

  window.addEventListener('hashchange', render);
  render();
})();
