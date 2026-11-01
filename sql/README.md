# SQL Practice Lab

Static GitHub Pages page at `/sql/` for the November 2026 interview track.

- `questions.js` contains 30 days with two unsolved questions per day. The public site contains no reference SQL answers.
- `setup.sql` creates 15 Snowflake tables and inserts the practice rows. `sample-data.js` displays their schemas and rows beside each relevant question.
- `expected.js` contains expected output data for all 60 questions. The page previews up to eight rows and lets learners expand longer results; checking uses the full output.
- `engine.mjs` loads the vendored DuckDB-Wasm engine in the browser. Run accepts one `SELECT` or `WITH` query, recreates the sample tables, executes the query locally, and compares row values and counts with the expected output. Row order is ignored. DuckDB and Snowflake have dialect differences, so final syntax should also be checked in Snowflake.
- `app.js` stores drafts, checked answers, and submitted answers in browser `localStorage` under `akshay-sql-practice-v1`. Nothing is sent to a server. Export answers as `.sql` or back up and restore state as `.json`; browser storage does not sync across devices.
- The SQL editor colors keywords, functions, strings, numbers, and comments while retaining a normal textarea for typing, selection, and accessibility.

Serve the repository root with `python -m http.server 8000` and visit `/sql/`. The browser engine requires HTTP(S); opening `index.html` directly as a file is unsupported. The first Run loads the roughly 39 MB WebAssembly engine from the same site.
