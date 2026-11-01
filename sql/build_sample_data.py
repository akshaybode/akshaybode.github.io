"""Rebuild the public sample rows from setup.sql (requires Python duckdb)."""
import datetime
import decimal
import json
import pathlib
import re

import duckdb

root = pathlib.Path(__file__).parent
source = (root / 'setup.sql').read_text(encoding='utf-8')
table_names = re.findall(r'CREATE OR REPLACE TABLE (\w+)', source)
connection = duckdb.connect(':memory:')
for statement in source.replace('NUMBER(', 'DECIMAL(').replace('TIMESTAMP_NTZ', 'TIMESTAMP').split(';'):
    statement = '\n'.join(line for line in statement.splitlines() if not line.strip().startswith('--')).strip()
    if statement and not statement.startswith(('CREATE DATABASE', 'CREATE SCHEMA', 'USE SCHEMA')):
        connection.execute(statement)

def normalize(value):
    if isinstance(value, datetime.datetime):
        return value.isoformat(sep=' ')
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value

tables = {}
for name in table_names:
    columns = connection.execute(f'DESCRIBE {name}').fetchall()
    rows = connection.execute(f'SELECT * FROM {name}').fetchall()
    tables[name] = {
        'columns': [{'name': column[0], 'type': column[1].replace('DECIMAL(', 'NUMBER(').replace('TIMESTAMP', 'TIMESTAMP_NTZ')} for column in columns],
        'rows': [[normalize(value) for value in row] for row in rows],
    }

(root / 'sample-data.js').write_text('/* Generated from setup.sql. */\nwindow.SQL_SAMPLE_DATA = ' + json.dumps(tables, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
print(f'Wrote {len(tables)} tables and {sum(len(table["rows"]) for table in tables.values())} rows')
