export const sanitizePart = (value: string) => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
  return sanitized || "unknown";
};

export const parseRepository = (value: string) => {
  const [owner, repo, ...rest] = value.trim().split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    ownerSlug: sanitizePart(owner),
    repoSlug: sanitizePart(repo)
  };
};

export const resolveEnvironment = (branch: string, override?: string | null) => {
  const value = override?.trim();
  if (value) return sanitizePart(value);
  const normalized = branch.trim();
  return normalized === "main" || normalized === "master" ? "production" : sanitizePart(normalized);
};

export const hostForDeployment = (params: {
  baseDomain: string;
  ownerSlug: string;
  environment: string;
}) => {
  const base = params.baseDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return params.environment === "production"
    ? `${params.ownerSlug}.${base}`
    : `${sanitizePart(params.environment)}--${params.ownerSlug}.${base}`;
};

export const publicDeploymentUrl = (params: {
  baseDomain: string;
  ownerSlug: string;
  repoSlug: string;
  environment: string;
  appProtocol?: "http" | "https";
}) => {
  const host = hostForDeployment(params);
  const protocol = params.appProtocol || "https";
  const path = params.repoSlug === params.ownerSlug ? "/" : `/${params.repoSlug}/`;
  return `${protocol}://${host}${path}`;
};
