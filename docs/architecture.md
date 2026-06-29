# Architecture

## System Shape

`w7s-metal` should provide single-tenant W7S Cloud semantics on a Linux host.

```text
GitHub Actions using w7s-io/w7s-cloud@v1
  |
  | POST /api/v1/deploy
  v
W7S Metal control plane
  |
  +-- metadata database
  +-- static asset store
  +-- scheduler
  +-- queue broker
  +-- runtime supervisor
  |
  v
host router / TLS ingress
  |
  +-- static assets
  +-- workerd isolates
```

## Mapping Cloudflare Primitives To Linux

| W7S concept | Cloudflare implementation | Metal implementation |
| --- | --- | --- |
| Deploy API | Worker route | Local control plane HTTP service |
| Static assets | R2 or FS bucket | Filesystem store, later MinIO/S3 |
| App metadata | KV | SQLite first, Postgres later |
| Native backend | Workers for Platforms | workerd isolate runtime |
| Service binding | Worker service binding | Signed internal HTTP through control plane |
| KV binding | KV namespace | SQLite/Postgres table namespace |
| Queue | Cloudflare Queues | Local durable queue broker |
| Schedule | Cron trigger + dispatcher | systemd timer or internal minute scheduler |
| Workflow | Cloudflare Workflows | Durable local workflow runner |
| Logs | Tail Worker + APIs | journald + structured log collector |
| Analytics | Analytics Engine | SQLite/Postgres/ClickHouse optional |
| Custom domains | Worker routes + DNS | reverse proxy routes + DNS |

## Control Plane

Responsibilities:

- verify GitHub Actions OIDC tokens;
- accept deploy archives;
- normalize owner, repo, branch, and environment;
- parse W7S manifest;
- store deployment records;
- create static and runtime artifacts;
- update router state;
- expose deploy, usage, logs, and health APIs;
- enforce usage and burst policy.

The control plane should expose health metadata:

```json
{
  "ok": true,
  "branch": "main",
  "commitHash": "full-git-sha",
  "deployedAt": "2026-06-29T00:00:00.000Z"
}
```

## Router

Responsibilities:

- terminate TLS;
- route owner-hosted W7S URLs;
- route branch-prefixed hosts;
- route custom domains;
- serve static assets directly when possible;
- forward dynamic requests to the runtime supervisor;
- preserve request metadata for logs and usage accounting.

URL rules should match W7S Cloud:

```text
https://<owner>.<base-domain>/<repo>/
https://<branch>--<owner>.<base-domain>/<repo>/
```

Custom domain branch URLs:

```text
https://app.example.com/
https://feature-x--app.example.com/
```

## Runtime Supervisor

Responsibilities:

- generate workerd configs from deployment metadata;
- run workerd under a dedicated unprivileged user;
- load deployed app worker modules;
- restart or reload runtime state on deployment changes;
- proxy requests to the right app isolate;
- collect logs;
- enforce request and usage policies;
- expose runtime metrics.

Initial runtime lifecycle:

```text
deployment accepted
  -> write app bundle
  -> generate workerd config
  -> reload runtime supervisor
  -> mark ready
  -> proxy request
  -> collect logs and usage
```

## Firecracker Option

Firecracker should remain an optional hardening path after the workerd MVP.

Use Firecracker when:

- the operator runs less-trusted repositories;
- stronger per-app blast-radius boundaries are required;
- KVM is available and the operational complexity is acceptable;
- app cold-start and image-management costs are justified.

The app contract should not change when this runtime is introduced.

## Storage

MVP:

- SQLite for metadata and basic KV;
- filesystem directories for static assets and app bundles;
- encrypted local secrets file or database table.

Production path:

- Postgres for metadata;
- MinIO/S3 for assets and app bundles;
- age/sops/KMS-compatible secret encryption;
- optional ClickHouse for analytics-heavy installs.

## CLI

The CLI should be the operator interface:

```sh
w7s-metal init
w7s-metal status
w7s-metal doctor
w7s-metal logs owner/repo
w7s-metal deploys owner/repo
w7s-metal apps
w7s-metal upgrade
```

The CLI should read `/etc/w7s-metal/config.toml` by default.

## Installer

The installer should:

- verify OS and kernel support;
- verify KVM availability;
- install required packages;
- create users and directories;
- write config templates;
- install systemd units;
- configure router integration;
- create a first admin token or setup key;
- run smoke checks.

Minimum host checks:

```sh
test -e /dev/kvm
uname -r
systemctl --version
iptables --version || nft --version
```

## Security Model

MVP trust model:

- one operator;
- trusted GitHub repositories;
- no hostile multi-tenant public signup;
- workerd process isolation plus host-level service hardening.

Hardening direction:

- optional Firecracker jailer;
- cgroups v2;
- seccomp;
- dedicated Linux users;
- no privileged app mounts;
- signed runtime artifacts or guest images;
- outbound network policy;
- per-app filesystem boundaries;
- encrypted secrets;
- audit logs for deploys and runtime actions.

## Open Questions

- Should the first control plane be TypeScript, Go, or Rust?
- Should Caddy be the default router for easier TLS?
- Should metadata start with SQLite only, or offer Postgres from day one?
- Should workerd run one shared config for all apps or one process per app group?
- How much of `w7s-core` can be reused before adapter boundaries are needed?
- Should app deploys use the current GitHub Action unchanged or introduce `w7s-metal` as a target profile?
