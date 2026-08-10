(() => {
  "use strict";

  /* Every page of these notes lives in the same folder, so search-index URLs
     are plain filenames and need no base prefix. */

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------- code blocks */

  /* Pages carry plain <pre><code>. assets/code-highlight.js colours it and
     works out which AWS and SQL constructs a block uses; here that gets a
     frame with a language badge, Copy, and an Explain panel. */

  const engine = window.AwsCode;

  const NOTE_GROUPS = [
    ["service", "AWS services"],
    ["statement", "Statements"],
    ["clause", "Clauses and options"],
    ["function", "Functions"],
    ["view", "System views"],
    ["command", "CLI commands"],
    ["policy", "IAM policy elements"],
    ["template", "CloudFormation elements"],
    ["library", "Libraries"],
    ["type", "Types"],
    ["keyword", "Keywords"],
  ];
  const NOTE_LIMIT = 24;

  const notesMarkup = (source, lang, summary) => {
    const found = engine ? engine.constructs(source, lang) : [];
    const shown = found.slice(0, NOTE_LIMIT);
    let html = summary ? '<p class="code-what">' + escapeHtml(summary) + "</p>" : "";

    NOTE_GROUPS.forEach(([kind, heading]) => {
      const rows = shown.filter((item) => item.kind === kind);
      if (!rows.length) return;
      html +=
        '<p class="code-group">' + heading + '</p><dl class="code-dl">' +
        rows
          .map((item) =>
            "<div><dt>" + escapeHtml(item.label) + "</dt><dd>" +
            escapeHtml(item.description) + "</dd></div>")
          .join("") +
        "</dl>";
    });

    if (found.length > shown.length) {
      html += '<p class="code-more">' + (found.length - shown.length) +
        " further constructs appear in this block.</p>";
    }
    return html || '<p class="code-what">Nothing AWS-specific to break down here.</p>';
  };

  let codeCount = 0;

  document.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    const source = code.textContent;
    const lang = pre.dataset.lang || (engine ? engine.detect(source) : "text");
    const summary = pre.dataset.explain || "";
    codeCount += 1;

    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    wrap.dataset.lang = lang;
    pre.parentNode.insertBefore(wrap, pre);

    const head = document.createElement("div");
    head.className = "code-head";
    head.innerHTML =
      '<span class="code-lang">' + escapeHtml(engine ? engine.label(lang) : "Code") + "</span>" +
      (pre.dataset.title ? '<span class="code-title">' + escapeHtml(pre.dataset.title) + "</span>" : "");

    const actions = document.createElement("div");
    actions.className = "code-actions";
    head.appendChild(actions);
    wrap.appendChild(head);
    wrap.appendChild(pre);

    if (engine) code.innerHTML = engine.highlight(source, lang);

    const hasNotes = engine ? engine.constructs(source, lang).length > 0 : false;
    if (summary || hasNotes) {
      const panel = document.createElement("div");
      panel.className = "code-notes";
      panel.id = "code-notes-" + codeCount;
      panel.hidden = true;
      wrap.appendChild(panel);

      const explain = document.createElement("button");
      explain.type = "button";
      explain.className = "code-btn";
      explain.textContent = "Explain";
      explain.setAttribute("aria-expanded", "false");
      explain.setAttribute("aria-controls", panel.id);
      explain.addEventListener("click", () => {
        if (!panel.dataset.built) {
          panel.innerHTML = notesMarkup(source, lang, summary);
          panel.dataset.built = "1";
        }
        const open = panel.hidden;
        panel.hidden = !open;
        explain.setAttribute("aria-expanded", String(open));
        explain.textContent = open ? "Hide explanation" : "Explain";
      });
      actions.appendChild(explain);
    }

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-btn";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy this code block");
    copy.setAttribute("aria-live", "polite");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = "Copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copy.textContent = "Selected";
      }
      window.setTimeout(() => (copy.textContent = "Copy"), 1600);
    });
    actions.appendChild(copy);
  });

  /* -------------------------------------------------------- course search */

  const INDEX = Array.isArray(window.AWS_SEARCH_INDEX) ? window.AWS_SEARCH_INDEX : [];

  const KIND_WEIGHT = {
    section: 5, lecture: 4, question: 3, scenario: 3,
    service: 3, fact: 3, topic: 2, extra: 2, diagram: 2, code: 1,
  };

  /* Punctuation and hyphens become spaces so "zero etl" finds "zero-ETL" and
     "read capacity" finds "Read Capacity Units". */
  const normalise = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /* Crude suffix stripping so "partitioning" finds "partition" and "queries"
     finds "query". Both sides go through the same function, so it only has to
     be self-consistent, not linguistically correct. */
  const stem = (word) => {
    let value = word;
    if (value.length > 4 && value.endsWith("ing")) value = value.slice(0, -3);
    else if (value.length > 4 && value.endsWith("ed")) value = value.slice(0, -2);
    else if (value.length > 4 && value.endsWith("ies")) value = value.slice(0, -3);
    else if (value.length > 4 && value.endsWith("es")) value = value.slice(0, -2);
    else if (value.length > 3 && value.endsWith("s")) value = value.slice(0, -1);
    if (value.length > 4 && value.endsWith("y")) value = value.slice(0, -1);
    return value;
  };

  const STOPWORDS = new Set(
    ("a an the is are was were be been being to of in on for and or if it its do does did you your " +
     "i my we our what when how why which who where with that this these those from at by as but not " +
     "can could should would will shall may might have has had there here about into out up down over")
      .split(" ")
  );

  const tokenise = (raw) => normalise(raw).split(" ").filter(Boolean);
  const stems = (raw) => tokenise(raw).map(stem).filter(Boolean);

  const stemsMatch = (a, b) =>
    a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));

  const inWords = (words, token) => words.some((word) => stemsMatch(word, token));

  const highlight = (text, tokens) => {
    if (!tokens.length) return escapeHtml(text);
    const pattern = new RegExp(
      "(" + tokens.slice().sort((a, b) => b.length - a.length).map(escapeRe).join("|") + ")\\w*",
      "gi"
    );
    let out = "";
    let last = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, match.index)) + "<mark>" + escapeHtml(match[0]) + "</mark>";
      last = match.index + match[0].length;
    }
    return out + escapeHtml(text.slice(last));
  };

  const fields = (entry) => {
    if (!entry._n) {
      const t = normalise(entry.t);
      const k = normalise(entry.k || "");
      const s = normalise(entry.s || "");
      entry._n = { t, k, s, wt: stems(t), wk: stems(k), ws: stems(s) };
    }
    return entry._n;
  };

  const hasWord = (haystack, needle) => (" " + haystack).includes(" " + needle);

  const scoreEntry = (entry, query) => {
    const { t, k, s, wt, wk, ws } = fields(entry);
    const { phrase, terms, required } = query;
    let score = 0;

    if (t === phrase) score = 100;
    else if (t.startsWith(phrase + " ")) score = 80;
    else if (hasWord(t, phrase)) score = 60;
    else if (t.includes(phrase)) score = 45;
    else if (hasWord(k, phrase)) score = 28;
    else if (s.includes(phrase)) score = 14;

    /* No contiguous match. Fall back to counting how many of the query's words
       turn up anywhere on the entry, which is what lets a whole question be
       typed into the box and still find its answer. */
    if (!score && terms.length > 1) {
      let matched = 0;
      let titleHits = 0;
      let total = 0;
      for (const term of terms) {
        if (inWords(wt, term)) { total += 18; titleHits += 1; matched += 1; }
        else if (inWords(wk, term)) { total += 7; matched += 1; }
        else if (inWords(ws, term)) { total += 4; matched += 1; }
      }
      if (titleHits && matched >= required) {
        score = Math.min(58, Math.round(total / terms.length) + matched * 3);
      }
    }

    if (!score) return 0;
    return score + (KIND_WEIGHT[entry.d] || 0);
  };

  const parseQuery = (raw) => {
    const phrase = normalise(raw);
    const tokens = phrase.split(" ").filter(Boolean);
    const meaningful = tokens.filter((token) => !STOPWORDS.has(token));
    const terms = (meaningful.length ? meaningful : tokens).map(stem);
    return {
      phrase,
      terms,
      /* Short queries must match in full; longer ones tolerate a stray word. */
      required: terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.6),
    };
  };

  const search = (raw) => {
    const query = parseQuery(raw);
    if (query.phrase.length < 2) return [];
    return INDEX.map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.t.length - b.entry.t.length)
      .slice(0, 16)
      .map((hit) => hit.entry);
  };

  const buildSearchUI = () => {
    const host = document.querySelector(".hero-inner");
    if (!host || !INDEX.length || host.querySelector("[data-site-search]")) return null;

    const wrap = document.createElement("div");
    wrap.className = "site-search";
    wrap.setAttribute("data-site-search", "");
    wrap.innerHTML =
      '<label class="visually-hidden" for="course-search">Search the course notes</label>' +
      '<input id="course-search" class="search" type="search" autocomplete="off" spellcheck="false" ' +
      'role="combobox" aria-expanded="false" aria-controls="course-search-results" ' +
      'placeholder="Search services, topics, diagrams and questions \u2014 press /" data-search-input>' +
      '<span class="site-search-hint" aria-hidden="true">/</span>' +
      '<div class="search-results" id="course-search-results" role="listbox" data-search-results hidden></div>';
    host.appendChild(wrap);
    return wrap;
  };

  const searchWrap = buildSearchUI();

  if (searchWrap) {
    const input = searchWrap.querySelector("[data-search-input]");
    const panel = searchWrap.querySelector("[data-search-results]");
    const hint = searchWrap.querySelector(".site-search-hint");
    let cursor = -1;

    const close = () => {
      panel.hidden = true;
      panel.innerHTML = "";
      cursor = -1;
      input.setAttribute("aria-expanded", "false");
    };

    const moveCursor = (delta) => {
      const items = [...panel.querySelectorAll(".search-result")];
      if (!items.length) return;
      cursor = (cursor + delta + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle("is-active", i === cursor));
      items[cursor].scrollIntoView({ block: "nearest" });
    };

    const render = () => {
      const query = input.value.trim();
      if (query.length < 2) return close();

      const hits = search(query);
      cursor = -1;
      input.setAttribute("aria-expanded", "true");
      panel.hidden = false;

      if (!hits.length) {
        panel.innerHTML = '<p class="sr-status">No match for &ldquo;' + escapeHtml(query) + "&rdquo;.</p>";
        return;
      }

      const tokens = stems(query);
      panel.innerHTML =
        '<p class="sr-status">' + hits.length + " result" + (hits.length === 1 ? "" : "s") + "</p>" +
        hits
          .map(
            (entry) =>
              '<a class="search-result" role="option" href="' + entry.u + '">' +
              '<span class="sr-title">' + highlight(entry.t, tokens) + "</span>" +
              '<span class="sr-meta"><span class="sr-kind" data-kind="' + entry.d + '">' +
              entry.d + "</span>" + escapeHtml(entry.s || "") + "</span></a>"
          )
          .join("");
    };

    let timer = 0;
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 110);
    });
    input.addEventListener("focus", () => { if (input.value.trim().length > 1) render(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); moveCursor(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveCursor(-1); }
      else if (event.key === "Escape") { close(); input.blur(); }
      else if (event.key === "Enter") {
        const active = panel.querySelector(".search-result.is-active");
        if (active) { event.preventDefault(); active.click(); }
      }
    });

    document.addEventListener("click", (event) => {
      if (!searchWrap.contains(event.target)) close();
    });

    document.addEventListener("keydown", (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const shortcut = event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k");
      if (shortcut && !typing) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });

    input.addEventListener("focus", () => hint && (hint.style.opacity = "0"));
    input.addEventListener("blur", () => hint && (hint.style.opacity = ""));
  }

  /* --------------------------------------------- index cards + filtering */

  const cardSearch = document.querySelector("[data-part-search]");
  const cards = [...document.querySelectorAll("[data-part-card]")];
  const filters = [...document.querySelectorAll("[data-filter]")];
  const filterStatus = document.querySelector("[data-filter-status]");
  let activeFilter = "all";

  const applyFilters = () => {
    if (!cards.length) return;
    const query = (cardSearch?.value || "").trim().toLowerCase();
    cards.forEach((card) => {
      const tags = (card.dataset.tags || "").toLowerCase();
      const text = card.textContent.toLowerCase();
      const matchesText = !query || text.includes(query) || tags.includes(query);
      const matchesTag = activeFilter === "all" || tags.includes(activeFilter);
      card.classList.toggle("hidden", !(matchesText && matchesTag));
    });
    if (filterStatus) {
      const visible = cards.filter((card) => !card.classList.contains("hidden")).length;
      filterStatus.textContent = visible
        ? `${visible} result${visible === 1 ? "" : "s"} shown`
        : "No matching results. Clear the search or choose another filter.";
    }
  };

  cardSearch?.addEventListener("input", applyFilters);
  filters.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      filters.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      applyFilters();
    });
  });
  applyFilters();

  /* ------------------------------------------- curriculum expand/collapse */

  document.querySelectorAll("[data-cur-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = button.dataset.curToggle === "open";
      document.querySelectorAll(".cur-section").forEach((item) => (item.open = open));
    });
  });

  /* ---------------------------------------------------- interview answers */

  document.querySelectorAll("[data-qa-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = button.dataset.qaToggle === "open";
      const scope = button.closest("section") || document;
      scope.querySelectorAll("details.qa").forEach((item) => (item.open = open));
    });
  });

  /* ------------------------------------------------------------ motion */

  /* Sections fade up as they enter the viewport. The class is only added when
     motion is welcome, so nothing is ever left invisible if the observer or
     the animation does not run. */
  if (!reducedMotion && "IntersectionObserver" in window) {
    const targets = [...document.querySelectorAll(".section, .part-card")];
    if (targets.length) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.04 }
      );
      targets.forEach((target, i) => {
        target.classList.add("reveal");
        /* A short stagger reads as one motion rather than a dozen. */
        target.style.transitionDelay = `${Math.min(i, 6) * 45}ms`;
        observer.observe(target);
      });
    }
  }

  /* Exam-domain bars grow from zero once they are on screen. */
  const bars = [...document.querySelectorAll(".domain-bar > span, .progress > span[data-width]")];
  if (bars.length) {
    const paintBar = (bar) => {
      bar.style.width = (bar.dataset.width || "0") + "%";
    };
    if (!reducedMotion && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            paintBar(entry.target);
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.3 }
      );
      bars.forEach((bar) => observer.observe(bar));
    } else {
      bars.forEach(paintBar);
    }
  }

  /* Highlight the table-of-contents entry for whichever section is in view. */
  const tocLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  if (tocLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(tocLinks.map((link) => [link.getAttribute("href").slice(1), link]));
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        /* With several sections on screen, the topmost one is the one the
           reader is working through. */
        const current = [...byId.keys()].find((id) => visible.has(id));
        byId.forEach((link, id) => link.classList.toggle("is-current", id === current));
      },
      { rootMargin: "-12% 0px -70% 0px" }
    );
    byId.forEach((_, id) => {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    });
  }

  /* ------------------------------------------------- completion tracking */

  const storageKey = (name) => `aws-dea-notes:${name}`;

  /* Opened straight off disk, or with storage blocked, localStorage throws.
     Ticks are then not remembered between visits, which must not take the
     rest of the page down with it. */
  const readFlag = (key) => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  const writeFlag = (key, value) => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* nothing to persist to */
    }
  };

  document.querySelectorAll("[data-complete]").forEach((button) => {
    const key = storageKey(button.dataset.complete);
    let done = readFlag(key);
    const sync = () => {
      button.textContent = done ? "Completed \u2713" : "Mark complete";
      button.setAttribute("aria-pressed", String(done));
    };
    button.addEventListener("click", () => {
      done = !done;
      writeFlag(key, done);
      sync();
      window.dispatchEvent(new Event("aws-progress"));
    });
    sync();
  });

  const progressBar = document.querySelector("[data-progress-bar]");
  const progressText = document.querySelector("[data-progress-text]");

  if (progressBar || progressText) {
    const total = 21;
    const paint = () => {
      let done = 0;
      for (let i = 1; i <= total; i += 1) {
        const id = String(i).padStart(2, "0");
        if (readFlag(storageKey(`section-${id}`))) done += 1;
      }
      const pct = Math.round((done / total) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressText) {
        progressText.textContent = `${done} of ${total} sections marked complete (${pct}%)`;
      }
    };
    paint();
    window.addEventListener("aws-progress", paint);
    window.addEventListener("storage", paint);
  }
})();
