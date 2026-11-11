#!/bin/bash
# Run with: bash tests/db/run.sh
# Replays every migration in supabase/migrations onto a throwaway local PostgreSQL 15/16
# database (with a minimal Supabase emulation), then runs the workflow/RLS scenario suites.
# Never point this at a Supabase project: it drops and recreates the database named $DB.
#   PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres DB=daet_audit_test tests/db/run.sh
# pg_cron and pg_net are emulated; the server needs stub control files for them:
#   for x in pg_cron pg_net; do printf "default_version = '1.0'\nrelocatable = true\n" > "$(pg_config --sharedir)/extension/$x.control"; echo "-- stub" > "$(pg_config --sharedir)/extension/$x--1.0.sql"; done
set -u
cd "$(dirname "$0")"
export DB=${DB:-daet_audit_test}
[ "$DB" = postgres ] && { echo "Refusing to use the postgres database"; exit 1; }
P="psql -h ${PGHOST:-/var/run/postgresql} -p ${PGPORT:-5432} -U ${PGUSER:-postgres}"
$P -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 1
$P -q -v ON_ERROR_STOP=1 -d $DB -f 00_supabase_stub.sql >/dev/null 2>&1 || { echo "stub failed"; exit 1; }
$P -q -v ON_ERROR_STOP=1 -d $DB -f 01_reconstructed_base.sql >/dev/null || exit 1
for f in $(ls ../../supabase/migrations/*.sql | sort); do
  $P -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null 2>/tmp/daet_mig_err.txt || { echo "MIGRATION FAILED: $f"; cat /tmp/daet_mig_err.txt; exit 1; }
done
echo "Migrations replayed."
bash ./scenarios.sh | tail -n 1
$P -q -d postgres -c "drop database $DB" -c "create database $DB" >/dev/null
$P -q -v ON_ERROR_STOP=1 -d $DB -f 00_supabase_stub.sql >/dev/null 2>&1; $P -q -d $DB -f 01_reconstructed_base.sql >/dev/null
for f in $(ls ../../supabase/migrations/*.sql | sort); do $P -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null 2>&1; done
bash ./scenarios2.sh | tail -n 1
