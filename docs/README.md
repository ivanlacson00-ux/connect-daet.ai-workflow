# CONNECT-Daet.ai Documentation

This index distinguishes approved workflow intent, historical security context, and SQL artifacts. Repository documentation does not by itself establish the state of a deployed database.

## Workflow

- [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md) is the authoritative specification for intended workflow behavior.
- It describes requirements, not the actual application implementation or deployed database state.

## Security

- [Database security status](./security/DATABASE_SECURITY_STATUS.md) is a historical security handoff.
- Do not treat outdated statements in that handoff as proof of the current database state.

## Migration files

- [Canonical TEST security migration](./proposed-migrations/001_security_hardening.sql) was deployed successfully to TEST. Its supplied approved SHA-256 is `b96c1fd56135e01f98983e464799d6c2d1a4df4018b5d5bc452f40f4b65ecb9f`.
- Do not execute this migration again as part of documentation organization.
- [Preflight queries](./proposed-migrations/preflight/001_security_preflight.sql) and [post-deployment verification queries](./proposed-migrations/post-deployment/001_security_verification.sql) are read-only inspection SQL.
- Files in [reference](./proposed-migrations/reference/) are historical or superseded proposals and must not be executed.
- The first proposal includes offline-evidence and Storage changes that were deferred; it is not the canonical migration.
- The combined revised proposal has been superseded by the canonical migration and the separate preflight and verification files.
- Historical proposal documents may contain outdated deployment descriptions. They are not evidence of current deployment status.

## Prompts

- [Copilot audit prompt](./prompts/COPILOT_AUDIT_PROMPT.txt) contains supporting AI instructions, not authoritative project requirements.
