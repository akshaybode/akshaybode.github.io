/* Offline syntax highlighting and construct lookup for the AWS notes.

   The notes mix five languages: SQL (Redshift and Athena), Python (Glue jobs
   and boto3), JSON (IAM policies and event payloads), YAML (CloudFormation)
   and shell (the AWS CLI). One tokeniser per language, plus a glossary that
   powers the "Explain" panel under each block.

   Exposes window.AwsCode = { detect, label, highlight, constructs }. */

(() => {
  "use strict";

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  /* ------------------------------------------------------------ glossary */

  /* kind is used to group the Explain panel; description is what the reader
     came for. Keys are compared lower-case with runs of whitespace collapsed. */
  const GLOSSARY = {
    /* ---- AWS services ---- */
    "s3": ["service", "Object storage. The landing zone and the data lake for almost every pipeline on the exam: 11 nines of durability, unlimited objects, storage classes and lifecycle rules."],
    "amazon s3": ["service", "Object storage. The landing zone and the data lake for almost every pipeline on the exam: 11 nines of durability, unlimited objects, storage classes and lifecycle rules."],
    "glue": ["service", "Serverless ETL. Crawlers infer schema into the Data Catalog, jobs run Spark or Python Shell, workflows and triggers orchestrate them."],
    "aws glue": ["service", "Serverless ETL. Crawlers infer schema into the Data Catalog, jobs run Spark or Python Shell, workflows and triggers orchestrate them."],
    "glue data catalog": ["service", "Central metastore of databases, tables, schemas and partitions. Athena, Redshift Spectrum, EMR and Lake Formation all read it."],
    "databrew": ["service", "Visual data preparation - over 250 prebuilt transformations, no code, output written back to S3."],
    "athena": ["service", "Serverless interactive SQL over S3 using Presto/Trino. Billed per TB scanned, so partitioning and columnar formats are the cost levers."],
    "redshift": ["service", "Petabyte-scale columnar data warehouse. Leader node plans, compute nodes execute over slices; RA3 separates compute from Redshift Managed Storage."],
    "redshift spectrum": ["service", "Runs Redshift SQL directly against S3 external tables without loading, using a separate fleet of Spectrum nodes."],
    "redshift serverless": ["service", "Redshift without clusters. Capacity is measured in RPUs and billed per second while queries run."],
    "emr": ["service", "Managed Hadoop/Spark/Hive/HBase/Presto clusters on EC2, EKS or Serverless. For heavy custom big-data processing."],
    "amazon emr": ["service", "Managed Hadoop/Spark/Hive/HBase/Presto clusters on EC2, EKS or Serverless. For heavy custom big-data processing."],
    "lambda": ["service", "Event-driven functions, up to 15 minutes per invocation. The glue between S3 events, streams and APIs."],
    "aws lambda": ["service", "Event-driven functions, up to 15 minutes per invocation. The glue between S3 events, streams and APIs."],
    "kinesis": ["service", "Family of streaming services: Data Streams, Data Firehose, and Managed Service for Apache Flink."],
    "kinesis data streams": ["service", "Real-time shard-based stream with a 24-hour to 365-day retention window. Consumers replay from a stored position."],
    "kds": ["service", "Kinesis Data Streams - real-time shard-based stream, retention 24 hours to 365 days, replayable."],
    "firehose": ["service", "Kinesis Data Firehose - near real-time delivery stream that buffers and writes to S3, Redshift, OpenSearch or Splunk. No retention, no replay."],
    "msk": ["service", "Amazon Managed Streaming for Apache Kafka. Full Kafka API, unlimited retention, partitions instead of shards."],
    "dynamodb": ["service", "Serverless key-value and document NoSQL store. Single-digit millisecond reads, partition key hashing, on-demand or provisioned capacity."],
    "dax": ["service", "DynamoDB Accelerator - a write-through in-memory cache giving microsecond reads for eventually consistent traffic."],
    "rds": ["service", "Managed relational databases: MySQL, PostgreSQL, MariaDB, Oracle, SQL Server, plus Db2."],
    "aurora": ["service", "AWS-built MySQL and PostgreSQL compatible engine, up to 5x/3x faster, storage auto-grows to 128 TiB, 6 copies across 3 AZs."],
    "documentdb": ["service", "Managed MongoDB-compatible document database."],
    "neptune": ["service", "Managed graph database supporting Gremlin, openCypher and SPARQL."],
    "keyspaces": ["service", "Managed Apache Cassandra-compatible wide-column store, queried with CQL."],
    "memorydb": ["service", "Redis-compatible in-memory database that is also durable, thanks to a multi-AZ transaction log."],
    "elasticache": ["service", "Managed Redis or Memcached cache. Volatile - a cache, not a database of record."],
    "timestream": ["service", "Purpose-built time-series database with memory and magnetic storage tiers and built-in analytic functions."],
    "opensearch": ["service", "Managed OpenSearch/Elasticsearch for search, log analytics and dashboards over inverted indexes."],
    "quicksight": ["service", "Serverless BI. SPICE is its in-memory engine; row-level security and Amazon Q sit on top."],
    "lake formation": ["service", "Central permissions layer over the Glue Data Catalog: database, table, column, row and cell-level grants plus LF-Tags."],
    "sagemaker": ["service", "End-to-end machine learning platform: Studio, Feature Store, Data Wrangler, training, hosting and lineage tracking."],
    "step functions": ["service", "Serverless state machine orchestration written in Amazon States Language. Standard and Express workflow types."],
    "eventbridge": ["service", "Serverless event bus routing events by pattern to targets, with a schema registry and cron-style scheduled rules."],
    "mwaa": ["service", "Managed Workflows for Apache Airflow - hosted Airflow for DAG-based pipeline orchestration."],
    "appflow": ["service", "No-code SaaS-to-AWS data transfer (Salesforce, SAP, Zendesk, Slack) on a schedule or on an event."],
    "sns": ["service", "Pub/sub notifications. One publish fans out to many subscribers: SQS, Lambda, HTTP, email, SMS."],
    "sqs": ["service", "Message queue that decouples producers from consumers. Standard queues scale infinitely; FIFO queues preserve order."],
    "api gateway": ["service", "Managed front door for REST, HTTP and WebSocket APIs with throttling, caching and authorisation."],
    "cloudformation": ["service", "Infrastructure as code. Templates declare resources; stacks create, update and roll them back as one unit."],
    "cloudwatch": ["service", "Metrics, logs, alarms and dashboards. Metric filters and subscription filters push log data onward."],
    "cloudtrail": ["service", "Audit log of API activity. Management events are on by default; data events are opt-in and chargeable."],
    "aws config": ["service", "Records resource configuration over time and evaluates it against rules for compliance."],
    "iam": ["service", "Identity and Access Management - users, groups, roles and policies. Roles plus temporary credentials are the pattern to prefer."],
    "kms": ["service", "Key Management Service. Envelope encryption with symmetric or asymmetric CMKs, automatic rotation, multi-Region keys."],
    "macie": ["service", "Uses machine learning to discover and classify sensitive data, especially PII, in S3."],
    "secrets manager": ["service", "Stores and automatically rotates secrets such as database credentials, with cross-Region replication."],
    "shield": ["service", "DDoS protection. Standard is free and automatic; Advanced adds cost protection and a response team."],
    "ecs": ["service", "Elastic Container Service - AWS-native container orchestration with EC2 or Fargate launch types."],
    "eks": ["service", "Elastic Kubernetes Service - managed Kubernetes control plane."],
    "ecr": ["service", "Elastic Container Registry - private and public Docker image registry."],
    "fargate": ["service", "Serverless compute for containers: no EC2 instances to patch or scale."],
    "batch": ["service", "AWS Batch - managed batch job queues that provision compute for you. Best for long-running or non-Spark batch work."],
    "ec2": ["service", "Virtual machines. Instance families trade CPU, memory, storage and network throughput."],
    "ebs": ["service", "Elastic Block Store - network-attached block volumes for one EC2 instance (or multi-attach for io2), snapshotted to S3."],
    "efs": ["service", "Elastic File System - POSIX shared NFS file system, mountable by many instances across AZs."],
    "aws backup": ["service", "Centralised, policy-driven backup across AWS services, with vaults and Vault Lock for immutability."],
    "dms": ["service", "Database Migration Service - homogeneous and heterogeneous migrations, one-off or with ongoing CDC replication."],
    "sct": ["service", "Schema Conversion Tool - converts schema and code between different database engines ahead of a DMS migration."],
    "datasync": ["service", "Agent-based bulk transfer between on-premises storage and AWS, or between AWS storage services, on a schedule."],
    "snowball": ["service", "Physical appliance for petabyte-scale offline transfer when the network would take too long."],
    "transfer family": ["service", "Managed SFTP, FTPS and FTP endpoints in front of S3 or EFS."],
    "vpc": ["service", "Virtual Private Cloud - your own isolated network: subnets, route tables, gateways, security groups and NACLs."],
    "bedrock": ["service", "Managed access to foundation models, with knowledge bases for retrieval-augmented generation."],
    "grafana": ["service", "Amazon Managed Grafana - hosted Grafana workspaces for dashboards over CloudWatch, OpenSearch, Timestream and more."],

    /* ---- SQL ---- */
    "select": ["statement", "Reads rows. On Athena and Redshift Spectrum the amount of data this scans is what you pay for."],
    "insert": ["statement", "Adds rows. On Redshift, single-row inserts are slow - prefer COPY or INSERT INTO ... SELECT."],
    "insert into": ["statement", "Adds rows from a literal list or a query. Bulk form is the efficient one on a columnar warehouse."],
    "update": ["statement", "Modifies rows. Redshift marks the old row deleted and appends a new one, which is why VACUUM exists."],
    "delete": ["statement", "Removes rows and leaves them marked for deletion until VACUUM reclaims the space."],
    "create table": ["statement", "Defines a table. On Redshift this is where DISTSTYLE, DISTKEY and SORTKEY are set."],
    "create table as": ["statement", "CTAS - materialises a query into a new table. On Athena it is the standard way to convert CSV into partitioned Parquet."],
    "create external table": ["statement", "Registers data that stays in S3. Used by Athena, Redshift Spectrum and Hive."],
    "create materialized view": ["statement", "Precomputes and stores a query result. Redshift can auto-refresh it or ingest a stream into it."],
    "create view": ["statement", "Stores a query definition; nothing is materialised and no storage is used."],
    "copy": ["statement", "Redshift's parallel bulk loader. Reads from S3, DynamoDB or EMR across all slices at once - always prefer it to INSERT."],
    "unload": ["statement", "Redshift's parallel export to S3, optionally as Parquet, partitioned and encrypted."],
    "vacuum": ["statement", "Reclaims space from deleted rows and re-sorts the table. FULL, SORT ONLY, DELETE ONLY and REINDEX variants exist."],
    "analyze": ["statement", "Refreshes table statistics so the query planner picks good join orders."],
    "grant": ["statement", "Gives a privilege to a user, group or role."],
    "revoke": ["statement", "Removes a previously granted privilege."],
    "create user": ["statement", "Creates a database user. On Redshift, a user is separate from the IAM identity that may assume it."],
    "create group": ["statement", "Creates a Redshift group. Groups cannot be nested - that is what RBAC roles are for."],
    "create role": ["statement", "Creates a Redshift RBAC role, which can be granted to users or nested inside other roles."],
    "create datashare": ["statement", "Publishes objects from a producer cluster so consumer clusters can read them live."],
    "alter table": ["statement", "Changes a table definition - add columns, alter DISTSTYLE or SORTKEY, attach or detach partitions."],
    "msck repair table": ["statement", "Hive/Athena command that scans S3 and adds every partition it discovers to the metastore."],
    "partitioned by": ["clause", "Declares partition columns. Their values live in the S3 prefix, not in the data files."],
    "stored as": ["clause", "File format of an external table: PARQUET, ORC, AVRO, JSON, TEXTFILE."],
    "location": ["clause", "S3 prefix holding an external table's data."],
    "tblproperties": ["clause", "Table-level options, including partition projection settings and compression hints."],
    "distkey": ["clause", "Column whose hash decides which Redshift slice a row lands on. Choose a high-cardinality join key."],
    "sortkey": ["clause", "Physical sort order on disk. Lets Redshift skip whole blocks using zone maps."],
    "diststyle": ["clause", "How rows spread across slices: KEY, ALL, EVEN or AUTO."],
    "iam_role": ["clause", "The role Redshift assumes to reach S3, Glue or KMS during COPY, UNLOAD or Spectrum queries."],
    "auto refresh": ["clause", "Lets Redshift keep a materialized view current without an explicit REFRESH."],
    "where": ["clause", "Filters rows. On partitioned tables, filtering on the partition column is what prunes files and cuts cost."],
    "group by": ["clause", "Collapses rows into groups for aggregate functions."],
    "join": ["clause", "Combines rows across tables. Distribution style decides whether Redshift can join locally or must redistribute."],
    "unnest": ["clause", "Athena/Presto operator that expands an array or map into rows."],
    "count": ["function", "Number of rows, or of non-null values in a column."],
    "sum": ["function", "Adds numeric values in a group."],
    "approximate_count_distinct": ["function", "HyperLogLog cardinality estimate - far cheaper than COUNT(DISTINCT) on large data."],
    "date_trunc": ["function", "Rounds a timestamp down to a unit, the usual way to bucket time series."],
    "json_extract": ["function", "Pulls a value out of a JSON string using a path expression."],
    "svl_query_report": ["view", "Redshift system view with per-step execution detail for a query."],
    "stl_load_errors": ["view", "Redshift system view listing why rows were rejected during COPY - the first place to look at a load failure."],
    "svv_table_info": ["view", "Redshift system view summarising size, skew, sort key and unsorted percentage per table."],
    "stl_wlm_query": ["view", "Redshift system view showing which WLM queue each query ran in and how long it queued."],

    /* ---- Python ---- */
    "boto3": ["library", "The AWS SDK for Python. boto3.client() for low-level API calls, boto3.resource() for the object-oriented layer."],
    "awsglue": ["library", "Glue's Python library: GlueContext, DynamicFrame, and the job bookmark helpers."],
    "dynamicframe": ["type", "Glue's schema-flexible alternative to a Spark DataFrame; it tolerates inconsistent records and can resolve choice types."],
    "gluecontext": ["type", "Entry point for Glue's readers and writers, wrapping a SparkContext."],
    "sparksession": ["type", "Entry point to Spark SQL and DataFrames."],
    "def": ["keyword", "Defines a Python function. Lambda handlers are ordinary functions taking (event, context)."],
    "lambda_handler": ["function", "Conventional Lambda entry point. Receives the event payload and a context object, returns a JSON-serialisable result."],

    /* ---- JSON / IAM ---- */
    "version": ["policy", "IAM policy language version. Always \"2012-10-17\" for anything with variables or conditions."],
    "statement": ["policy", "One or more permission blocks inside a policy document."],
    "effect": ["policy", "Allow or Deny. An explicit Deny anywhere always wins."],
    "action": ["policy", "The API operations a statement covers, such as s3:GetObject."],
    "resource": ["policy", "The ARNs a statement applies to. Narrow these instead of using \"*\"."],
    "principal": ["policy", "Who the statement applies to. Required in resource-based and trust policies, absent in identity-based ones."],
    "condition": ["policy", "Extra tests that must hold, such as aws:SourceIp or s3:x-amz-server-side-encryption."],
    "sts:assumerole": ["policy", "The action a trust policy allows so another principal can take on this role."],

    /* ---- CLI ---- */
    "aws": ["command", "The AWS CLI. Shape is: aws <service> <operation> --flags."],
    "aws s3 cp": ["command", "Copies objects to or from S3, or between buckets."],
    "aws s3 sync": ["command", "Recursively copies only what changed between a local path and an S3 prefix."],
    "aws glue start-job-run": ["command", "Starts a Glue job and returns its run id."],
    "aws redshift-data execute-statement": ["command", "Runs SQL on Redshift through the Data API - no driver, no persistent connection, IAM-authenticated."],
    "aws athena start-query-execution": ["command", "Submits an Athena query and returns its execution id."],
    "aws dynamodb put-item": ["command", "Writes a single item to a DynamoDB table."],
    "aws kinesis put-record": ["command", "Writes one record to a Kinesis stream; the partition key chooses the shard."],
    "aws lambda invoke": ["command", "Calls a function synchronously or asynchronously and writes the response to a file."],
    "aws sts assume-role": ["command", "Exchanges your identity for temporary credentials on another role."],

    /* ---- YAML / CloudFormation ---- */
    "resources": ["template", "The only required top-level CloudFormation section: the resources to create."],
    "parameters": ["template", "Values supplied at stack creation so one template serves many environments."],
    "outputs": ["template", "Values a stack exports, optionally imported by other stacks."],
    "!ref": ["template", "References a parameter or another resource in the same template."],
    "!getatt": ["template", "Reads an attribute of another resource, such as an ARN."],
  };

  const lookup = (raw) => GLOSSARY[raw.toLowerCase().replace(/\s+/g, " ").trim()] || null;

  /* ------------------------------------------------------- language ids */

  const LABELS = {
    sql: "SQL", python: "Python", json: "JSON", yaml: "YAML",
    shell: "Shell", text: "Text",
  };

  const detect = (source) => {
    const text = source.trim();
    if (/^[{[]/.test(text) && /["}\]]/.test(text)) return "json";
    if (/^\s*(#|aws\s|\$\s|sam\s|docker\s|kubectl\s|hdfs\s|spark-submit)/m.test(text) &&
        /\b(aws|docker|kubectl|sam|spark-submit)\b/.test(text)) return "shell";
    if (/^\s*(import|from|def|class)\s/m.test(text) || /\bboto3\b|\bprint\(/.test(text)) return "python";
    if (/^\s*(AWSTemplateFormatVersion|Resources|Parameters|Type):/m.test(text)) return "yaml";
    if (/\b(SELECT|INSERT|CREATE|COPY|UNLOAD|GRANT|VACUUM|ALTER|WITH)\b/i.test(text)) return "sql";
    return "text";
  };

  const label = (lang) => LABELS[lang] || "Code";

  /* -------------------------------------------------------- tokenisers */

  /* Each tokeniser returns [{ text, cls }]. A single ordered regex per
     language keeps the three passes (comment, string, word) from fighting
     over the same characters. */

  const SQL_KEYWORDS = new Set(("select from where group by order having limit offset join inner left right full outer on " +
    "cross union all intersect except insert into values update set delete create replace external table view materialized " +
    "temporary temp drop alter add column rename to as distinct case when then else end and or not null is in between like ilike " +
    "exists with recursive copy unload credentials iam_role format parquet orc avro json csv gzip bzip2 region " +
    "partitioned stored location tblproperties row serde serdeproperties compound interleaved sortkey distkey diststyle " +
    "key even auto all encode raw analyze vacuum full sort only delete reindex grant revoke privileges usage schema database " +
    "user group role password createdb createuser syslog access unlimited connection limit primary foreign references unique " +
    "check default identity constraint cascade restrict begin commit rollback transaction explain describe show msck repair " +
    "datashare share publicly accessible account namespace consumer producer refresh materialized attach detach partition " +
    "if procedure function language plpgsql returns declare while loop return call using over window rows range unbounded " +
    "preceding following current row partition unnest lateral true false asc desc nulls first last cast interval extract " +
    "session_user current_user timestamp date time varchar char integer bigint smallint decimal numeric real double precision " +
    "boolean super varbyte geometry text array map struct row_level_security masking policy attach detach for").split(" "));

  const SQL_FUNCTIONS = new Set(("count sum avg min max round floor ceil abs coalesce nvl nullif greatest least " +
    "date_trunc dateadd datediff date_part to_char to_date to_timestamp current_date getdate sysdate " +
    "listagg string_agg split_part substring position trim upper lower length replace regexp_replace regexp_extract " +
    "json_extract json_extract_path_text json_parse json_serialize approximate_count_distinct approx_distinct " +
    "row_number rank dense_rank lag lead first_value last_value ntile percentile_cont " +
    "array_agg cardinality element_at map_agg from_unixtime to_unixtime concat md5 sha2").split(" "));

  const sqlTokens = (source) => {
    const out = [];
    const pattern = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|("(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9$]*)|(\s+)|([(),;.[\]{}])|([=<>!+\-*/|@:%])/g;
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
    return out;
  };

  const PY_KEYWORDS = new Set(("def class return yield import from as if elif else for while in not and or is None True False " +
    "try except finally raise with lambda global nonlocal pass break continue assert del await async").split(" "));
  const PY_BUILTINS = new Set(("print len range str int float dict list set tuple bool open enumerate zip map filter sorted " +
    "sum min max abs round type isinstance getattr setattr format join split").split(" "));

  const pyTokens = (source) => {
    const out = [];
    const pattern = /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?""")|(f?'(?:\\.|[^'\\])*'|f?"(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9]*)|(\s+)|([(),;:.[\]{}])|([=<>!+\-*/|@%&])/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > last) out.push({ text: source.slice(last, match.index), cls: "t-idn" });
      const [full, comment, doc, str, num, word, space, punct, op] = match;
      if (comment) out.push({ text: full, cls: "t-cmt" });
      else if (doc) out.push({ text: full, cls: "t-cmt" });
      else if (str) out.push({ text: full, cls: "t-str" });
      else if (num) out.push({ text: full, cls: "t-num" });
      else if (word) {
        if (word === "True" || word === "False" || word === "None") out.push({ text: full, cls: "t-lit" });
        else if (PY_KEYWORDS.has(word)) out.push({ text: full, cls: "t-kw" });
        else if (PY_BUILTINS.has(word)) out.push({ text: full, cls: "t-fn" });
        else if (/^(boto3|awsglue|pyspark|GlueContext|DynamicFrame|SparkContext|SparkSession)$/.test(word))
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

  const yamlTokens = (source) => {
    const out = [];
    source.split(/(\n)/).forEach((line) => {
      if (line === "\n") { out.push({ text: line, cls: "" }); return; }
      const comment = line.indexOf("#");
      const body = comment >= 0 ? line.slice(0, comment) : line;
      const keyMatch = /^(\s*-?\s*)([A-Za-z_!][\w.!:/-]*)(\s*:)/.exec(body);
      if (keyMatch) {
        out.push({ text: keyMatch[1], cls: "" });
        out.push({ text: keyMatch[2], cls: "t-key" });
        out.push({ text: keyMatch[3], cls: "t-pun" });
        const rest = body.slice(keyMatch[0].length);
        if (rest) {
          const tag = /^(\s*)(![A-Za-z]+)/.exec(rest);
          if (tag) {
            out.push({ text: tag[1], cls: "" });
            out.push({ text: tag[2], cls: "t-kw" });
            out.push({ text: rest.slice(tag[0].length), cls: "t-str" });
          } else out.push({ text: rest, cls: "t-str" });
        }
      } else if (body) out.push({ text: body, cls: "t-idn" });
      if (comment >= 0) out.push({ text: line.slice(comment), cls: "t-cmt" });
    });
    return out;
  };

  const shellTokens = (source) => {
    const out = [];
    source.split(/(\n)/).forEach((line) => {
      if (line === "\n") { out.push({ text: line, cls: "" }); return; }
      if (/^\s*#/.test(line)) { out.push({ text: line, cls: "t-cmt" }); return; }
      const pattern = /('(?:[^']*)'|"(?:\\.|[^"\\])*")|(^\s*\$\s)|(--?[A-Za-z][\w-]*)|(\b(?:aws|sam|docker|kubectl|spark-submit|hdfs|hive|psql|python|pip|curl|jq|export)\b)|(\s+)|([|>&;()])/g;
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

  /* Longest glossary keys first, so "create table as" beats "create table"
     and "aws s3 sync" beats "aws". */
  const PHRASES = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

  const ACRONYMS = new Set(("aws s3 sql iam kms ecs eks ecr ebs efs ec2 dms sct vpc msk kds dax rds emr sns sqs api " +
    "cli json yaml csv orc ttl wcu rcu mwaa dynamodb ctas lsi gsi rpu wlm sqa cdc etl elt bi ml llm").split(" "));

  /* SQL and CLI constructs read better shouted or verbatim; service names read
     better in title case. */
  const displayLabel = (phrase, kind) => {
    if (kind === "statement" || kind === "clause" || kind === "function" || kind === "view") {
      return phrase.toUpperCase();
    }
    if (kind === "command" || kind === "policy" || kind === "template") return phrase;
    return phrase
      .split(" ")
      .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ");
  };

  const constructs = (source) => {
    const haystack = " " + source.toLowerCase().replace(/[^a-z0-9:_!]+/g, " ") + " ";
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

  window.AwsCode = { detect, label, highlight, constructs };
})();
