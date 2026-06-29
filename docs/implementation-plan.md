# Implementation Plan

## Goal

Build a Linux-hosted, single-tenant W7S cloud that can run on a single server first, then grow toward stronger isolation, multi-node metal, and Kubernetes later.

The product promise:

> Bring one Linux server and a domain. Get your own W7S-compatible deployment endpoint.

## Principles

1. Preserve the W7S deploy contract.
   App repositories should keep using the same `w7s-io/w7s-cloud@v1` GitHub Action, only changing `deploy-url` to the operator's own endpoint.

2. Make Cloudflare an adapter, not the product.
   `w7s-core` currently maps many primitives to Cloudflare. `w7s-metal` should identify the equivalent local primitives and keep the app-facing contract stable.

3. Start single-node.
   A single reliable machine is easier to understand, install, debug, and sell than a cluster on day one.

4. Use workerd first.
   The user-facing promise is W7S Workers running on the operator's own metal. workerd is the closest local runtime match to the Workers execution model.

5. Prefer boring host operations.
   Use systemd, journald, nftables, Caddy or nginx, SQLite/Postgres, and S3-compatible object storage before inventing custom infrastructure.

6. Avoid public multi-tenant complexity in the MVP.
   The machine belongs to one tenant. Isolation still matters for reliability and damage containment, but the first design does not need public-cloud tenant billing, noisy-neighbor controls, or hostile-user signup flows.

## Phase 0: Contracts And Repo Shape

Deliverables:

- define the supported subset of the W7S app manifest for metal;
- document the local equivalents of Cloudflare resources;
- define the internal app runtime protocol;
- define host directory layout;
- define installer configuration.

Expected host layout:

```text
/etc/w7s-metal/
  config.toml
  secrets.env

/var/lib/w7s-metal/
  metadata/
  objects/
  apps/
  images/
  queues/

/var/log/w7s-metal/
```

Initial manifest support:

- static frontend output;
- native JavaScript or TypeScript backend output;
- `vars`;
- `secrets`;
- `schedules`;
- basic KV;
- basic queues;
- custom domains through `CNAME`.

Deferred manifest support:

- D1-compatible managed databases;
- Durable Objects;
- Hyperdrive;
- full workflows;
- advanced analytics.

## Phase 1: Single-Node Static Deploys

Objective:

Deploy and serve static W7S apps on one Linux host.

Components:

- deploy API compatible with the existing W7S GitHub Action;
- GitHub OIDC verification;
- deployment archive ingestion;
- metadata database;
- local static asset store;
- reverse proxy route generation;
- URL routing for production and branch deploys;
- `/health` exposing `branch`, `commitHash`, and `deployedAt`.

Recommended implementation:

- control plane in TypeScript or Go;
- SQLite for the first local metadata store;
- filesystem object store for MVP, with MinIO/S3 adapter after;
- Caddy for automatic TLS and wildcard cert support, unless nginx is required.

Acceptance test:

1. Install on fresh Ubuntu server.
2. Configure `W7S_BASE_DOMAIN=example.com`.
3. Deploy a static repo from GitHub Actions.
4. Confirm `https://owner.example.com/repo/` returns the app.
5. Confirm branch URL routing.
6. Confirm health metadata is not `unknown`.

## Phase 2: workerd Runtime MVP

Objective:

Run dynamic JavaScript apps using workerd isolates on the tenant's own machine.

Why workerd first:

- it matches the Cloudflare Workers execution model more closely than raw Node processes;
- it keeps the W7S app contract familiar for JavaScript and TypeScript backends;
- it avoids requiring KVM on the first install;
- it is simpler for a single-tenant host;
- it lets the same deploy action target an operator-owned endpoint without changing the application workflow.

Core pieces:

- app bundle format;
- workerd config generator;
- isolate supervisor;
- app module loader;
- request proxy from host router to workerd;
- lifecycle controller for config reloads, restarts, and app disablement;
- resource and request limits at the process, route, and app-policy layers.

Initial runtime shape:

```text
host router
  -> runtime supervisor
    -> workerd
      -> app isolate
```

MVP constraints:

- trusted repos owned by one tenant;
- workerd runs as a dedicated unprivileged system user;
- no arbitrary privileged host access from app code;
- outbound network allowed by default, with later egress policy;
- app-level limits enforced by W7S policy and host process controls.

Acceptance test:

