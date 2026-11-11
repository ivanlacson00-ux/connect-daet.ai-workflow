# Test helpers: run SQL as a simulated Supabase user (role authenticated + JWT sub claim).
DB=${DB:-daet}
PSQL="psql -h ${PGHOST:-/var/run/postgresql} -p ${PGPORT:-5432} -U ${PGUSER:-postgres} -d $DB -At -v ON_ERROR_STOP=1 -q"
PASS=0; FAIL=0; RESULTS=()
as() { # as <uuid|anon|service> <sql>
  local who=$1; shift
  if [ "$who" = service ]; then
    $PSQL -c "select set_config('request.jwt.claim.role','service_role',false)" -c "set role service_role" -c "$*" 2>&1
  elif [ "$who" = anon ]; then
    $PSQL -c "select set_config('request.jwt.claim.role','anon',false)" -c "set role anon" -c "$*" 2>&1
  else
    $PSQL -c "select set_config('request.jwt.claim.sub','$who',false), set_config('request.jwt.claim.role','authenticated',false)" -c "set role authenticated" -c "$*" 2>&1 | sed '1d'
  fi
}
db() { $PSQL -c "$*" 2>&1; }
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS | $1"); echo "PASS | $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL | $1 :: $2"); echo "FAIL | $1 :: $2"; }
expect_ok()   { local name=$1; shift; local out; out=$(as "$@"); if echo "$out" | grep -q "ERROR"; then bad "$name" "$(echo "$out"|grep ERROR|head -1)"; else ok "$name"; fi; LAST="$out"; }
expect_err()  { local name=$1 pat=$2; shift 2; local out; out=$(as "$@"); if echo "$out" | grep -q "ERROR"; then if [ -z "$pat" ] || echo "$out" | grep -qiE "$pat"; then ok "$name"; else bad "$name" "wrong error: $(echo "$out"|grep ERROR|head -1)"; fi; else bad "$name" "expected failure, got: $(echo "$out"|tail -1)"; fi; LAST="$out"; }
expect_eq()   { local name=$1 want=$2; shift 2; local got; got=$(as "$@" | tail -1); if [ "$got" = "$want" ]; then ok "$name"; else bad "$name" "want '$want' got '$got'"; fi; }
db_eq()       { local name=$1 want=$2; shift 2; local got; got=$(db "$@" | tail -1); if [ "$got" = "$want" ]; then ok "$name"; else bad "$name" "want '$want' got '$got'"; fi; }
summary() { echo; echo "TOTAL: $PASS passed, $FAIL failed"; }
# Blocked = the statement errors OR affects no rows (RLS filters the row; "returning" yields nothing).
expect_blocked() { local name=$1; shift; local out; out=$(as "$@"); if echo "$out" | grep -q "ERROR" || [ -z "$(echo "$out" | grep -v '^$')" ]; then ok "$name"; else bad "$name" "write succeeded: $(echo "$out"|tail -1)"; fi; }
