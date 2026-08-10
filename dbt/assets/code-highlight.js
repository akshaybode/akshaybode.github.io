/* Offline syntax highlighting and construct lookup for the dbt notes.

   dbt code is rarely one language at a time: a model is Jinja wrapped around
   SQL, a project is YAML, a Python model is pandas or Snowpark, and every
   lesson runs something on the command line. The SQL tokeniser therefore
   splits Jinja regions out first and tokenises them with their own rules, so
   {{ ref('src_listings') }} reads as a function call rather than punctuation.

   Exposes window.DbtCode = { detect, label, highlight, constructs }. */

(() => {
  "use strict";

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  /* ------------------------------------------------------------ glossary */

  /* kind groups the Explain panel; description is what the reader came for.
     Keys are matched lower-case with runs of whitespace collapsed. */
  const GLOSSARY = {
    /* ---- dbt resource types ---- */
    "model": ["resource", "A SELECT statement in a .sql file under models/. dbt wraps it in the DDL for its materialisation and builds it in dependency order."],
    "source": ["resource", "A pointer to a table someone else loaded into the warehouse. Declared in YAML, referenced with source(), and the only sanctioned way to read raw data."],
    "seed": ["resource", "A small CSV in seeds/ that dbt loads into the warehouse with dbt seed. For lookup data that belongs in version control, not for real ingestion."],
    "snapshot": ["resource", "Captures how a mutable source row looked over time, building a Type 2 slowly changing dimension with dbt_valid_from and dbt_valid_to columns."],
    "exposure": ["resource", "Declares a downstream consumer such as a dashboard so it appears in the lineage graph and can be selected with +exposure:name."],
    "analysis": ["resource", "SQL in analyses/ that dbt compiles but never runs against the warehouse. Version-controlled ad-hoc queries."],
    "macro": ["resource", "A reusable Jinja function in macros/. dbt's own materialisations are macros, and so are generic tests."],
    "generic test": ["resource", "A parameterised test defined once and applied to many columns from YAML, such as unique or not_null."],
    "singular test": ["resource", "A one-off test that is just a SELECT in tests/. If it returns rows, the test fails."],
    "unit test": ["resource", "Tests model logic against fixed input rows you supply, rather than against warehouse data. Runs at build time on mocked inputs."],

    /* ---- Jinja functions dbt provides ---- */
    "ref": ["jinja", "Builds a reference to another model. This is what creates the DAG - dbt reads ref() calls to work out build order, and resolves it to the right schema per target."],
    "source": ["jinja", "Resolves a source declared in YAML to its real database.schema.table. Using source() instead of a hard-coded name puts raw tables in the lineage graph."],
    "config": ["jinja", "Sets configuration from inside the model file. Beats dbt_project.yml, which is why a config() block wins any conflict."],
    "var": ["jinja", "Reads a project variable, optionally with a default: var('start_date', False). Set them in dbt_project.yml or with --vars on the CLI."],
    "env_var": ["jinja", "Reads an environment variable. The standard way to keep credentials out of profiles.yml."],
    "this": ["jinja", "The relation currently being built. Mostly used inside is_incremental() blocks to read the existing table."],
    "target": ["jinja", "The connection profile in use: target.name, target.schema, target.database. Lets one project behave differently in dev and prod."],
    "is_incremental": ["jinja", "True only when the model is incremental, the table already exists, and --full-refresh was not passed. Guards the filter that limits new rows."],
    "log": ["jinja", "Writes to the dbt log. Pass info=True to also print to the console."],
    "run_query": ["jinja", "Runs SQL during compilation and returns an Agate table. Needs an {% if execute %} guard because it runs at parse time too."],
    "adapter": ["jinja", "The warehouse-specific API. adapter.get_columns_in_relation() is the usual entry point for writing macros that adapt to a table's real columns."],
    "execute": ["jinja", "False during dbt's parse pass and True during the run. Wrap anything that queries the warehouse in {% if execute %}."],
    "exceptions": ["jinja", "Lets a macro fail deliberately: exceptions.raise_compiler_error() stops the run with your message."],
    "doc": ["jinja", "Pulls in a docs block defined with {% docs %} so a long description can live in a .md file instead of inline YAML."],
    "statement": ["jinja", "Runs SQL and stores the result under a name for load_result() to read. The lower-level cousin of run_query."],
    "dbt_utils.generate_surrogate_key": ["jinja", "Hashes a list of columns into one deterministic key. The standard way to build a primary key for a fact table that has no natural one."],
    "generate_schema_name": ["jinja", "The macro dbt calls to decide a model's schema. Override it to stop dev builds writing to concatenated schema names."],
    "generate_alias_name": ["jinja", "The macro dbt calls to decide a model's table name. Override to change naming conventions project-wide."],

    /* ---- Jinja language ---- */
    "endif": ["jinja", "Closes an {% if %} block. Jinja has no significant whitespace, so every block needs an explicit end tag."],
    "endfor": ["jinja", "Closes a {% for %} loop."],
    "endmacro": ["jinja", "Closes a {% macro %} definition."],
    "endtest": ["jinja", "Closes a {% test %} definition - that is, a custom generic test."],
    "endsnapshot": ["jinja", "Closes a {% snapshot %} block in the older .sql snapshot format."],
    "enddocs": ["jinja", "Closes a {% docs %} block."],
    "set": ["jinja", "Assigns a Jinja variable: {% set x = 5 %}. Lives only for that compilation."],

    /* ---- materialisations ---- */
    "view": ["materialisation", "Rebuilt as a view on every run. No storage, always fresh, but the work happens at query time. dbt's default."],
    "table": ["materialisation", "Dropped and recreated as a table on every run. Fast to query, costs a full rebuild each time."],
    "incremental": ["materialisation", "Builds the table once, then inserts or merges only new rows on later runs. The answer when a full rebuild gets too slow or too expensive."],
    "ephemeral": ["materialisation", "Never built in the warehouse. dbt inlines the SQL into every downstream model as a CTE, so nothing is queryable directly."],
    "materialized_view": ["materialisation", "Hands refresh over to the warehouse's own materialised view feature. dbt manages the definition, the warehouse keeps it current."],
    "microbatch": ["materialisation", "An incremental strategy that splits a backfill into independent time batches using event_time, so one failed batch does not sink the run."],
    "merge": ["materialisation", "Incremental strategy that updates matching rows and inserts new ones, using unique_key. Needs a warehouse that supports MERGE."],
    "append": ["materialisation", "Incremental strategy that only ever inserts. Fastest, but duplicates if the same rows arrive twice."],
    "delete+insert": ["materialisation", "Incremental strategy that deletes matching keys then inserts. Used where MERGE is unavailable or slower."],
    "insert_overwrite": ["materialisation", "Incremental strategy that replaces whole partitions. Common on BigQuery and Spark."],

    /* ---- config keys ---- */
    "materialized": ["config", "Which materialisation to use: view, table, incremental, ephemeral or materialized_view."],
    "incremental_strategy": ["config", "How an incremental model adds rows: append, merge, delete+insert, insert_overwrite or microbatch."],
    "unique_key": ["config", "The column (or list) that identifies a row. Required by merge and delete+insert, and by every snapshot."],
    "on_schema_change": ["config", "What an incremental model does when columns change: ignore, fail, append_new_columns or sync_all_columns."],
    "event_time": ["config", "Names the column holding each row's event timestamp. Required by microbatch and used by --sample."],
    "begin": ["config", "The earliest event_time a microbatch model should build from - the start of its backfill window."],
    "batch_size": ["config", "The size of each microbatch: hour, day, month or year."],
    "full_refresh": ["config", "Set false to protect a model from --full-refresh, which is how you stop an expensive table being rebuilt by accident."],
    "tags": ["config", "Free-form labels used for selection: dbt build --select tag:fact."],
    "enabled": ["config", "Set false to exclude a resource from the project entirely, without deleting the file."],
    "alias": ["config", "Overrides the relation name dbt creates, when the file name is not the table name you want."],
    "severity": ["config", "warn or error. A warning still reports but does not fail the run - the usual setting for a test you are still tuning."],
    "store_failures": ["config", "Writes failing test rows to a table so you can inspect them instead of rerunning the query by hand."],
    "grants": ["config", "Privileges dbt applies after building a relation, so permissions are declared in code rather than granted by hand."],
    "contract": ["config", "With enforced: true, dbt checks the model's real output against the declared columns and types and fails the build if they drift."],
    "constraints": ["config", "Database-level constraints such as not_null or primary_key. Requires a contract, and enforcement varies by warehouse."],
    "persist_docs": ["config", "Pushes model and column descriptions into the warehouse as comments."],
    "pre-hook": ["config", "SQL run immediately before a model builds."],
    "post-hook": ["config", "SQL run immediately after a model builds - grants, audit rows, vacuum."],
    "on-run-start": ["config", "SQL run once at the very start of a dbt invocation."],
    "on-run-end": ["config", "SQL run once at the end of a dbt invocation."],
    "loaded_at_field": ["config", "The timestamp column dbt reads to judge source freshness."],
    "freshness": ["config", "Thresholds for how stale a source may be, as warn_after and error_after. Checked by dbt source freshness."],
    "warn_after": ["config", "How old source data may get before dbt source freshness reports a warning."],
    "error_after": ["config", "How old source data may get before dbt source freshness fails."],
    "identifier": ["config", "The real table name in the warehouse, when it differs from the name you want to use in dbt."],
    "strategy": ["config", "How a snapshot detects change: timestamp (trust an updated_at column) or check (compare column values)."],
    "updated_at": ["config", "The column a timestamp-strategy snapshot watches to decide a row changed."],
    "check_cols": ["config", "The columns a check-strategy snapshot compares, or 'all'. Use when the source has no reliable updated_at."],
    "hard_deletes": ["config", "What a snapshot does when a row disappears from the source: ignore, invalidate, or new_record."],
    "versions": ["config", "Declares multiple live versions of one model so consumers can migrate on their own schedule."],
    "latest_version": ["config", "Which version plain ref('model') resolves to."],
    "deprecation_date": ["config", "When a model version stops being supported. dbt warns anyone still referencing it."],
    "quoting": ["config", "Whether dbt wraps identifiers in quotes. Matters on warehouses that fold case."],

    /* ---- built-in generic tests ---- */
    "unique": ["test", "Fails if a column has duplicate values. The usual primary key check, paired with not_null."],
    "not_null": ["test", "Fails if a column contains NULLs."],
    "accepted_values": ["test", "Fails if a column holds anything outside the listed values. Catches new categories appearing upstream."],
    "relationships": ["test", "Referential integrity: every value here must exist in the referenced column. Catches orphaned foreign keys."],
    "dbt_expectations": ["package", "A port of Great Expectations to dbt: distribution, regex, row count and column type assertions that go well beyond the four built-ins."],
    "dbt_utils": ["package", "dbt Labs' utility package: surrogate keys, date spines, pivots, and a set of extra generic tests."],

    /* ---- CLI ---- */
    "dbt": ["command", "The dbt CLI. Shape is: dbt <command> [--select ...] [--target ...]."],
    "dbt run": ["command", "Builds models only. Runs the SQL, applies materialisations, skips tests and seeds."],
    "dbt build": ["command", "Runs seeds, models, snapshots and tests together in DAG order, and stops a model's children when its tests fail. The command to use in production."],
    "dbt test": ["command", "Runs tests only, against whatever is already built."],
    "dbt seed": ["command", "Loads the CSVs in seeds/ into the warehouse."],
    "dbt snapshot": ["command", "Runs snapshots, recording any source rows that changed since last time."],
    "dbt compile": ["command", "Renders Jinja to plain SQL in target/ without touching the warehouse. The first thing to reach for when a model misbehaves."],
    "dbt docs generate": ["command", "Builds the documentation site and the catalog from your project plus warehouse metadata."],
    "dbt docs serve": ["command", "Serves the generated docs locally, including the interactive lineage graph."],
    "dbt deps": ["command", "Installs the packages listed in packages.yml into dbt_packages/."],
    "dbt debug": ["command", "Checks the profile, the connection and the project files. The first command to run when nothing works."],
    "dbt init": ["command", "Scaffolds a new project."],
    "dbt clean": ["command", "Deletes the directories listed in clean-targets, usually target/ and dbt_packages/."],
    "dbt ls": ["command", "Lists the resources a selector matches, without building anything. Ideal for checking a --select before committing to it."],
    "dbt list": ["command", "Alias for dbt ls."],
    "dbt retry": ["command", "Reruns the previous invocation from the first failure, skipping everything that already succeeded."],
    "dbt show": ["command", "Runs a model or inline query and prints a preview of the rows to the terminal."],
    "dbt run-operation": ["command", "Invokes a macro directly, outside any model. How maintenance macros get run."],
    "dbt source freshness": ["command", "Checks how stale each source is against its declared thresholds, and exits non-zero on error."],
    "dbt parse": ["command", "Parses the project and writes the manifest without running anything."],

    /* ---- CLI flags ---- */
    "--select": ["flag", "Chooses which resources to act on. Supports +upstream, downstream+, tag:, path:, state: and more."],
    "--exclude": ["flag", "Removes resources from whatever --select matched."],
    "--full-refresh": ["flag", "Forces incremental models to drop and rebuild from scratch."],
    "--target": ["flag", "Picks which output in profiles.yml to connect to: dev, prod, and so on."],
    "--vars": ["flag", "Passes variables at the command line as a YAML dict, overriding dbt_project.yml."],
    "--defer": ["flag", "Falls back to a previous run's artifacts for models you have not built yourself, so a dev build can read prod's tables."],
    "--state": ["flag", "Points at a directory of artifacts from an earlier run, which is what makes state:modified and --defer work."],
    "--empty": ["flag", "Builds every model with a LIMIT 0, so you can validate that the whole DAG compiles and runs without processing data."],
    "--sample": ["flag", "Builds using only a recent time window of input data, using each model's event_time."],
    "--profiles-dir": ["flag", "Where to look for profiles.yml, instead of ~/.dbt/."],
    "--selector": ["flag", "Runs a named selector from selectors.yml."],
    "state:modified": ["selector", "Selects resources that changed versus a previous run's artifacts. The heart of Slim CI."],
    "--threads": ["flag", "How many models dbt builds in parallel. Bounded by what your warehouse will happily run at once."],

    /* ---- project files ---- */
    "dbt_project.yml": ["file", "The root of a dbt project: its name, the profile it uses, folder paths, and default configs for whole directories."],
    "profiles.yml": ["file", "Connection details, kept outside the project by default so credentials never reach version control."],
    "packages.yml": ["file", "Third-party packages to install with dbt deps."],
    "schema.yml": ["file", "Where models get descriptions, tests, contracts and versions. The name is conventional - any .yml under models/ works."],
    "sources.yml": ["file", "Conventional home for source declarations."],
    "selectors.yml": ["file", "Named, reusable selection rules, so a complicated --select lives in version control instead of in someone's shell history."],
    "manifest.json": ["artifact", "The full compiled graph of a project. Powers docs, state comparison and most dbt metadata tooling."],
    "run_results.json": ["artifact", "Timing and status for every node in the last invocation. What dbt retry reads."],
    "catalog.json": ["artifact", "Warehouse metadata - columns, types, sizes - collected by dbt docs generate."],

    /* ---- warehouse SQL ---- */
    "select": ["statement", "Reads rows. A dbt model is a SELECT; dbt supplies the surrounding DDL."],
    "with": ["clause", "Starts a CTE. dbt style leans on CTEs at the top of a model to import each ref() once."],
    "cte": ["concept", "Common table expression - a named subquery. dbt's ephemeral materialisation is implemented by injecting a model as one."],
    "nvl": ["function", "Snowflake's null-coalescing function: NVL(col, fallback) returns the fallback when col is NULL."],
    "greatest": ["function", "Returns the largest of its arguments. Used to combine two updated_at columns after a join."],
    "dateadd": ["function", "Snowflake date arithmetic: DATEADD(DAY, 1, some_date)."],
    "to_date": ["function", "Casts a timestamp or string to a date."],
    "coalesce": ["function", "Returns the first non-NULL argument."],
    "merge": ["statement", "Updates matching rows and inserts the rest in one statement. What dbt generates for the merge incremental strategy."],
    "grant": ["statement", "Gives a privilege on an object to a role. dbt can manage these for you with the grants config."],

    /* ---- Python models ---- */
    "dbt.ref": ["python", "The Python-model equivalent of ref(). Returns a DataFrame for the referenced model."],
    "dbt.source": ["python", "The Python-model equivalent of source()."],
    "dbt.config": ["python", "Sets model config from inside a Python model, including which packages the warehouse should install."],
    "snowpark": ["python", "Snowflake's DataFrame API. Python models run inside the warehouse, so this is what they get instead of a local Spark session."],

    /* ---- surrounding concepts ---- */
    "analytics engineering": ["concept", "Applying software engineering practice - version control, testing, code review, CI - to the transformation layer that analysts own."],
    "elt": ["concept", "Extract, load, then transform inside the warehouse. dbt owns the T; cheap warehouse compute is what made the ordering viable."],
    "etl": ["concept", "Extract, transform, then load. Transformation happens before the warehouse, usually in a separate engine."],
    "dag": ["concept", "Directed acyclic graph. dbt infers it from ref() and source() calls, and uses it to decide build order and parallelism."],
    "slim ci": ["concept", "Building only what a pull request changed, plus its children, by comparing against production artifacts with --select state:modified+ --defer."],
    "idempotent": ["concept", "Running it twice gives the same result as running it once. dbt models are idempotent by design, which is why reruns are safe."],
    "scd": ["concept", "Slowly changing dimension - how a dimension records history. Type 1 overwrites, Type 2 keeps a row per version with validity dates."],
    "medallion": ["concept", "Bronze, silver, gold layering of a warehouse. Maps closely onto dbt's staging, intermediate and marts convention."],
    "fusion": ["concept", "dbt's Rust engine. It parses and compiles far faster than dbt Core and understands SQL well enough to catch errors before the warehouse sees them."],
  };

  const lookup = (raw) => GLOSSARY[raw.toLowerCase().replace(/\s+/g, " ").trim()] || null;

  /* ------------------------------------------------------- language ids */

  const LABELS = {
    sql: "SQL + Jinja", python: "Python", json: "JSON", yaml: "YAML",
    shell: "Shell", text: "Text",
  };

  const detect = (source) => {
    const text = source.trim();
    if (/^[{[]/.test(text) && /^\s*[{[]\s*$|"\s*:/.test(text) && !/\{[{%#]/.test(text)) return "json";
    if (/\{\{|\{%|\{#/.test(text)) {
      // Jinja can appear in YAML too, so let a leading YAML key win.
      if (/^\s*(version|models|sources|seeds|snapshots|name|packages|vars|selectors|unit_tests|exposures|macros|data_tests|outputs)\s*:/m.test(text)
          && !/\bSELECT\b/i.test(text)) return "yaml";
      return "sql";
    }
    if (/^\s*(#|\$\s|dbt\s|uv\s|pip\s|git\s|source\s|export\s|curl\s|dagster\s|airflow\s)/m.test(text)
        && /\b(dbt|uv|pip|git|curl|dagster|airflow|export)\b/.test(text)) return "shell";
    if (/^\s*(import|from|def|class)\s/m.test(text) || /\bdef model\(/.test(text)) return "python";
    if (/^\s*[A-Za-z_-]+\s*:\s*($|[^/])/m.test(text) && !/\bSELECT\b/i.test(text)) return "yaml";
    if (/\b(SELECT|INSERT|CREATE|MERGE|GRANT|ALTER|WITH|UPDATE|COPY)\b/i.test(text)) return "sql";
    return "text";
  };

  const label = (lang) => LABELS[lang] || "Code";

  /* -------------------------------------------------------- tokenisers */

  /* Each tokeniser returns [{ text, cls }]. A single ordered regex per
     language keeps the comment, string and word passes from fighting over
     the same characters. */

  const SQL_KEYWORDS = new Set(("select from where group by order having limit offset join inner left right full outer on " +
    "cross union all intersect except minus insert into values update set delete create replace external table view materialized " +
    "temporary temp drop alter add column rename to as distinct case when then else end and or not null is in between like ilike " +
    "exists with recursive qualify grant revoke privileges usage schema database role user primary foreign key references unique " +
    "check default constraint cascade restrict begin commit rollback transaction explain describe show merge matched using " +
    "if procedure function language returns declare while loop return call over window rows range unbounded " +
    "preceding following current row partition lateral flatten true false asc desc nulls first last cast interval extract " +
    "timestamp timestamp_ntz date time varchar string char integer int bigint smallint decimal numeric number float real double precision " +
    "boolean variant object array text copy stage file_format").split(" "));

  const SQL_FUNCTIONS = new Set(("count sum avg min max round floor ceil abs coalesce nvl nvl2 ifnull nullif iff greatest least " +
    "date_trunc dateadd datediff date_part to_char to_date to_timestamp to_number current_date current_timestamp getdate sysdate " +
    "listagg array_agg object_construct split_part substring substr position trim ltrim rtrim upper lower length replace " +
    "regexp_replace regexp_substr regexp_like try_cast md5 sha2 hash concat " +
    "row_number rank dense_rank lag lead first_value last_value ntile percentile_cont " +
    "parse_json object_keys flatten zeroifnull decode").split(" "));

  /* Jinja identifiers dbt makes available inside a model or macro. */
  const JINJA_TAGS = new Set(("if elif else endif for endfor in set endset macro endmacro call endcall filter endfilter " +
    "test endtest snapshot endsnapshot docs enddocs materialization endmaterialization block endblock raw endraw " +
    "do with endwith and or not is none true false import include extends").split(" "));

  const JINJA_FUNCS = new Set(("ref source config var env_var this target is_incremental log run_query adapter execute " +
    "exceptions doc statement load_result return builtins graph model modules fromjson tojson fromyaml toyaml " +
    "print zip local_md5 invocation_id thread_id run_started_at flags dbt_version selected_resources " +
    "length upper lower trim join replace default list dictsort items keys values int float string " +
    "as_bool as_native as_number as_text set_strict").split(" "));

  /* Tokenise the inside of a {{ ... }} or {% ... %} region. */
  const jinjaInner = (source, out) => {
    const pattern = /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)|(\s+)|([(),[\]{}])|([=<>!+\-*/|~%:])/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > last) out.push({ text: source.slice(last, match.index), cls: "t-idn" });
      const [full, str, num, word, space, punct, op] = match;
      if (str) out.push({ text: full, cls: "t-str" });
      else if (num) out.push({ text: full, cls: "t-num" });
      else if (word) {
        const lower = word.toLowerCase();
        const root = lower.split(".")[0];
        if (lower === "true" || lower === "false" || lower === "none") out.push({ text: full, cls: "t-lit" });
        else if (JINJA_TAGS.has(lower)) out.push({ text: full, cls: "t-kw" });
        else if (JINJA_FUNCS.has(lower) || JINJA_FUNCS.has(root) || /^dbt(_utils|_expectations)?\./.test(lower))
          out.push({ text: full, cls: "t-fn" });
        else out.push({ text: full, cls: "t-idn" });
      } else if (space) out.push({ text: full, cls: "" });
      else if (punct) out.push({ text: full, cls: "t-pun" });
      else if (op) out.push({ text: full, cls: "t-op" });
      last = pattern.lastIndex;
    }
    if (last < source.length) out.push({ text: source.slice(last), cls: "t-idn" });
  };

  /* Plain SQL, with no Jinja left in it. The operator alternative lists the
     two-character forms first so :: stays one token - it is Snowflake's cast,
     and the course leans on it for the price column. */
  const sqlPlain = (source, out) => {
    const pattern = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|("(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9$]*)|(\s+)|([(),;.[\]{}])|(::|<>|<=|>=|!=|\|\||[=<>!+\-*/|@:%])/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > last) out.push({ text: source.slice(last, match.index), cls: "t-idn" });
      const [full, comment, single, double, num, word, space, punct, op] = match;
      if (comment) out.push({ text: full, cls: "t-cmt" });
      else if (single || double) out.push({ text: full, cls: "t-str" });
      else if (num) out.push({ text: full, cls: "t-num" });
      else if (word) {
        const lower = word.toLowerCase();
        if (lower === "true" || lower === "false" || lower === "null") out.push({ text: full, cls: "t-lit" });
        else if (SQL_KEYWORDS.has(lower)) out.push({ text: full, cls: "t-kw" });
        else if (SQL_FUNCTIONS.has(lower)) out.push({ text: full, cls: "t-fn" });
        else out.push({ text: full, cls: "t-idn" });
      } else if (space) out.push({ text: full, cls: "" });
      else if (punct) out.push({ text: full, cls: "t-pun" });
      else if (op) out.push({ text: full, cls: "t-op" });
      last = pattern.lastIndex;
    }
    if (last < source.length) out.push({ text: source.slice(last), cls: "t-idn" });
  };

  /* A dbt model is Jinja and SQL interleaved. Split the Jinja regions out
     first so their contents are never mistaken for SQL identifiers. */
  const sqlTokens = (source) => {
    const out = [];
    const region = /\{#[\s\S]*?#\}|\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}/g;
    let last = 0;
    let match;
    while ((match = region.exec(source)) !== null) {
      if (match.index > last) sqlPlain(source.slice(last, match.index), out);
      const block = match[0];
      if (block.startsWith("{#")) {
        out.push({ text: block, cls: "t-cmt" });
      } else {
        const open = block.startsWith("{%") ? (block.startsWith("{%-") ? "{%-" : "{%") : "{{";
        const close = block.endsWith("-%}") ? "-%}" : (block.endsWith("%}") ? "%}" : "}}");
        out.push({ text: open, cls: "t-jin" });
        jinjaInner(block.slice(open.length, block.length - close.length), out);
        out.push({ text: close, cls: "t-jin" });
      }
      last = region.lastIndex;
    }
    if (last < source.length) sqlPlain(source.slice(last), out);
    return out;
  };

  const PY_KEYWORDS = new Set(("def class return yield import from as if elif else for while in not and or is None True False " +
    "try except finally raise with lambda global nonlocal pass break continue assert del await async").split(" "));
  const PY_BUILTINS = new Set(("print len range str int float dict list set tuple bool open enumerate zip map filter sorted " +
    "sum min max abs round type isinstance getattr setattr format join split apply").split(" "));

  const pyTokens = (source) => {
    const out = [];
    const pattern = /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?""")|(f?'(?:\\.|[^'\\])*'|f?"(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9]*)|(\s+)|([(),;:.[\]{}])|([=<>!+\-*/|@%&])/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > last) out.push({ text: source.slice(last, match.index), cls: "t-idn" });
      const [full, comment, doc, str, num, word, space, punct, op] = match;
      if (comment || doc) out.push({ text: full, cls: "t-cmt" });
      else if (str) out.push({ text: full, cls: "t-str" });
      else if (num) out.push({ text: full, cls: "t-num" });
      else if (word) {
        if (word === "True" || word === "False" || word === "None") out.push({ text: full, cls: "t-lit" });
        else if (PY_KEYWORDS.has(word)) out.push({ text: full, cls: "t-kw" });
        else if (PY_BUILTINS.has(word)) out.push({ text: full, cls: "t-fn" });
        else if (/^(dbt|session|pandas|pd|holidays|textblob|snowpark|DataFrame|F)$/.test(word))
          out.push({ text: full, cls: "t-typ" });
        else out.push({ text: full, cls: "t-idn" });
      } else if (space) out.push({ text: full, cls: "" });
      else if (punct) out.push({ text: full, cls: "t-pun" });
      else if (op) out.push({ text: full, cls: "t-op" });
      last = pattern.lastIndex;
    }
    if (last < source.length) out.push({ text: source.slice(last), cls: "t-idn" });
    return out;
  };

  const jsonTokens = (source) => {
    const out = [];
    const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)|\b(true|false|null)\b|(\s+)|([{}[\],:])/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > last) out.push({ text: source.slice(last, match.index), cls: "t-idn" });
      const [, str, colon, num, lit, space, punct] = match;
      if (str) {
        out.push({ text: str, cls: colon ? "t-key" : "t-str" });
        if (colon) out.push({ text: colon, cls: "t-pun" });
      } else if (num) out.push({ text: match[0], cls: "t-num" });
      else if (lit) out.push({ text: match[0], cls: "t-lit" });
      else if (space) out.push({ text: match[0], cls: "" });
      else if (punct) out.push({ text: match[0], cls: "t-pun" });
      last = pattern.lastIndex;
    }
    if (last < source.length) out.push({ text: source.slice(last), cls: "t-idn" });
    return out;
  };

  /* YAML carries most of a dbt project's meaning, and it frequently embeds
     Jinja in values, so values get a second pass for {{ ... }}. */
  const yamlValue = (text, out) => {
    const region = /\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}/g;
    let last = 0;
    let match;
    while ((match = region.exec(text)) !== null) {
      if (match.index > last) out.push({ text: text.slice(last, match.index), cls: "t-str" });
      const block = match[0];
      const open = block.startsWith("{%") ? "{%" : "{{";
      const close = block.endsWith("%}") ? "%}" : "}}";
      out.push({ text: open, cls: "t-jin" });
      jinjaInner(block.slice(open.length, block.length - close.length), out);
      out.push({ text: close, cls: "t-jin" });
      last = region.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last), cls: "t-str" });
  };

  const yamlTokens = (source) => {
    const out = [];
    source.split(/(\n)/).forEach((line) => {
      if (line === "\n") { out.push({ text: line, cls: "" }); return; }
      // A # inside a Jinja block or a quoted string is not a comment.
      let comment = -1;
      let quote = null;
      let depth = 0;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const pair = line.slice(i, i + 2);
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (pair === "{{" || pair === "{%" || pair === "{#") { depth += 1; i += 1; continue; }
        if (pair === "}}" || pair === "%}" || pair === "#}") { depth = Math.max(0, depth - 1); i += 1; continue; }
        if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(line[i - 1]))) { comment = i; break; }
      }
      const body = comment >= 0 ? line.slice(0, comment) : line;
      const keyMatch = /^(\s*-?\s*)([A-Za-z_+][\w.+-]*)(\s*:)/.exec(body);
      if (keyMatch) {
        out.push({ text: keyMatch[1], cls: "" });
        out.push({ text: keyMatch[2], cls: "t-key" });
        out.push({ text: keyMatch[3], cls: "t-pun" });
        const rest = body.slice(keyMatch[0].length);
        if (rest) yamlValue(rest, out);
      } else if (body) {
        const bullet = /^(\s*-\s*)(.*)$/.exec(body);
        if (bullet) {
          out.push({ text: bullet[1], cls: "t-pun" });
          if (bullet[2]) yamlValue(bullet[2], out);
        } else yamlValue(body, out);
      }
      if (comment >= 0) out.push({ text: line.slice(comment), cls: "t-cmt" });
    });
    return out;
  };

  const shellTokens = (source) => {
    const out = [];
    source.split(/(\n)/).forEach((line) => {
      if (line === "\n") { out.push({ text: line, cls: "" }); return; }
      if (/^\s*#/.test(line)) { out.push({ text: line, cls: "t-cmt" }); return; }
      const pattern = /('(?:[^']*)'|"(?:\\.|[^"\\])*")|(^\s*\$\s)|(--?[A-Za-z][\w-]*\+?)|(\b(?:dbt|uv|pip|python|git|curl|export|source|cd|dagster|airflow|docker|code|snowsql)\b)|(\s+)|([|>&;()])/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        if (match.index > last) out.push({ text: line.slice(last, match.index), cls: "t-idn" });
        const [full, str, prompt, flag, cmd, space, punct] = match;
        if (str) out.push({ text: full, cls: "t-str" });
        else if (prompt) out.push({ text: full, cls: "t-prompt" });
        else if (flag) out.push({ text: full, cls: "t-flag" });
        else if (cmd) out.push({ text: full, cls: "t-cmd" });
        else if (space) out.push({ text: full, cls: "" });
        else if (punct) out.push({ text: full, cls: "t-pun" });
        last = pattern.lastIndex;
      }
      if (last < line.length) out.push({ text: line.slice(last), cls: "t-idn" });
    });
    return out;
  };

  const TOKENISERS = {
    sql: sqlTokens, python: pyTokens, json: jsonTokens,
    yaml: yamlTokens, shell: shellTokens,
  };

  const highlight = (source, lang) => {
    const tokenise = TOKENISERS[lang];
    if (!tokenise) return escapeHtml(source);
    return tokenise(source)
      .map(({ text, cls }) => {
        const safe = escapeHtml(text);
        if (!cls) return safe;
        const entry = lookup(text);
        if (entry) {
          return `<span class="${cls} t-doc" title="${escapeHtml(entry[1])}">${safe}</span>`;
        }
        return `<span class="${cls}">${safe}</span>`;
      })
      .join("");
  };

  /* ------------------------------------------------- construct lookup */

  /* Longest glossary keys first, so "dbt run-operation" beats "dbt run"
     and "dbt docs generate" beats "dbt". */
  const PHRASES = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

  const ACRONYMS = new Set(("dbt sql yaml json csv cte dag scd elt etl ci cd bi ml pr api ide cli url ddl dml " +
    "mv iam rbac utc olap oltp obt pk fk sla ai llm uv s3 aws gcp").split(" "));

  /* Commands, flags and config keys read better verbatim; concepts read
     better in sentence case. */
  const displayLabel = (phrase, kind) => {
    if (kind === "command" || kind === "flag" || kind === "selector" || kind === "file" ||
        kind === "artifact" || kind === "config" || kind === "jinja" || kind === "python" ||
        kind === "test" || kind === "package" || kind === "materialisation") {
      return phrase;
    }
    if (kind === "statement" || kind === "clause" || kind === "function") return phrase.toUpperCase();
    return phrase
      .split(" ")
      .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ");
  };

  const constructs = (source) => {
    /* Colons, dots and pluses are part of dbt's own vocabulary - state:modified,
       dbt.ref, delete+insert - so they survive normalisation when they sit
       between two word characters. Everywhere else they are punctuation: a
       YAML key's trailing colon, the + on state:modified+, a full stop. */
    const haystack = " " + source
      .toLowerCase()
      .replace(/[:.+](?![a-z0-9])/g, " ")
      .replace(/[^a-z0-9:_.+-]+/g, " ") + " ";
    const found = [];
    const claimed = [];

    for (const phrase of PHRASES) {
      const needle = " " + phrase + " ";
      const at = haystack.indexOf(needle);
      if (at < 0) continue;
      // Skip a short phrase already covered by a longer one at the same place.
      if (claimed.some(([start, end]) => at >= start && at + needle.length <= end)) continue;
      claimed.push([at, at + needle.length]);
      const [kind, description] = GLOSSARY[phrase];
      found.push({ label: displayLabel(phrase, kind), kind, description, at });
    }

    return found.sort((a, b) => a.at - b.at);
  };

  window.DbtCode = { detect, label, highlight, constructs };
})();
