-- READ-ONLY DEPLOYMENT PREFLIGHT — clean CONNECT-Daet.ai schema.
-- Intended target: connect-daet-dev / zmtdorriscurlvvzovfg (TEST only).
-- Independently verify the Dashboard project identity before running.
-- This file contains catalog SELECTs only; it does not prove access to a
-- particular Supabase project and does not execute deployment operations.
--
-- A PASS is a catalog-based precondition indicator, not a guarantee that every
-- migration command will succeed. Supabase postgres is not assumed to be a
-- true superuser. Any FAIL or WARNING requires review before deployment.
-- For a fresh executor role, PostgreSQL 17 gives its non-superuser creator
-- ADMIN OPTION but not SET; the migration must grant SET TRUE before ownership
-- transfer. For an existing role, the actor needs SET already, direct ADMIN
-- OPTION to grant SET, or superuser authority. Migration 1 separately rejects
-- any membership on a pre-existing executor role.

WITH actor AS (
  SELECT r.oid, r.rolname, r.rolsuper, r.rolcreaterole
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = current_user
),
executor AS (
  SELECT r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole,
    r.rolcreatedb, r.rolinherit, r.rolbypassrls
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'connect_daet_workflow_executor'
),
public_schema AS (
  SELECT n.oid, n.nspowner, n.nspacl
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname = 'public'
),
private_schema AS (
  SELECT n.oid, n.nspowner
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname = 'private'
),
pgcrypto AS (
  SELECT e.oid, e.extnamespace, n.nspname AS extension_schema
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto'
),
digest_function AS (
  SELECT p.oid, p.proowner, p.proacl
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure('extensions.digest(bytea,text)')
),
role_membership AS (
  SELECT e.oid IS NULL AS executor_will_be_created,
    coalesce(a.rolsuper, false) AS actor_is_superuser,
    coalesce(a.rolcreaterole, false) AS actor_can_create_roles,
    CASE WHEN a.oid IS NOT NULL AND e.oid IS NOT NULL
      THEN pg_catalog.pg_has_role(a.oid, e.oid, 'SET')
      ELSE false END AS actor_can_set_executor_role,
    CASE WHEN a.oid IS NOT NULL AND e.oid IS NOT NULL
      THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS m
        WHERE m.roleid = e.oid
          AND m.member = a.oid
          AND m.admin_option
      )
      ELSE false END AS actor_has_direct_executor_admin_option
  FROM actor AS a
  LEFT JOIN executor AS e ON true
),
schema_authority AS (
  SELECT
    s.oid,
    a.oid = s.nspowner
      OR coalesce(pg_catalog.pg_has_role(a.oid, s.nspowner, 'USAGE'), false)
      AS actor_owns_or_inherits_schema_owner,
    coalesce((
      SELECT bool_or(
        acl.privilege_type = 'CREATE'
        AND acl.is_grantable
        AND CASE WHEN acl.grantee = 0 THEN true
          ELSE pg_catalog.pg_has_role(a.oid, acl.grantee, 'USAGE') END
      )
      FROM pg_catalog.aclexplode(s.nspacl) AS acl
    ), false) AS actor_has_schema_create_grant_option
  FROM public_schema AS s
  CROSS JOIN actor AS a
),
schema_usage_authority AS (
  SELECT n.nspname, n.oid, n.nspowner,
    a.rolsuper OR a.oid = n.nspowner
      OR coalesce(pg_catalog.pg_has_role(a.oid, n.nspowner, 'USAGE'), false)
      AS actor_has_owner_authority,
    coalesce((
      SELECT bool_or(
        acl.privilege_type = 'USAGE'
        AND acl.is_grantable
        AND CASE WHEN acl.grantee = 0 THEN true
          ELSE pg_catalog.pg_has_role(a.oid, acl.grantee, 'USAGE') END
      )
      FROM pg_catalog.aclexplode(
        coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
      ) AS acl
    ), false) AS actor_has_usage_grant_option
  FROM pg_catalog.pg_namespace AS n
  CROSS JOIN actor AS a
  WHERE n.nspname IN ('public', 'extensions')
),
findings(check_name, status, detail) AS (
  SELECT 'preflight.connected_role',
    CASE WHEN a.oid IS NULL THEN 'FAIL' ELSE 'PASS' END,
    format('current_user=%s; SUPERUSER=%s; CREATEROLE=%s',
      current_user, coalesce(a.rolsuper, false), coalesce(a.rolcreaterole, false))
  FROM (SELECT 1) AS one_row
  LEFT JOIN actor AS a ON true

  UNION ALL
  SELECT 'preflight.postgres_execution_identity',
    CASE WHEN current_user = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
    format('current_user=%s; migration 1 creates the private identity helper and signup trigger as postgres',
      current_user)
  FROM (SELECT 1) AS one_row

  UNION ALL
  SELECT 'preflight.private_schema_owner_and_creation',
    CASE
      WHEN current_user <> 'postgres' THEN 'FAIL'
      WHEN p.oid IS NULL AND pg_catalog.has_database_privilege(
        current_user, current_database(), 'CREATE') THEN 'PASS'
      WHEN p.oid IS NULL THEN 'FAIL'
      WHEN pg_catalog.pg_get_userbyid(p.nspowner) = 'postgres' THEN 'PASS'
      ELSE 'FAIL'
    END,
    format('private_schema_exists=%s; owner=%s; database_CREATE=%s; expected owner and migration identity are postgres',
      p.oid IS NOT NULL,
      coalesce(pg_catalog.pg_get_userbyid(p.nspowner), '<not created>'),
      pg_catalog.has_database_privilege(
        current_user, current_database(), 'CREATE'))
  FROM (SELECT 1) AS one_row
  LEFT JOIN private_schema AS p ON true

  UNION ALL
  SELECT 'preflight.executor_role_creation',
    CASE WHEN e.oid IS NOT NULL THEN 'PASS'
         WHEN a.rolsuper OR a.rolcreaterole THEN 'PASS'
         ELSE 'FAIL' END,
    CASE WHEN e.oid IS NOT NULL THEN
      'executor role exists; its attributes and membership are checked separately'
    ELSE format('executor role absent; migration role CREATEROLE=%s SUPERUSER=%s; CREATE ROLE requires role-creation authority',
      coalesce(a.rolcreaterole, false), coalesce(a.rolsuper, false))
    END
  FROM (SELECT 1) AS one_row
  LEFT JOIN actor AS a ON true
  LEFT JOIN executor AS e ON true

  UNION ALL
  SELECT 'preflight.executor_role_attributes',
    CASE WHEN e.oid IS NULL THEN 'WARNING'
         WHEN e.rolcanlogin OR e.rolsuper OR e.rolcreaterole OR e.rolcreatedb
           OR e.rolinherit OR e.rolbypassrls
           OR EXISTS (
             SELECT 1 FROM pg_catalog.pg_auth_members AS m
             WHERE m.roleid = e.oid OR m.member = e.oid
           )
         THEN 'FAIL' ELSE 'PASS' END,
    CASE WHEN e.oid IS NULL THEN 'role will be created NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
    ELSE format('LOGIN=%s SUPERUSER=%s CREATEROLE=%s CREATEDB=%s INHERIT=%s BYPASSRLS=%s; role memberships=%s; migration 1 requires zero memberships when the executor role pre-exists',
      e.rolcanlogin, e.rolsuper, e.rolcreaterole, e.rolcreatedb,
      e.rolinherit, e.rolbypassrls,
      (SELECT count(*) FROM pg_catalog.pg_auth_members AS m
       WHERE m.roleid = e.oid OR m.member = e.oid))
    END
  FROM (SELECT 1) AS one_row
  LEFT JOIN executor AS e ON true

  UNION ALL
  SELECT 'preflight.executor_membership_grant',
    CASE WHEN rm.executor_will_be_created
           AND (rm.actor_is_superuser OR rm.actor_can_create_roles)
         THEN 'PASS'
         WHEN rm.actor_is_superuser
           OR rm.actor_can_set_executor_role
           OR rm.actor_has_direct_executor_admin_option THEN 'PASS'
         ELSE 'FAIL' END,
    CASE WHEN rm.executor_will_be_created THEN
      format('fresh role: actor SUPERUSER=%s CREATEROLE=%s; a non-superuser creator automatically receives ADMIN OPTION without SET/INHERIT, so the migration must grant itself SET TRUE',
        rm.actor_is_superuser, rm.actor_can_create_roles)
    ELSE format('pre-existing role: actor SUPERUSER=%s CREATEROLE=%s can_SET_now=%s has_direct_ADMIN_OPTION=%s; CREATEROLE alone does not grant membership authority on an existing role',
      rm.actor_is_superuser, rm.actor_can_create_roles,
      rm.actor_can_set_executor_role,
      rm.actor_has_direct_executor_admin_option)
    END
  FROM role_membership AS rm

  UNION ALL
  SELECT 'preflight.public_schema_create_grant_authority',
    CASE WHEN e.oid IS NOT NULL
          AND pg_catalog.has_schema_privilege(e.oid, s.oid, 'CREATE')
         THEN 'PASS'
         WHEN sa.actor_owns_or_inherits_schema_owner
           OR sa.actor_has_schema_create_grant_option
           OR a.rolsuper THEN 'PASS'
         ELSE 'FAIL' END,
    format('public_owner=%s; executor_already_has_CREATE=%s; actor_is_schema_owner=%s; actor_has_CREATE_grant_option=%s; actor_superuser=%s',
      pg_catalog.pg_get_userbyid(s.nspowner),
      CASE WHEN e.oid IS NULL THEN false
           ELSE pg_catalog.has_schema_privilege(e.oid, s.oid, 'CREATE') END,
      sa.actor_owns_or_inherits_schema_owner,
      sa.actor_has_schema_create_grant_option, a.rolsuper)
  FROM actor AS a
  CROSS JOIN public_schema AS s
  CROSS JOIN schema_authority AS sa
  LEFT JOIN executor AS e ON true

  UNION ALL
  SELECT 'preflight.schema_usage_grant_authority',
    CASE WHEN e.oid IS NOT NULL AND pg_catalog.has_schema_privilege(
             e.oid, s.oid, 'USAGE') THEN 'PASS'
         WHEN s.oid IS NULL AND requested.schema_name = 'extensions'
           AND pg_catalog.has_database_privilege(
             current_user, current_database(), 'CREATE') THEN 'WARNING'
         WHEN s.oid IS NULL THEN 'FAIL'
         WHEN a.rolsuper OR s.actor_has_owner_authority
           OR s.actor_has_usage_grant_option THEN 'PASS'
         ELSE 'FAIL' END,
    format('schema=%s; executor_already_has_USAGE=%s; actor_owner_authority=%s; actor_USAGE_grant_option=%s',
      requested.schema_name,
      CASE WHEN s.oid IS NULL OR e.oid IS NULL THEN false
           ELSE pg_catalog.has_schema_privilege(e.oid, s.oid, 'USAGE') END,
      coalesce(s.actor_has_owner_authority, false),
      coalesce(s.actor_has_usage_grant_option, false))
  FROM (VALUES ('public'::text), ('extensions')) AS requested(schema_name)
  LEFT JOIN schema_usage_authority AS s ON s.nspname = requested.schema_name
  CROSS JOIN actor AS a
  LEFT JOIN executor AS e ON true

  UNION ALL
  SELECT 'preflight.database_create_for_extensions',
    CASE WHEN pg_catalog.to_regnamespace('extensions') IS NULL
           AND NOT pg_catalog.has_database_privilege(
             current_user, current_database(), 'CREATE') THEN 'FAIL'
         WHEN pg_catalog.to_regnamespace('extensions') IS NULL THEN 'WARNING'
         WHEN p.oid IS NULL
           AND NOT pg_catalog.has_database_privilege(
             current_user, current_database(), 'CREATE') THEN 'FAIL'
         WHEN p.oid IS NULL THEN 'WARNING'
         WHEN p.extension_schema <> 'extensions' THEN 'FAIL'
         ELSE 'PASS' END,
    format('extensions_schema_exists=%s; pgcrypto_installed=%s; pgcrypto_schema=%s; migration_role_database_CREATE=%s; extension-install authorization cannot be proven from CREATE alone',
      pg_catalog.to_regnamespace('extensions') IS NOT NULL,
      p.oid IS NOT NULL,
      coalesce(p.extension_schema, '<not installed>'),
      pg_catalog.has_database_privilege(
        current_user, current_database(), 'CREATE'))
  FROM (SELECT 1) AS one_row
  LEFT JOIN pgcrypto AS p ON true

  UNION ALL
  SELECT 'preflight.pgcrypto_location_and_digest',
    CASE WHEN p.oid IS NULL THEN 'WARNING'
         WHEN p.extension_schema <> 'extensions' THEN 'FAIL'
         WHEN d.oid IS NULL THEN 'FAIL'
         ELSE 'PASS' END,
    format('installed=%s; extension_schema=%s; extensions.digest(bytea,text)_exists=%s',
      p.oid IS NOT NULL, coalesce(p.extension_schema, '<not installed>'),
      d.oid IS NOT NULL)
  FROM (SELECT 1) AS one_row
  LEFT JOIN pgcrypto AS p ON true
  LEFT JOIN digest_function AS d ON true

  UNION ALL
  SELECT 'preflight.pgcrypto_execute_grant_authority',
    CASE WHEN d.oid IS NULL THEN 'WARNING'
         WHEN a.rolsuper
           OR a.oid = d.proowner
           OR pg_catalog.pg_has_role(a.oid, d.proowner, 'USAGE')
           OR EXISTS (
             SELECT 1 FROM pg_catalog.aclexplode(
               coalesce(d.proacl, pg_catalog.acldefault('f', d.proowner))
             ) AS acl
             WHERE acl.privilege_type = 'EXECUTE'
               AND acl.is_grantable
               AND CASE WHEN acl.grantee = 0 THEN true
                 ELSE pg_catalog.pg_has_role(a.oid, acl.grantee, 'USAGE') END
           )
         THEN 'PASS' ELSE 'FAIL' END,
    format('extensions.digest exists=%s; owner=%s; actor can grant EXECUTE to executor=%s',
      d.oid IS NOT NULL,
      coalesce(pg_catalog.pg_get_userbyid(d.proowner), '<not installed>'),
      CASE WHEN d.oid IS NULL THEN false
        ELSE a.rolsuper OR a.oid = d.proowner
          OR pg_catalog.pg_has_role(a.oid, d.proowner, 'USAGE')
          OR EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              coalesce(d.proacl, pg_catalog.acldefault('f', d.proowner))
            ) AS acl
            WHERE acl.privilege_type = 'EXECUTE' AND acl.is_grantable
              AND CASE WHEN acl.grantee = 0 THEN true
                ELSE pg_catalog.pg_has_role(a.oid, acl.grantee, 'USAGE') END
          )
      END)
  FROM actor AS a
  LEFT JOIN digest_function AS d ON true

  UNION ALL
  SELECT 'preflight.function_ownership_transfer',
    'WARNING',
    'Catalog preflight cannot conclusively prove ALTER FUNCTION OWNER will succeed for functions not yet created. The migration role must own each newly created function, be able to SET/assume connect_daet_workflow_executor through membership, and the target owner must have CREATE on public at transfer time. Confirm target role membership and public CREATE authority above; verify all resulting owners after deployment.'
)
SELECT check_name, status, detail
FROM findings
ORDER BY check_name;
