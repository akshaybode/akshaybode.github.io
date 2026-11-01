(() => {
  'use strict';
  const { days, tables } = window.SQL_PRACTICE;
  const allQuestions = days.flatMap(day => day.questions);
  const questionIds = new Set(allQuestions.map(question => question.id));
  const storageKey = 'akshay-sql-practice-v1';
  const state = { version: 1, attempts: {} };
  let currentDay = 1;
  let search = '';
  let storageAvailable = true;

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const announce = message => { $('#announcement').textContent = message; };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved && typeof saved.attempts === 'object' && saved.attempts) {
      for (const [id, attempt] of Object.entries(saved.attempts)) {
        if (questionIds.has(id) && attempt && typeof attempt === 'object') {
          state.attempts[id] = {
            draft: typeof attempt.draft === 'string' ? attempt.draft : '',
            submittedSql: typeof attempt.submittedSql === 'string' ? attempt.submittedSql : '',
            submittedAt: typeof attempt.submittedAt === 'string' ? attempt.submittedAt : ''
          };
        }
      }
    }
  } catch (error) {
    storageAvailable = false;
    announce('Browser storage is unavailable. Export your answers before leaving.');
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); storageAvailable = true; }
    catch (error) { storageAvailable = false; announce('Could not save in this browser. Export your answers before leaving.'); }
  }

  function attemptFor(id) {
    if (!state.attempts[id]) state.attempts[id] = { draft: '', submittedSql: '', submittedAt: '' };
    return state.attempts[id];
  }

  function countSubmitted() {
    return allQuestions.filter(question => Boolean(state.attempts[question.id]?.submittedAt)).length;
  }

  function updateProgress() {
    const submitted = countSubmitted();
    const completeDays = days.filter(day => day.questions.every(question => state.attempts[question.id]?.submittedAt)).length;
    const percent = Math.round(submitted / allQuestions.length * 100);
    $('#submittedCount').textContent = submitted;
    $('#questionCount').textContent = allQuestions.length;
    $('#progressPercent').textContent = `${percent}%`;
    $('#progressFill').style.width = `${percent}%`;
    $('#completedDays').textContent = `${completeDays} ${completeDays === 1 ? 'day' : 'days'} complete`;
    $('#daysDoneBadge').textContent = `${completeDays} / ${days.length}`;
  }

  function renderSchema() {
    $('#schemaList').innerHTML = Object.entries(tables).map(([name, columns]) => `<div class="schema-item"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(columns)}</span></div>`).join('');
  }

  function renderDays() {
    const list = $('#dayList');
    let html = '';
    let previousWeek = 0;
    days.forEach((day, index) => {
      const dayNumber = index + 1;
      const matches = !search || `${day.title} ${day.focus} ${day.questions.map(question => `${question.title} ${question.prompt}`).join(' ')}`.toLowerCase().includes(search);
      if (!matches) return;
      const week = Math.floor(index / 7) + 1;
      if (week !== previousWeek) { html += `<div class="week-label">WEEK ${String(week).padStart(2, '0')}</div>`; previousWeek = week; }
      const completed = day.questions.filter(question => state.attempts[question.id]?.submittedAt).length;
      html += `<button class="day-button ${currentDay === dayNumber ? 'active' : ''}" type="button" data-day="${dayNumber}" aria-current="${currentDay === dayNumber ? 'date' : 'false'}"><span class="day-number">${String(dayNumber).padStart(2, '0')}</span><span class="day-label">${escapeHtml(day.title)}</span><span class="day-complete ${completed === 2 ? 'done' : ''}">${completed}/2</span></button>`;
    });
    list.innerHTML = html || '<p class="empty-search">No matching pattern. Try another search.</p>';
  }

  function statusFor(attempt) {
    if (!attempt.submittedAt) return attempt.draft ? { label: 'Draft saved', className: '' } : { label: 'Not started', className: '' };
    if (attempt.draft.trim() !== attempt.submittedSql.trim()) return { label: 'Edited since submission', className: 'edited' };
    return { label: 'Submitted', className: 'submitted' };
  }

  function renderQuestion(question, index) {
    const attempt = state.attempts[question.id] || { draft: '', submittedSql: '', submittedAt: '' };
    const status = statusFor(attempt);
    const levelClass = question.level.toLowerCase().replaceAll(' ', '-');
    return `<article class="question-card" id="${question.id}">
      <div class="question-top">
        <div class="question-meta"><span class="question-index">QUESTION 0${index + 1}</span><span class="difficulty ${levelClass}">${escapeHtml(question.level)}</span><span class="question-status ${status.className}" data-status-for="${question.id}">${status.label}</span></div>
        <h3>${escapeHtml(question.title)}</h3>
        <p class="question-prompt">${escapeHtml(question.prompt)}</p>
        <div class="table-tags" aria-label="Tables used">${question.uses.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>
        <details class="follow-up"><summary>Stretch follow-up</summary><p>${escapeHtml(question.followUp)}</p></details>
      </div>
      <div class="editor-area">
        <div class="editor-heading"><label for="answer-${question.id}">YOUR SQL</label><small>Draft saves as you type · run it in Snowflake to verify</small></div>
        <textarea class="answer-editor" id="answer-${question.id}" data-question="${question.id}" spellcheck="false" placeholder="-- Write your SQL here. Include assumptions in comments if needed.">${escapeHtml(attempt.draft)}</textarea>
        <div class="question-actions"><span class="save-status" data-save-for="${question.id}">${attempt.submittedAt ? `Last submitted ${escapeHtml(new Date(attempt.submittedAt).toLocaleString())}` : 'Not submitted yet'}</span><button type="button" data-submit="${question.id}">${attempt.submittedAt ? 'Resubmit answer' : 'Submit answer'}</button></div>
      </div>
    </article>`;
  }

  function renderDay() {
    const day = days[currentDay - 1];
    $('#dayKicker').textContent = `DAY ${String(currentDay).padStart(2, '0')} · NOV ${String(currentDay).padStart(2, '0')}`;
    $('#dayTitle').textContent = day.title;
    $('#dayFocus').textContent = day.focus;
    $('#questions').innerHTML = day.questions.map(renderQuestion).join('');
    $('#previousDay').disabled = currentDay === 1;
    $('#nextDay').disabled = currentDay === days.length;
  }

  function selectDay(dayNumber, scroll = false) {
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > days.length) return;
    currentDay = dayNumber;
    const url = new URL(location.href);
    url.searchParams.set('day', String(dayNumber));
    history.replaceState(null, '', url);
    renderDays(); renderDay();
    if (scroll) $('#dayPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSql() {
    const lines = ['-- SQL Practice · November 2026', '-- Exported from this browser. Questions are intentionally not answered by the site.', ''];
    for (const question of allQuestions) {
      const attempt = state.attempts[question.id];
      if (!attempt || !(attempt.submittedSql || attempt.draft).trim()) continue;
      lines.push(`-- Day ${String(question.day).padStart(2, '0')} · ${question.title}`);
      const isSubmittedVersion = attempt.submittedAt && attempt.draft.trim() === attempt.submittedSql.trim();
      lines.push(`-- ${isSubmittedVersion ? `Submitted ${attempt.submittedAt}` : 'Current draft; not yet submitted'}`);
      lines.push(attempt.draft.trim(), '', '');
    }
    download('sql-practice-answers.sql', lines.join('\n'), 'text/sql');
    announce('SQL answers exported.');
  }

  function exportJson() {
    download('sql-practice-backup.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), attempts: state.attempts }, null, 2), 'application/json');
    announce('Backup exported.');
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (imported?.version !== 1 || !imported.attempts || typeof imported.attempts !== 'object') throw new Error('This is not a SQL Practice backup.');
      let restored = 0;
      for (const [id, attempt] of Object.entries(imported.attempts)) {
        if (!questionIds.has(id) || !attempt || typeof attempt !== 'object') continue;
        const valid = ['draft', 'submittedSql', 'submittedAt'].every(key => typeof attempt[key] === 'string');
        if (!valid) continue;
        state.attempts[id] = { draft: attempt.draft, submittedSql: attempt.submittedSql, submittedAt: attempt.submittedAt };
        if (attempt.draft.trim() || attempt.submittedSql.trim()) restored++;
      }
      persist(); updateProgress(); renderDays(); renderDay();
      announce(`${restored} answers restored from backup.`);
    } catch (error) { announce(error.message || 'Could not read that backup.'); }
    $('#importFile').value = '';
  }

  $('#dayList').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (button) selectDay(Number(button.dataset.day), true);
  });
  $('#daySearch').addEventListener('input', event => { search = event.target.value.trim().toLowerCase(); renderDays(); });
  $('#previousDay').addEventListener('click', () => selectDay(currentDay - 1, true));
  $('#nextDay').addEventListener('click', () => selectDay(currentDay + 1, true));
  $('#questions').addEventListener('input', event => {
    const editor = event.target.closest('[data-question]');
    if (!editor) return;
    const id = editor.dataset.question;
    const attempt = attemptFor(id);
    attempt.draft = editor.value;
    persist();
    const status = statusFor(attempt);
    const statusElement = document.querySelector(`[data-status-for="${id}"]`);
    statusElement.textContent = status.label;
    statusElement.className = `question-status ${status.className}`;
  });
  $('#questions').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !event.target.matches('.answer-editor')) return;
    event.preventDefault();
    const editor = event.target;
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#questions').addEventListener('click', event => {
    const button = event.target.closest('[data-submit]');
    if (!button) return;
    const id = button.dataset.submit;
    const editor = document.querySelector(`#answer-${id}`);
    if (!editor.value.trim()) { editor.focus(); announce('Write a SQL answer before submitting.'); return; }
    const attempt = attemptFor(id);
    attempt.draft = editor.value;
    attempt.submittedSql = editor.value;
    attempt.submittedAt = new Date().toISOString();
    persist(); updateProgress(); renderDays();
    const status = document.querySelector(`[data-status-for="${id}"]`);
    status.textContent = 'Submitted'; status.className = 'question-status submitted';
    document.querySelector(`[data-save-for="${id}"]`).textContent = `Last submitted ${new Date(attempt.submittedAt).toLocaleString()}${storageAvailable ? '' : ' · export now'}`;
    button.textContent = 'Resubmit answer';
    announce('Answer saved privately in this browser.');
  });
  $('#exportSql').addEventListener('click', exportSql);
  $('#exportJson').addEventListener('click', exportJson);
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', event => importJson(event.target.files?.[0]));

  renderSchema(); updateProgress();
  const urlDay = Number(new URL(location.href).searchParams.get('day'));
  const firstUnfinished = days.findIndex(day => day.questions.some(question => !state.attempts[question.id]?.submittedAt)) + 1;
  selectDay(Number.isInteger(urlDay) && urlDay >= 1 && urlDay <= 30 ? urlDay : firstUnfinished || 30);
})();