1. Deploy a repo with `backend/index.ts`.
2. Generate workerd runtime config for the deployed backend.
3. Return a response from the app.
4. Reload or restart the runtime after a new deployment.
5. Confirm logs are attached to the app deployment.
6. Confirm resource limit breach is visible and does not crash the host.

## Phase 3: Schedules, Queues, And Internal Services

Objective:

Make W7S automation primitives work locally.

Schedules:

- read `w7s.json` schedules from deployment metadata;
- dispatch due jobs every minute;
- send signed internal requests to app routes;
- record success, failure, duration, and next run.

Queues:

- start with SQLite-backed or Postgres-backed durable queues;
- support enqueue, consume, retry, dead-letter, and visibility timeout;
- expose internal `W7S_QUEUE` equivalent to apps;
- record usage counters.

Internal RPC:

- support same-owner app calls first;
- add allowlist policy from `w7s.json`;
- route through the host control plane rather than direct VM-to-VM trust.

Acceptance test:

1. Deploy a scheduled job.
2. See it run without an external cron.
3. Deploy a producer and consumer queue pair.
4. Confirm retries and dead letters.
5. Confirm usage counters and logs.

## Phase 4: Storage Bindings

Objective:

Support the minimum useful storage surface for real apps.

Initial storage:

- KV backed by SQLite/Postgres;
- object files backed by filesystem or MinIO;
- secrets stored encrypted at rest;
- env vars injected into the guest runtime.

Later storage:

- D1-like database binding;
- Durable Object-compatible local abstraction;
- S3-compatible production object store;
- Postgres adapter for metadata and app storage.

Acceptance test:

1. Deploy an app with KV binding.
2. Read/write values from the backend.
3. Deploy a new revision and preserve binding data.
4. Deploy branch environment and confirm separate scoped storage.

## Phase 5: Operations And Hardening

Objective:

Make a single-node install understandable and recoverable.

Deliverables:

- `w7s-metal status`;
- `w7s-metal doctor`;
- `w7s-metal logs owner/repo`;
- `w7s-metal deploys owner/repo`;
- backup and restore docs;
- upgrade docs;
- resource usage dashboard or CLI output;
- host firewall recommendations;
- systemd unit hardening;
- VM image signing or checksum verification.

Security hardening:

- run services as dedicated users;
- isolate app data by owner/repo/environment;
- enforce cgroup limits;
- restrict guest kernel features;
- restrict host device access;
- define guest image update policy;
- document unsupported threat models.

## Phase 6: Firecracker, Multi-Node, And Kubernetes Adapter

Objective:

Add stronger isolation and scale-out after the single-node workerd path is reliable.

Firecracker hardening:

- optional per-app or per-group microVM runtime;
- useful when one metal install runs less-trusted repos;
- useful when the operator wants a stronger blast-radius boundary than workerd process isolation;
- should preserve the same deploy API and app contract.

Multi-node metal:

- shared metadata database;
- shared object store;
- node registry;
- deploy placement;
- health-based routing;
- per-node runtime pools;
- simple drain and upgrade process.

Kubernetes adapter:

- package the control plane as Helm chart or manifests;
- use Kubernetes for placement and service discovery;
- keep Firecracker runtime possible through Kata Containers or Firecracker-backed runtimes where available;
- avoid making Kubernetes required for normal self-hosting.

The Kubernetes adapter should come after Firecracker because Kubernetes solves orchestration, not the core W7S requirement of lightweight isolated serverless execution.

The Kubernetes adapter should come after the workerd single-node runtime because Kubernetes solves orchestration, not the first product requirement: one tenant using the same W7S deploy action against their own Linux endpoint.

## First Milestone Proposal

Milestone 1 should be:

> Static W7S Cloud on one Linux server.

Issue breakdown:

1. Define config file and host layout.
2. Implement deploy API stub with GitHub OIDC verification.
3. Store deployment metadata in SQLite.
4. Unpack static deploy artifacts into local object storage.
5. Serve production and branch URLs through the router.
6. Add `/health` metadata.
7. Add installer script and systemd unit.
8. Add smoke test with a sample static repo.

Milestone 2 should be:

> workerd-backed native backend runtime.

Issue breakdown:

1. Define app bundle handoff format.
2. Generate workerd config from deployment metadata.
3. Implement runtime supervisor.
4. Proxy HTTP requests into workerd.
5. Capture app logs.
6. Inject vars, secrets, and W7S internal bindings.
7. Enforce request and usage limits.
8. Add runtime reload and rollback behavior.
