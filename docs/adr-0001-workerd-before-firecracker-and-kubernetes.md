# ADR 0001: workerd Before Firecracker And Kubernetes

## Status

Proposed.

## Context

The goal of `w7s-metal` is to let one tenant run their own W7S Cloud on a Linux machine.

The intended user experience is:

1. Install W7S Metal on a Linux server.
2. Point a domain or wildcard DNS at that server.
3. Keep using `w7s-io/w7s-cloud@v1` in GitHub Actions.
4. Set `deploy-url` to the operator-owned W7S Metal endpoint.
5. Deploy static apps and Worker-style backends to that machine.

This is different from building a public multi-tenant cloud. The metal belongs to the operator. The first design can assume trusted repositories controlled by that operator or organization.

## Decision

`w7s-metal` will prioritize a workerd-backed runtime before Firecracker and Kubernetes.

The MVP runtime should use workerd isolates for native JavaScript and TypeScript backends. Firecracker remains a later hardening option. Kubernetes remains a later orchestration adapter.

## Rationale

workerd is the closest local fit for the Cloudflare Workers execution model that W7S apps already target.

It supports the core product promise better than starting with Kubernetes or Firecracker:

- same W7S deploy action;
- same deploy endpoint shape;
- same Worker-style backend model;
- simpler single-server installation;
- no KVM requirement for the first release;
- less tenant-management complexity;
- better path to compatibility before hardening.

Firecracker is valuable, but it solves a different layer: stronger VM isolation. That matters later when an operator wants stricter boundaries between less-trusted repos.

Kubernetes is valuable, but it solves orchestration. That matters later when a single machine is no longer enough.

## Consequences

Positive:

- faster MVP;
- fewer host requirements;
- simpler install story;
- closer Worker compatibility;
- less public-cloud tenant complexity;
- easier reuse of existing W7S app contracts.

Negative:

- weaker isolation than per-app microVMs;
- runtime process supervision must be robust;
- resource controls need careful design;
- Firecracker hardening still needs a future milestone.

## Alternatives Considered

### Firecracker First

Deferred.

Firecracker is attractive for stronger isolation, but it adds image building, KVM requirements, tap networking, guest agents, cold-start tuning, and VM lifecycle complexity before the basic W7S Metal deploy loop exists.

### Kubernetes First

Rejected for the MVP.

Kubernetes would make this feel like an infrastructure platform instead of "W7S Cloud on my Linux server." It also does not directly provide the Worker isolate runtime.

### Raw Node Processes

Rejected for the main runtime.

Raw Node processes are easy to start but move away from the Worker-compatible model. They may be useful for local development, but workerd is the better primary target.

## Follow-Up Work

- prototype a deployed W7S backend inside workerd;
- define generated workerd config shape;
- decide one shared workerd process vs app-group processes;
- map W7S bindings to local workerd services;
- implement logs and health metadata;
- define resource limits for single-tenant operation;
- revisit Firecracker after the deploy loop is working.
