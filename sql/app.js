(() => {
  'use strict';
  const { days, tables } = window.SQL_PRACTICE;
  const sampleData = window.SQL_SAMPLE_DATA;
  const expectedResults = window.SQL_EXPECTED;
  const allQuestions = days.flatMap(day => day.questions);
  const questionIds = new Set(allQuestions.map(question => question.id));
  const storageKey = 'akshay-sql-practice-v1';
  const state = { version: 1, attempts: {} };
  let currentDay = 1;
  let search = '';
  let storageAvailable = true;
  let engineModulePromise;
  const editorResizeObserver = new ResizeObserver(entries => entries.forEach(entry => syncHighlight(entry.target)));

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const announce = message => { $('#announcement').textContent = message; };
  const sqlKeywords = new Set('SELECT FROM WHERE WITH AS JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY HAVING ORDER LIMIT OFFSET DISTINCT UNION ALL INTERSECT EXCEPT CASE WHEN THEN ELSE END OVER PARTITION ROWS RANGE BETWEEN UNBOUNDED PRECEDING FOLLOWING CURRENT ROW QUALIFY ASC DESC NULLS FIRST LAST AND OR NOT IN IS NULL EXISTS LIKE ILIKE TRUE FALSE CAST TRY_CAST DATE TIMESTAMP INTERVAL RECURSIVE LATERAL FILTER TOP FETCH NEXT ONLY'.split(' '));
  const sqlFunctions = new Set('COUNT SUM AVG MIN MAX COALESCE NULLIF ROW_NUMBER RANK DENSE_RANK LAG LEAD FIRST_VALUE LAST_VALUE NTILE PERCENT_RANK CUME_DIST DATE_TRUNC DATEADD DATEDIFF DATE_DIFF EXTRACT ROUND ABS CEIL FLOOR UPPER LOWER TRIM CONCAT TO_DATE TO_TIMESTAMP TRY_TO_DATE IFF GENERATE_SERIES MEDIAN STDDEV STDDEV_SAMP'.split(' '));
  const sqlToken = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*(?:'|$)|"(?:""|[^"])*(?:"|$)|\b[A-Za-z_][\w$]*\b|\b\d+(?:\.\d+)?\b|[<>!=]=?|[-+*/%])/g;

  function highlightSql(sql) {
    let html = '';
    let last = 0;
    for (const match of sql.matchAll(sqlToken)) {
      const value = match[0];
      html += escapeHtml(sql.slice(last, match.index));
      let kind = '';
      if (value.startsWith('--') || value.startsWith('/*')) kind = 'comment';
      else if (value.startsWith("'") || value.startsWith('"')) kind = 'string';
      else if (/^\d/.test(value)) kind = 'number';
      else if (sqlFunctions.has(value.toUpperCase()) && /^\s*\(/.test(sql.slice(match.index + value.length))) kind = 'function';
      else if (sqlKeywords.has(value.toUpperCase())) kind = 'keyword';
      else if (/^[<>!=+*/%-]/.test(value)) kind = 'operator';
      html += kind ? `<span class="sql-${kind}">${escapeHtml(value)}</span>` : escapeHtml(value);
      last = match.index + value.length;
    }
    return html + escapeHtml(sql.slice(last)) + '\n';
  }

  function syncHighlight(editor) {
    const layer = editor.previousElementSibling;
    layer.innerHTML = highlightSql(editor.value);
    layer.scrollTop = editor.scrollTop;
    layer.scrollLeft = editor.scrollLeft;
    layer.style.width = `${editor.clientWidth + 2}px`;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved && typeof saved.attempts === 'object' && saved.attempts) {
      for (const [id, attempt] of Object.entries(saved.attempts)) {
        if (questionIds.has(id) && attempt && typeof attempt === 'object') {
          state.attempts[id] = {
            draft: typeof attempt.draft === 'string' ? attempt.draft : '',
            submittedSql: typeof attempt.submittedSql === 'string' ? attempt.submittedSql : '',
            submittedAt: typeof attempt.submittedAt === 'string' ? attempt.submittedAt : '',
            passedSql: typeof attempt.passedSql === 'string' ? attempt.passedSql : '',
            passedAt: typeof attempt.passedAt === 'string' ? attempt.passedAt : ''
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
    if (!state.attempts[id]) state.attempts[id] = { draft: '', submittedSql: '', submittedAt: '', passedSql: '', passedAt: '' };
    return state.attempts[id];
  }

  function countSubmitted() {
    return allQuestions.filter(question => Boolean(state.attempts[question.id]?.submittedAt)).length;
  }

  function isPassed(id) {
    const attempt = state.attempts[id];
    return Boolean(attempt?.passedAt && attempt.passedSql.trim() === attempt.draft.trim());
  }

  function updateProgress() {
    const passed = allQuestions.filter(question => isPassed(question.id)).length;
    const completeDays = days.filter(day => day.questions.every(question => isPassed(question.id))).length;
    const percent = Math.round(passed / allQuestions.length * 100);
    $('#submittedCount').textContent = countSubmitted();
    $('#passedCount').textContent = passed;
    $('#questionCount').textContent = allQuestions.length;
    $('#progressPercent').textContent = `${percent}%`;
    $('#progressFill').style.width = `${percent}%`;
    $('#completedDays').textContent = `${completeDays} ${completeDays === 1 ? 'day' : 'days'} complete`;
    $('#daysDoneBadge').textContent = `${completeDays} / ${days.length}`;
  }

  function renderSchema() {
    $('#schemaList').innerHTML = Object.entries(sampleData).map(([name, table]) => `<div class="schema-item"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(table.columns.map(column => `${column.name} ${column.type}`).join(', '))}</span></div>`).join('');
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
      const completed = day.questions.filter(question => isPassed(question.id)).length;
      html += `<button class="day-button ${currentDay === dayNumber ? 'active' : ''}" type="button" data-day="${dayNumber}" aria-current="${currentDay === dayNumber ? 'date' : 'false'}"><span class="day-number">${String(dayNumber).padStart(2, '0')}</span><span class="day-label">${escapeHtml(day.title)}</span><span class="day-complete ${completed === 2 ? 'done' : ''}">${completed}/2</span></button>`;
    });
    list.innerHTML = html || '<p class="empty-search">No matching pattern. Try another search.</p>';
  }

  function statusFor(attempt) {
    if (attempt.passedAt && attempt.draft.trim() === attempt.passedSql.trim()) return { label: 'Sample passed', className: 'submitted' };
    if (attempt.passedAt && attempt.draft.trim() !== attempt.passedSql.trim()) return { label: 'Edited since check', className: 'edited' };
    if (!attempt.submittedAt) return attempt.draft ? { label: 'Draft saved', className: '' } : { label: 'Not started', className: '' };
    if (attempt.draft.trim() !== attempt.submittedSql.trim()) return { label: 'Edited since submission', className: 'edited' };
    return { label: 'Submitted', className: 'submitted' };
  }

  function renderGrid(columns, rows) {
    const head = `<thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead>`;
    const body = rows.length
      ? rows.map(row => `<tr>${row.map(value => `<td class="${value === null ? 'null-cell' : ''}">${value === null ? 'NULL' : escapeHtml(value)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}">No rows</td></tr>`;
    return `<div class="table-scroll"><table>${head}<tbody>${body}</tbody></table></div>`;
  }

  function renderInputTable(name, open) {
    const data = sampleData[name];
    const columns = data.columns.map(column => column.name);
    const definitions = data.columns.map(column => `<span><b>${escapeHtml(column.name)}</b> ${escapeHtml(column.type)}</span>`).join('');
    return `<details class="input-table" ${open ? 'open' : ''}><summary><strong>${escapeHtml(name)}</strong><span>${data.rows.length} sample rows</span></summary><div class="table-definitions">${definitions}</div>${renderGrid(columns, data.rows)}</details>`;
  }

  function renderOutput(expected) {
    const preview = renderGrid(expected.columns, expected.rows.slice(0, 8));
    const more = expected.rows.length > 8
      ? `<details class="all-rows"><summary>View all ${expected.rows.length} expected rows</summary>${renderGrid(expected.columns, expected.rows)}</details>`
      : '';
    return `<section class="expected-output" aria-label="Expected output"><div class="data-heading"><h4>Expected output</h4><span>${expected.rows.length} ${expected.rows.length === 1 ? 'row' : 'rows'} · full result checked</span></div>${preview}${more}</section>`;
  }

  function renderQuestion(question, index) {
    const attempt = state.attempts[question.id] || { draft: '', submittedSql: '', submittedAt: '', passedSql: '', passedAt: '' };
    const status = statusFor(attempt);
    const levelClass = question.level.toLowerCase().replaceAll(' ', '-');
    const expected = expectedResults[question.id];
    return `<article class="question-card" id="${question.id}">
      <div class="question-top">
        <div class="question-meta"><span class="question-index">QUESTION 0${index + 1}</span><span class="difficulty ${levelClass}">${escapeHtml(question.level)}</span><span class="question-status ${status.className}" data-status-for="${question.id}">${status.label}</span></div>
        <h3>${escapeHtml(question.title)}</h3>
        <p class="question-prompt">${escapeHtml(question.prompt)}</p>
        <div class="table-tags" aria-label="Tables used">${question.uses.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>
        <section class="input-output" aria-label="Sample data for ${escapeHtml(question.title)}">
          <div class="data-heading"><h4>Table structure &amp; sample input</h4><span>Click a table to inspect every row</span></div>
          <div class="input-tables">${question.uses.map((name, tableIndex) => renderInputTable(name, tableIndex === 0)).join('')}</div>
          ${renderOutput(expected)}
        </section>
        <details class="follow-up"><summary>Stretch follow-up</summary><p>${escapeHtml(question.followUp)}</p></details>
      </div>
      <div class="editor-area">
        <div class="editor-heading"><label for="answer-${question.id}">YOUR SQL</label><small>Draft saves as you type · DuckDB checks the sample · verify final syntax in Snowflake</small></div>
        <div class="code-editor"><pre class="sql-highlight" aria-hidden="true"></pre><textarea class="answer-editor" id="answer-${question.id}" data-question="${question.id}" spellcheck="false" placeholder="-- Write your SQL here. Include assumptions in comments if needed.">${escapeHtml(attempt.draft)}</textarea></div>
        <div class="question-actions"><span class="save-status" data-save-for="${question.id}">${attempt.submittedAt ? `Last submitted ${escapeHtml(new Date(attempt.submittedAt).toLocaleString())}` : 'Not submitted yet'}</span><div class="answer-buttons"><button class="run-button" type="button" data-run="${question.id}">Run &amp; check</button><button type="button" data-submit="${question.id}">${attempt.submittedAt ? 'Resubmit answer' : 'Submit answer'}</button></div></div>
        <div class="run-result" data-result-for="${question.id}" aria-live="polite"></div>
      </div>
    </article>`;
  }

  function renderDay() {
    const day = days[currentDay - 1];
    $('#dayKicker').textContent = `DAY ${String(currentDay).padStart(2, '0')} · NOV ${String(currentDay).padStart(2, '0')}`;
    $('#dayTitle').textContent = day.title;
    $('#dayFocus').textContent = day.focus;
    editorResizeObserver.disconnect();
    $('#questions').innerHTML = day.questions.map(renderQuestion).join('');
    $('#questions').querySelectorAll('.answer-editor').forEach(editor => {
      syncHighlight(editor);
      editorResizeObserver.observe(editor);
    });
    $('#previousDay').disabled = currentDay === 1;
    $('#nextDay').disabled = currentDay === days.length;
  }

  function canonical(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number(value.toFixed(6));
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'boolean') return value;
    const text = String(value).replace('T', ' ').replace(/Z$/, '').replace(/\.0+$/, '');
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(Number(text).toFixed(6));
    return text.endsWith(' 00:00:00') ? text.slice(0, 10) : text;
  }

  function rowSignatures(rows) {
    return rows.map(row => JSON.stringify(row.map(canonical))).sort();
  }

  function matchesExpected(actual, expected) {
    if (actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) return false;
    const actualRows = rowSignatures(actual.rows);
    const expectedRows = rowSignatures(expected.rows);
    return actualRows.every((row, index) => row === expectedRows[index]);
  }

  function differenceSummary(actual, expected) {
    if (actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) {
      return `Expected ${expected.rows.length} rows and ${expected.columns.length} columns; your query returned ${actual.rows.length} rows and ${actual.columns.length} columns.`;
    }
    const actualRows = rowSignatures(actual.rows);
    const expectedRows = rowSignatures(expected.rows);
    const firstMissing = expectedRows.find(row => !actualRows.includes(row));
    return firstMissing ? `At least one expected row is missing or has different values: ${firstMissing}. Compare your output with the expected table above.` : 'The rows differ from the expected output. Compare the values above.';
  }

  async function runAnswer(id, button) {
    const editor = document.querySelector(`#answer-${id}`);
    if (!editor.value.trim()) { editor.focus(); announce('Write a SQL answer before running it.'); return; }
    const sql = editor.value;
    const resultBox = document.querySelector(`[data-result-for="${id}"]`);
    const attempt = attemptFor(id);
    attempt.draft = sql;
    persist();
    button.disabled = true;
    button.textContent = 'Loading local engine…';
    resultBox.innerHTML = '<p class="run-loading">Preparing fresh sample tables. The first run downloads the local SQL engine.</p>';
    try {
      engineModulePromise ||= import('./engine.mjs');
      const engine = await engineModulePromise;
      button.textContent = 'Running…';
      const actual = await engine.runQuery(sql);
      const expected = expectedResults[id];
      const passed = matchesExpected(actual, expected);
      if (passed && editor.value === sql) {
        attempt.passedSql = sql;
        attempt.passedAt = new Date().toISOString();
        persist(); updateProgress(); renderDays();
        const status = document.querySelector(`[data-status-for="${id}"]`);
        status.textContent = 'Sample passed'; status.className = 'question-status submitted';
      }
      const summary = passed
        ? `Matches expected output: ${actual.rows.length} ${actual.rows.length === 1 ? 'row' : 'rows'}.`
        : `Output differs. ${differenceSummary(actual, expected)}`;
      resultBox.innerHTML = `<div class="run-feedback ${passed ? 'pass' : 'fail'}"><strong>${passed ? '✓ Sample check passed' : 'Check the difference'}</strong><span>${escapeHtml(summary)}</span></div><div class="actual-output"><div class="data-heading"><h4>Your output</h4><span>${actual.rows.length} ${actual.rows.length === 1 ? 'row' : 'rows'} · order ignored in comparison</span></div>${renderGrid(actual.columns, actual.rows.slice(0, 8))}${actual.rows.length > 8 ? `<details class="all-rows"><summary>View all ${actual.rows.length} rows</summary>${renderGrid(actual.columns, actual.rows)}</details>` : ''}</div>`;
      announce(summary);
    } catch (error) {
      if (engineModulePromise && /module|fetch|load/i.test(error.message || '')) engineModulePromise = null;
      const message = error.message === '_setThrew is not defined'
        ? 'The SQL engine rejected this query. Check its syntax, table names, and DuckDB support, then try again.'
        : error.message || 'The local SQL engine failed to load.';
      resultBox.innerHTML = `<div class="run-feedback fail"><strong>Could not run this query</strong><span>${escapeHtml(message)}</span></div>`;
      announce(message);
    } finally {
      button.disabled = false;
      button.textContent = 'Run & check';
    }
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
        state.attempts[id] = { draft: attempt.draft, submittedSql: attempt.submittedSql, submittedAt: attempt.submittedAt,
          passedSql: typeof attempt.passedSql === 'string' ? attempt.passedSql : '',
          passedAt: typeof attempt.passedAt === 'string' ? attempt.passedAt : '' };
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
    syncHighlight(editor);
    const attempt = attemptFor(id);
    attempt.draft = editor.value;
    persist();
    const status = statusFor(attempt);
    const statusElement = document.querySelector(`[data-status-for="${id}"]`);
    statusElement.textContent = status.label;
    statusElement.className = `question-status ${status.className}`;
    updateProgress(); renderDays();
  });
  $('#questions').addEventListener('scroll', event => {
    if (event.target.matches('.answer-editor')) syncHighlight(event.target);
  }, true);
  $('#questions').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !event.target.matches('.answer-editor')) return;
    event.preventDefault();
    const editor = event.target;
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#questions').addEventListener('click', event => {
    const runButton = event.target.closest('[data-run]');
    if (runButton) { runAnswer(runButton.dataset.run, runButton); return; }
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
    const statusValue = statusFor(attempt);
    status.textContent = statusValue.label; status.className = `question-status ${statusValue.className}`;
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
