/* Syntax highlighting and explanation for the code blocks in the notes.

   The pages ship plain <pre><code> text. This file turns that text into spans
   the stylesheet can colour, and — using assets/sql-glossary.js — works out
   which Snowflake constructs a block uses so the Explain panel can describe
   them. Everything is offline and dependency-free.

   window.SnowflakeCode
     detect(text)              guess the language of a block
     label(lang)               human name for the language badge
     highlight(text, lang)     HTML with <span class="t-*"> tokens
     constructs(text, lang)    [{label, kind, description}] in reading order
*/

(() => {
  "use strict";

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
  const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* ------------------------------------------------------------- vocabulary */

  /* Words that open or shape a statement. Deliberately excludes words the
     course files also use as column names (name, value, data, status, region),
     because a column called "state" should not be painted like a keyword. */
  const SQL_KEYWORDS = new Set(`
    ABORT_DETACHED_QUERY ACCESS ACCOUNT ACCOUNTS ADD AFTER AGGREGATION ALERT ALL
    ALLOW ALTER AND API AS ASC AT AUTHENTICATION AUTOINCREMENT BEFORE BEGIN
    BERNOULLI BETWEEN BLOCK BREAK BUDGET BY CALL CALLER CASCADE CASE CATALOG
    CHANGES CHANGE_TRACKING CLONE CLOSE CLUSTER COLUMN COMMENT COMMIT
    CONSTRAINT CONTINUE COPY CORTEX CREATE CROSS CURSOR DATABASE DATABASES
    DECLARE DEFAULT DELETE DENY DESC DESCRIBE DIRECTORY DISABLE DISTINCT DO
    DROP DYNAMIC ELSE ELSEIF ENABLE END ENFORCED EQUALITY EVENT EXCEPT
    EXCEPTION EXECUTE EXISTS EXTERNAL FAILOVER FALSE FETCH FILE FIRST FOLLOWING
    FOR FOREIGN FORMAT FORMATS FROM FULL FUNCTION FUNCTIONS FUTURE GEO GET GIT
    GRANT GRANTS GROUP GROUPS HANDLER HAVING HYBRID ICEBERG IDENTITY IF ILIKE
    IMMEDIATE IMPORT IMPORTS IN INCREMENT INNER INSERT INTEGRATION
    INTEGRATIONS INTERSECT INTO IS JOIN KEY KEYS LANGUAGE LATERAL LEFT LET LIKE
    LIMIT LIST LOOP LS MANAGED MASKING MATCHED MATERIALIZED MERGE MINUS MODIFY
    MONITOR MONITORS NATURAL NETWORK NEXT NOORDER NORELY NOT NOTIFICATION
    NOTIFY NULLS OF OFFSET ON ONLY OPEN OPTIMIZATION OR ORDER OUTER OVER
    OVERWRITE OWNER OWNERSHIP PACKAGES PARAMETERS PARTITION PASSWORD PERCENT PERMANENT
    PIPE PIPES PIVOT POLICIES POLICY PRECEDING PRIMARY PROCEDURE PROCEDURES
    PROJECTION PURGE PUT QUALIFY RAISE RANGE READER RECLUSTER RECURSIVE REFRESH
    RELY REMOVE RENAME REPEATABLE REPLACE REPLICA REPLICATION REPOSITORY
    RESOURCE RESULTSET RESUME RETURN RETURNS REVOKE RIGHT RM ROLE ROLES
    ROLLBACK ROW ROWS SAMPLE SCHEMA SCHEMAS SEARCH SECONDARY SECRET SECURE
    SELECT SEMANTIC SEQUENCE SEQUENCES SERVICE SESSION SET SHARE SHARES SHOW
    SNOWPARK STAGE STAGES START STATEMENT STORAGE STREAM STREAMS SUBSTRING
    SUSPEND SWAP SYSTEM TABLE TABLES TABLESAMPLE TAG TAGS TASK TASKS TEMP
    TEMPORARY THEN TO TOP TRANSACTION TRANSIENT TRIGGERS TRUE TRUNCATE TYPE
    UNBOUNDED UNDROP UNION UNIQUE UNPIVOT UNSET UPDATE URL USAGE USE USER
    USERS USING VALUES VIEW VIEWS VOLATILE VOLUME WAREHOUSE WAREHOUSES WHEN
    WHERE WHILE WITH WITHIN WORK
  `.trim().split(/\s+/));

  const SQL_TYPES = new Set(`
    ARRAY BIGINT BINARY BOOLEAN BYTEINT CHAR CHARACTER DATE DATETIME DECIMAL
    DOUBLE FLOAT FLOAT4 FLOAT8 GEOGRAPHY GEOMETRY INT INTEGER NUMBER NUMERIC
    OBJECT REAL SMALLINT STRING TEXT TIMESTAMP TIMESTAMP_LTZ TIMESTAMP_NTZ
    TIMESTAMP_TZ TINYINT VARBINARY VARCHAR VARIANT VECTOR
  `.trim().split(/\s+/));

  const SQL_LITERALS = new Set(["TRUE", "FALSE", "NULL", "UNKNOWN"]);

  /* Warehouse sizes, scaling policies and other bare-word option values that
     read as settings rather than identifiers. */
  const SQL_VALUES = new Set(`
    ABORT_STATEMENT AUTO BASE64 BROTLI BZ2 CASE_INSENSITIVE CASE_SENSITIVE
    CONTINUE CSV DAILY DEFLATE ECONOMY ENTERPRISE GZIP HEX IMMEDIATELY JAVA
    JAVASCRIPT JSON LARGE LZO MEDIUM MONTHLY NEVER NONE NTZ ORC PARQUET PYTHON RAW_DEFLATE
    SCALA SKIP_FILE SMALL SNAPPY STANDARD UTF8 WEEKLY X4LARGE X5LARGE X6LARGE
    XLARGE XML XSMALL XXLARGE XXXLARGE YEARLY ZSTD
  `.trim().split(/\s+/));

  const PY_KEYWORDS = new Set(`
    and as assert async await break class continue def del elif else except
    finally for from global if import in is lambda nonlocal not or pass raise
    return try while with yield
  `.trim().split(/\s+/));

  const PY_CONSTANTS = new Set(["True", "False", "None", "self", "cls"]);

  const JS_KEYWORDS = new Set(`
    async await break case catch class const continue default delete do else
    export extends finally for function if import in instanceof let new of
    return static super switch this throw try typeof var void while yield
    public private protected float int double string boolean
  `.trim().split(/\s+/));

  const JS_CONSTANTS = new Set(["true", "false", "null", "undefined", "NaN"]);

  /* Command names that start a line in the shell transcripts. Words that are
     also SQL statements (set, copy, list) are deliberately absent. */
  const SHELL_COMMANDS = new Set(`
    snow snowsql aws az gcloud gsutil openssl python python3 pip pip3 git curl
    export echo cd ls dir mkdir
  `.trim().split(/\s+/));

  /* The subset safe enough to identify a whole block as a shell transcript. */
  const SHELL_HINTS = /^[ \t]*(?:snow|snowsql|aws|az|gcloud|gsutil|openssl|python3?|pip3?|git|curl)\s/m;

  /* ------------------------------------------------------- language guessing */

  const LABELS = {
    sql: "Snowflake SQL",
    python: "Python (Snowpark)",
    javascript: "JavaScript",
    json: "JSON",
    shell: "CLI / SnowSQL",
    text: "Output"
  };

  const SQL_MARKER = /\b(?:SELECT|CREATE|ALTER|DROP|USE|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|CALL|SHOW|DESCRIBE|DESC|EXECUTE|UNDROP|LIST|REMOVE|PUT|BEGIN|EXPLAIN|SET)\b/i;

  const detect = (text) => {
    const trimmed = text.trim();
    const lines = trimmed.split("\n");
    const first = lines.find((line) => line.trim()) || "";

    if (/^[[{]/.test(trimmed) && /"\s*:/.test(trimmed)) return "json";
    if (/^\s*(?:C:\\?>|PS [^>]*>|\$\s|>\s|#!)/.test(first)) return "shell";
    if (SHELL_HINTS.test(trimmed)) return "shell";
    if (/^\s*#/.test(first) && !SQL_MARKER.test(trimmed)) return "shell";
    if (/^\s*(?:import\s|from\s+\S+\s+import\s|def\s|class\s|@\w+\s*$)/m.test(trimmed) &&
        !SQL_MARKER.test(trimmed)) return "python";
    if (!SQL_MARKER.test(trimmed)) return "text";
    return "sql";
  };

  const label = (lang) => LABELS[lang] || LABELS.sql;

  /* ---------------------------------------------------------------- glossary */

  /* A single-token glossary label also colours that token, which is how option
     names such as SCHEDULE or AUTO_SUSPEND stop looking like identifiers. */
  const DOC_CLASS = {
    clause: "t-opt",
    param: "t-opt",
    view: "t-opt",
    role: "t-role",
    function: "t-fn"
  };

  let wordDocs = null;   // single-token label -> {kind, description}
  let patterns = null;   // every entry with a compiled matcher

  const glossary = () => {
    if (patterns) return patterns;
    const entries = Array.isArray(window.SNOWFLAKE_SQL_GLOSSARY)
      ? window.SNOWFLAKE_SQL_GLOSSARY
      : [];
    wordDocs = new Map();
    patterns = [];

    entries.forEach(([term, kind, description, source]) => {
      if (!term || !description) return;
      if (!/\s/.test(term) && /^[A-Za-z_$]/.test(term)) {
        wordDocs.set(term.toUpperCase(), { kind, description });
      }
      let body = source;
      if (!body) {
        body = term.trim().split(/\s+/).map(escapeRe).join("\\s+");
        if (/^[\w$]/.test(term)) body = "(?<![\\w$])" + body;
        if (/[\w$]$/.test(term)) body += "(?![\\w$])";
      }
      try {
        patterns.push({ term, kind, description, re: new RegExp(body, "gi") });
      } catch {
        /* A bad pattern must not take the page down with it. */
      }
    });
    return patterns;
  };

  const docFor = (word) => {
    glossary();
    return wordDocs.get(word.toUpperCase()) || null;
  };

  /* ------------------------------------------------------------- token spans */

  const span = (cls, text, title) => {
    const doc = title ? ' title="' + escapeHtml(title) + '"' : "";
    return '<span class="' + cls + (title ? " t-doc" : "") + '"' + doc + ">" +
      escapeHtml(text) + "</span>";
  };

  /* Runs an ordered rule list over the text. Each rule is [sticky regex, fn];
     the first rule that matches at the cursor wins, and anything no rule
     recognises is emitted as one escaped character. Handlers are given the
     cursor and the string being scanned, since a rule may only be looking at a
     stretch of a larger block and must not index into the wrong one. */
  const run = (text, rules) => {
    let out = "";
    let index = 0;
    while (index < text.length) {
      let matched = false;
      for (const [re, handle] of rules) {
        re.lastIndex = index;
        const match = re.exec(text);
        if (!match) continue;
        out += handle(match, index, text);
        index = re.lastIndex > index ? re.lastIndex : index + 1;
        matched = true;
        break;
      }
      if (!matched) {
        out += escapeHtml(text[index]);
        index += 1;
      }
    }
    return out;
  };

  /* ------------------------------------------------------------- SQL lexer */

  const highlightSql = (text, depth) => {
    /* The character before the cursor and the one after a word decide whether a
       word is a qualified name part (customers.value) or a call (FLATTEN(...)). */
    let previous = "";
    const note = (value) => {
      const trimmed = value.replace(/\s+$/, "");
      if (trimmed) previous = trimmed[trimmed.length - 1];
    };

    /* Emits one token and remembers its last character for the next decision. */
    const paint = (cls) => (match) => {
      note(match[0]);
      return span(cls, match[0]);
    };

    const dollarBody = (start) => {
      /* $$ ... $$ holds a UDF or procedure body. LANGUAGE earlier in the
         statement says what is inside; plain SQL is the default. */
      const close = text.indexOf("$$", start + 2);
      const end = close === -1 ? text.length : close;
      const body = text.slice(start + 2, end);
      const before = text.slice(0, start).toUpperCase();
      const declared = /LANGUAGE\s+([A-Z]+)[^$]*$/.exec(before);
      const inner = declared ? declared[1] : "SQL";
      let painted;
      if (depth > 0) painted = escapeHtml(body);
      else if (inner === "PYTHON") painted = highlightPython(body);
      else if (inner === "JAVASCRIPT" || inner === "JAVA" || inner === "SCALA") {
        painted = highlightJs(body);
      } else painted = highlightSql(body, depth + 1);
      return {
        html: span("t-quote", "$$") + painted +
          (close === -1 ? "" : span("t-quote", "$$")),
        end: close === -1 ? text.length : close + 2
      };
    };

    const word = (match, at, source) => {
      const value = match[0];
      const upper = value.toUpperCase();
      const after = /^\s*\(/.test(source.slice(at + value.length));
      /* A name after a dot belongs to its parent object, so db.schema.value
         must stay plain however much the last part looks like a keyword. The
         one exception is a $ name — s.METADATA$ACTION is still a pseudo-column. */
      const meta = value.includes("$");
      const qualified = previous === "." && !meta;
      let cls = "t-idn";

      if (meta) cls = "t-meta";
      else if (qualified) cls = "t-idn";
      else if (SQL_LITERALS.has(upper)) cls = "t-lit";
      else if (SQL_TYPES.has(upper)) cls = "t-typ";
      else if (SQL_KEYWORDS.has(upper)) cls = "t-kw";
      else if (after) cls = "t-fn";
      else if (SQL_VALUES.has(upper)) cls = "t-val";

      note(value);
      const doc = qualified ? null : docFor(value);
      if (doc && cls === "t-idn") cls = DOC_CLASS[doc.kind] || cls;
      return span(cls, value, doc ? doc.description : "");
    };

    const rules = [
      [/\s+/y, (m) => escapeHtml(m[0])],
      [/(?:--|\/\/)[^\n]*/y, (m) => span("t-cmt", m[0])],
      [/\/\*[\s\S]*?(?:\*\/|$)/y, (m) => span("t-cmt", m[0])],
      /* Not Snowflake syntax, but the course files use a leading # for the
         shell and cron notes that sit alongside SQL in the same block. */
      [/(?:^|(?<=\n))[ \t]*#[^\n]*/y, (m) => span("t-cmt", m[0])],
      [/'(?:''|[^'])*'/y, paint("t-str")],
      [/"[^"\n]*"/y, paint("t-qid")],
      [/<[A-Za-z_][\w. -]*>/y, paint("t-ph")],
      [/@[~%]?[\w$./~%-]*/y, paint("t-stg")],
      [/\$\d+/y, paint("t-var")],
      [/(?:\d+\.\d+|\.\d+|\d+)(?:[eE][+-]?\d+)?/y, paint("t-num")],
      [/[A-Za-z_][\w$]*/y, word],
      [/::|=>|\|\||<=|>=|<>|!=|->|[-+*/%=<>!]/y, paint("t-op")],
      [/[.,;:()[\]{}|]/y, paint("t-pun")]
    ];

    /* $$ is handled outside the rule table because it swallows a nested
       language, so the text is walked in stretches between dollar quotes. */
    let out = "";
    let index = 0;
    while (index < text.length) {
      if (text.startsWith("$$", index)) {
        const block = dollarBody(index);
        out += block.html;
        index = block.end;
        previous = "$";
        continue;
      }
      const nextDollar = text.indexOf("$$", index);
      const slice = nextDollar === -1 ? text.slice(index) : text.slice(index, nextDollar);
      out += run(slice, rules);
      index += slice.length;
    }
    return out;
  };

  /* ---------------------------------------------------------- Python lexer */

  const highlightPython = (text) => {
    const rules = [
      [/\s+/y, (m) => escapeHtml(m[0])],
      [/#[^\n]*/y, (m) => span("t-cmt", m[0])],
      [/[rbfu]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?''')/y, (m) => span("t-str", m[0])],
      [/[rbfu]{0,2}(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y, (m) => span("t-str", m[0])],
      [/@[A-Za-z_][\w.]*/y, (m) => span("t-meta", m[0])],
      [/\b\d[\w.]*/y, (m) => span("t-num", m[0])],
      [/[A-Za-z_]\w*/y, (m, at, source) => {
        const value = m[0];
        if (PY_KEYWORDS.has(value)) return span("t-kw", value);
        if (PY_CONSTANTS.has(value)) return span("t-lit", value);
        if (/^\s*\(/.test(source.slice(at + value.length))) return span("t-fn", value);
        return span("t-idn", value);
      }],
      [/==|!=|<=|>=|->|\*\*|[-+*/%=<>&|^~]/y, (m) => span("t-op", m[0])],
      [/[.,;:()[\]{}]/y, (m) => span("t-pun", m[0])]
    ];
    return run(text, rules);
  };

  /* ------------------------------------------------------ JavaScript / Java */

  const highlightJs = (text) => {
    const rules = [
      [/\s+/y, (m) => escapeHtml(m[0])],
      [/\/\/[^\n]*/y, (m) => span("t-cmt", m[0])],
      [/\/\*[\s\S]*?(?:\*\/|$)/y, (m) => span("t-cmt", m[0])],
      [/(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/y, (m) => span("t-str", m[0])],
      [/\b\d[\w.]*/y, (m) => span("t-num", m[0])],
      [/[A-Za-z_$][\w$]*/y, (m, at, source) => {
        const value = m[0];
        if (JS_KEYWORDS.has(value)) return span("t-kw", value);
        if (JS_CONSTANTS.has(value)) return span("t-lit", value);
        if (/^\s*\(/.test(source.slice(at + value.length))) return span("t-fn", value);
        return span("t-idn", value);
      }],
      [/===|!==|==|!=|<=|>=|=>|\+\+|--|[-+*/%=<>&|^~!?]/y, (m) => span("t-op", m[0])],
      [/[.,;:()[\]{}]/y, (m) => span("t-pun", m[0])]
    ];
    return run(text, rules);
  };

  /* ---------------------------------------------------------------- JSON */

  const highlightJson = (text) => {
    const rules = [
      [/\s+/y, (m) => escapeHtml(m[0])],
      [/"(?:\\.|[^"\\])*"(?=\s*:)/y, (m) => span("t-key", m[0])],
      [/"(?:\\.|[^"\\])*"/y, (m) => span("t-str", m[0])],
      [/\b(?:true|false|null)\b/y, (m) => span("t-lit", m[0])],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, (m) => span("t-num", m[0])],
      [/[{}[\],:]/y, (m) => span("t-pun", m[0])]
    ];
    return run(text, rules);
  };

  /* ------------------------------------------------------- shell transcripts */

  const SHELL_PROMPT = /^(\s*)(C:\\?>|PS [^>]*>|\$|>)(\s*)/;

  /* Splits a transcript into comment, command and output lines. The highlighter
     and the construct scan share this view so that prose a CLI printed is never
     mistaken for SQL. A command continues onto the next line after a "\". */
  const shellLines = (text) => {
    let running = false;
    return text.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed) { running = false; return { kind: "blank", line }; }
      if (trimmed.startsWith("#")) { running = false; return { kind: "comment", line }; }

      const prompt = SHELL_PROMPT.exec(line);
      if (prompt) {
        running = /\\$/.test(trimmed);
        return { kind: "command", line, prompt };
      }
      const first = /^\s*([A-Za-z_][\w.-]*)/.exec(line);
      if (running || (first && SHELL_COMMANDS.has(first[1]))) {
        running = /\\$/.test(trimmed);
        return { kind: "command", line };
      }
      return { kind: "output", line };
    });
  };

  const highlightShell = (text) => {
    const command = (line) => {
      const rules = [
        [/\s+/y, (m) => escapeHtml(m[0])],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, (m) => span("t-str", m[0])],
        [/(?:^|(?<=\s))--?[A-Za-z][\w-]*/y, (m) => span("t-flag", m[0])],
        [/\\$/y, (m) => span("t-op", m[0])],
        [/[A-Za-z_][\w.-]*/y, (m, at) => {
          const value = m[0];
          if (at === 0 && SHELL_COMMANDS.has(value)) return span("t-cmd", value);
          return span("t-idn", value);
        }],
        [/[=|><&;]/y, (m) => span("t-op", m[0])]
      ];
      return run(line, rules);
    };

    return shellLines(text).map((entry) => {
      if (entry.kind === "blank") return escapeHtml(entry.line);
      if (entry.kind === "comment") return span("t-cmt", entry.line);
      if (entry.kind === "output") return span("t-out", entry.line);
      if (entry.prompt) {
        const [whole, indent, marker, gap] = entry.prompt;
        return escapeHtml(indent) + span("t-prompt", marker) + escapeHtml(gap) +
          command(entry.line.slice(whole.length));
      }
      const indent = /^\s*/.exec(entry.line)[0];
      return escapeHtml(indent) + command(entry.line.slice(indent.length));
    }).join("\n");
  };

  /* ----------------------------------------------------------------- public */

  /* Plain output gets no lexer, but <angle_brackets> are always a slot the
     reader is meant to fill in, so those stay marked. */
  const highlightText = (text) =>
    run(text, [
      [/<[A-Za-z_][\w. -]*>/y, (m) => span("t-ph", m[0])],
      [/[^<]+|</y, (m) => escapeHtml(m[0])]
    ]);

  const highlight = (text, lang) => {
    switch (lang) {
      case "python": return highlightPython(text);
      case "javascript": return highlightJs(text);
      case "json": return highlightJson(text);
      case "shell": return highlightShell(text);
      case "text": return highlightText(text);
      default: return highlightSql(text, 0);
    }
  };

  /* Comments, string bodies and CLI output are blanked out — keeping the length
     so offsets stay honest — so prose cannot be read as a construct. */
  const mask = (text, lang) => {
    const blank = (match) => " ".repeat(match.length);
    const source = lang === "shell"
      ? shellLines(text)
        .map((entry) => (entry.kind === "command" ? entry.line : " ".repeat(entry.line.length)))
        .join("\n")
      : text;
    return source
      .replace(/(?:^|\n)[ \t]*#[^\n]*/g, blank)
      .replace(/--[^\n]*/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/'(?:''|[^'])*'/g, blank);
  };

  const constructs = (text, lang) => {
    if (lang !== "sql" && lang !== "shell") return [];
    const source = mask(text, lang);
    const hits = [];

    glossary().forEach((entry) => {
      entry.re.lastIndex = 0;
      let match;
      while ((match = entry.re.exec(source)) !== null) {
        if (match[0].length === 0) { entry.re.lastIndex += 1; continue; }
        hits.push({ entry, start: match.index, end: match.index + match[0].length });
        break; // one mention per construct is enough for a summary
      }
    });

    /* Longest match wins, so CREATE OR REPLACE DYNAMIC TABLE is never also
       reported as CREATE TABLE. Overlaps only suppress an entry of the same
       kind, which keeps the CREATE OR REPLACE caveat next to the statement. */
    hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    hits.forEach((hit) => {
      const shadowed = kept.some((other) =>
        other.entry.kind === hit.entry.kind &&
        hit.start >= other.start && hit.end <= other.end);
      if (!shadowed) kept.push(hit);
    });

    kept.sort((a, b) => a.start - b.start);
    return kept.map((hit) => ({
      label: hit.entry.term,
      kind: hit.entry.kind,
      description: hit.entry.description
    }));
  };

  window.SnowflakeCode = { detect, label, highlight, constructs };
})();
