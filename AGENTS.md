# AGENTS.md

Instructions for agents working in this repository.

## Completion Rules

- Run `npm run check` before committing code changes.
- If a change affects the Linux installer, also run `bash -n setup.sh`.

## Project Direction

`w7s-metal` is the single-tenant Linux version of W7S Cloud.

The core user story is:

1. A user owns one Linux VPS or bare-metal machine.
2. They install W7S Metal.
3. They keep using `w7s-io/w7s-cloud@v1`.
4. They point the action at their own `deploy-url`.
5. Their static apps deploy and serve from their own domain.
6. Worker-style backends run through workerd in a later milestone.

Do not turn this into a Kubernetes-first platform or a public multi-tenant cloud. The machine belongs to one tenant, so prefer simple Linux operational primitives first: systemd, journald, filesystem storage, Caddy, and explicit environment files.

## Implementation Preferences

- Keep the existing W7S deploy request contract compatible with `w7s-io/w7s-cloud@v1`.
- Preserve `/health` and `/api/v1/health` metadata shape with `branch`, `commitHash`, and `deployedAt`.
- Keep static deploys working while dynamic workerd execution is being built.
- Avoid adding heavy services unless they are required for the next milestone.
- Prefer readable TypeScript modules and focused tests over large framework abstractions.

## Installer Rules

- `setup.sh` should be safe to run on a fresh Ubuntu/Debian VPS as root.
- It should be idempotent where practical.
- It should fail fast with clear error messages.
- It should not overwrite an existing deploy token unless explicitly configured.
- It should install a systemd service and leave the user with exact health-check and GitHub Action instructions.
