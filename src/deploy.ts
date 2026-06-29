import type { IncomingMessage } from "node:http";
import { readDeployArchive } from "./archive.js";
import { detectStaticRoot, detectWorkerEntrypoint } from "./detectors.js";
import { parseBearerToken } from "./http.js";
import { readAppManifest, readCustomDomains } from "./manifest.js";
import { parseRepository, publicDeploymentUrl, resolveEnvironment } from "./names.js";
import {
  writeDeploymentRecord,
  writeStaticFiles,
  writeWorkerBundle,
  type DeploymentRecord,
  type Store
} from "./storage.js";
import { writeWorkerdPlan } from "./workerd.js";
import type { MetalConfig } from "./config.js";

export type DeployInput = {
  request: IncomingMessage;
  body: Buffer;
  url: URL;
  config: MetalConfig;
  store: Store;
};

const header = (request: IncomingMessage, name: string) => {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0]?.trim() ?? "" : value?.trim() ?? "";
};

const isZipRequest = (request: IncomingMessage) => {
  const contentType = header(request, "content-type").toLowerCase();
  return contentType.includes("application/zip") || contentType.includes("application/octet-stream");
};

const deploymentId = (record: Pick<DeploymentRecord, "ownerSlug" | "repoSlug" | "environment" | "commitSha">) =>
  `${record.ownerSlug}/${record.repoSlug}/${record.environment}/${record.commitSha}`;

export const handleDeployRequest = async ({ request, body, url, config, store }: DeployInput) => {
  const token = parseBearerToken(header(request, "authorization"));
  if (config.deployToken && token !== config.deployToken) {
    return {
      statusCode: 401,
      body: {
        status: "error",
        error: "Bearer token is not authorized for this W7S Metal endpoint."
      }
    };
  }

  if (!isZipRequest(request)) {
    return {
      statusCode: 415,
      body: {
        status: "error",
        error: "Deploy body must be an application/zip archive."
      }
    };
  }

  const repositoryHeader = header(request, "x-github-repository");
  const commitSha = header(request, "x-github-sha");
  const branch = header(request, "x-github-branch");
  if (!repositoryHeader || !commitSha || !branch) {
    return {
      statusCode: 400,
      body: {
        status: "error",
        error: "Missing x-github-repository, x-github-sha, or x-github-branch header."
      }
    };
  }

  const repository = parseRepository(repositoryHeader);
  if (!repository) {
    return {
      statusCode: 400,
      body: {
        status: "error",
        error: "x-github-repository must be in owner/repo form."
      }
    };
  }

  const environment = resolveEnvironment(branch, url.searchParams.get("environment") || header(request, "x-w7s-environment"));
  const archive = readDeployArchive(body);
  const manifest = readAppManifest(archive);
  const customDomains = readCustomDomains(archive);
  const staticRoot = detectStaticRoot(archive);
  const workerEntrypoint = detectWorkerEntrypoint(archive);

  if (!staticRoot && !workerEntrypoint) {
    return {
      statusCode: 400,
      body: {
        status: "error",
        error: "Archive must contain static frontend output or worker/backend entrypoint."
      }
    };
  }

  const deployedAt = new Date().toISOString();
  const record: DeploymentRecord = {
    id: deploymentId({
      ownerSlug: repository.ownerSlug,
      repoSlug: repository.repoSlug,
      environment,
      commitSha
    }),
    repository: repository.fullName,
    owner: repository.owner,
    repo: repository.repo,
    ownerSlug: repository.ownerSlug,
    repoSlug: repository.repoSlug,
    branch,
    environment,
    commitSha,
    deployedAt,
    url: publicDeploymentUrl({
      baseDomain: config.baseDomain,
      ownerSlug: repository.ownerSlug,
      repoSlug: repository.repoSlug,
      environment,
      publicUrl: config.publicUrl
    }),
    staticRoot,
    staticFileCount: 0,
    workerEntrypoint,
    customDomains,
    manifest
  };

  if (staticRoot) {
    record.staticFileCount = await writeStaticFiles(store, record, archive, staticRoot);
  }
  if (workerEntrypoint) {
    await writeWorkerBundle(store, record, archive, workerEntrypoint);
  }

  await writeDeploymentRecord(store, record);
  const workerd = await writeWorkerdPlan(store, record);

  return {
    statusCode: 200,
    body: {
      status: "success",
      data: {
        url: record.url,
        deployment: {
          id: record.id,
          repository: record.repository,
          branch: record.branch,
          environment: record.environment,
          commitSha: record.commitSha,
          deployedAt: record.deployedAt,
          targets: {
            static: record.staticRoot
              ? {
                  root: record.staticRoot,
                  fileCount: record.staticFileCount
                }
              : null,
            worker: record.workerEntrypoint
              ? {
                  entrypoint: record.workerEntrypoint,
                  runtime: "workerd",
                  status: "planned"
                }
              : null
          },
          bindings: {
            kv: Array.isArray(record.manifest.bindings?.kv) ? record.manifest.bindings.kv : [],
            r2: Array.isArray(record.manifest.bindings?.r2) ? record.manifest.bindings.r2 : [],
            d1: Array.isArray(record.manifest.bindings?.d1) ? record.manifest.bindings.d1 : [],
            vars: record.manifest.vars ?? [],
            secrets: record.manifest.secrets ?? []
          }
        },
        deploymentWarnings: workerd.enabled
          ? [
              {
                code: "workerd_runtime_planned",
                message: workerd.message
              }
            ]
          : [],
        customDomains,
        customDomainWarnings: customDomains.map((hostname) => ({
          hostname,
          txtName: `_w7s.${hostname}`,
          txtValue: record.repository
        })),
        blockedCustomDomains: []
      }
    }
  };
};
