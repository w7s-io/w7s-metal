# w7s-metal

Self-host W7S Cloud on a Linux machine.

`w7s-metal` is the Linux-first packaging and runtime plan for running a single-tenant W7S cloud outside Cloudflare. The goal is to give a developer, agency, startup, homelab operator, or small company a way to turn any Linux server into a GitHub-native deployment cloud:

```text
GitHub Actions -> same w7s-cloud action -> own deploy endpoint -> workerd isolates -> public routes
```

The long-term target is a Cloudflare-like platform shape on commodity infrastructure:

- static sites served from local object storage;
- JavaScript and TypeScript backends running as workerd isolates;
- custom domains and branch URLs;
- cron schedules;
- queues and workflows;
- storage bindings;
- logs, health, and usage limits;
- GitHub Actions OIDC deploys;
- optional Firecracker, multi-node, and Kubernetes adapters later.

## Product Positioning

W7S Metal should be described as:

> W7S Cloud for your own Linux server.

It is not a generic PaaS, not a Kubernetes distribution, and not a multi-tenant hosting business in a box. It should preserve the W7S mental model:

- the repository is the app identity;
- GitHub Actions is the deployment control point;
- the deploy workflow is the interface;
- apps use W7S manifests instead of provider dashboards;
- every deployed app has health, logs, usage policy, and predictable URLs.
- the host belongs to one tenant, so the design can stay much simpler than public `w7s.cloud`.

## First Use Case

The first release should support one Linux machine with:

- Ubuntu/Debian as the primary target;
- one public domain or wildcard subdomain;
- one `w7s-metal` control plane service;
- one local reverse proxy;
- one local metadata database;
- one local object-store-compatible static asset backend;
- one workerd isolate runtime for dynamic apps;
- one GitHub deploy endpoint compatible with `w7s-io/w7s-cloud@v1`.

The initial success case:

1. Install `w7s-metal` on a VPS.
2. Point `*.example.com` at that VPS.
3. Run `w7s-metal init`.
4. Deploy an app from GitHub Actions.
5. Open `https://owner.example.com/repo/`.
6. Deploy a branch and open `https://feature-x--owner.example.com/repo/`.
7. See `/health`, logs, and usage state for the deployed app.

## Repository Scope

This repo should own:

- Linux installation scripts and packages;
- service definitions;
- workerd runtime integration;
- local deploy API packaging;
- host networking setup;
- local storage adapters;
- operational docs;
- smoke tests for a single-machine W7S cloud.

This repo should not fork the whole W7S product surface unless necessary. It should reuse `w7s-core` contracts wherever possible and introduce adapters where Cloudflare-specific primitives currently exist.

## Planned Components

```text
w7s-metal
  installer
    install packages, users, directories, systemd units
  control-plane
    deploy API, metadata, app registry, usage policy
  router
    HTTP/TLS ingress, owner/repo/branch routing, custom domains
  static-runtime
    static asset storage and serving
  isolate-runtime
    workerd config generator, isolate supervisor, app worker launcher
  scheduler
    cron dispatcher for deployed app schedules
  queues
    local queue broker for app queues and internal dispatch
  workflows
    durable workflow runner, likely later than queues
  observability
    logs, metrics, health, deploy metadata
```

## Non-Goals For The MVP

- multi-region hosting;
- automatic bare-metal cluster orchestration;
- full Kubernetes support;
- arbitrary container hosting;
- visual dashboard parity;
- every Cloudflare binding on day one;
- zero-trust multi-tenant hosting for hostile users;
- per-customer public signup and tenant billing.

The MVP should be safe for trusted repos owned by one operator or organization. That metal belongs to that tenant, so the initial architecture should avoid public-cloud tenant complexity and focus on compatibility, reliability, and operational clarity.

## Docs

- [Implementation Plan](./docs/implementation-plan.md)
- [Architecture](./docs/architecture.md)
- [ADR 0001: workerd Before Firecracker And Kubernetes](./docs/adr-0001-workerd-before-firecracker-and-kubernetes.md)
