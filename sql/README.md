# SQL Practice Lab

Static GitHub Pages page at `/sql/` for the November 2026 interview track.

- `questions.js` contains 30 days with two unsolved questions per day. Add prompts there; keep solutions out of the public page.
- `setup.sql` creates 15 small Snowflake tables with sample data. Learners should add edge-case rows when testing.
- `app.js` stores drafts and submitted answers in browser `localStorage` under `akshay-sql-practice-v1`. Submission is private to that browser and does not execute or grade SQL.
- The page can export answers as `.sql` and back up or restore state as `.json`. Backups are important because browser storage does not sync across devices.

Open `index.html` directly or serve the repository root with `python -m http.server 8000` and visit `/sql/`.
