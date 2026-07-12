export type HubId = "stock" | "finance" | "auction";

const STORAGE_PREFIX = "stockmind-hub-last:";

const DEFAULT_PATHS: Record<HubId, string> = {
  stock: "/",
  finance: "/finance",
  auction: "/auction",
};

export function hubFromPathname(pathname: string): HubId {
  if (pathname === "/finance" || pathname.startsWith("/finance/")) return "finance";
  if (pathname === "/auction" || pathname.startsWith("/auction/")) return "auction";
  return "stock";
}

export function defaultHubPath(hub: HubId): string {
  return DEFAULT_PATHS[hub];
}

function pathnameOf(path: string): string {
  return path.split("?")[0]?.split("#")[0] ?? path;
}

export function isValidHubPath(hub: HubId, path: string): boolean {
  const p = pathnameOf(path);
  switch (hub) {
    case "finance":
      return p === "/finance" || p.startsWith("/finance/");
    case "auction":
      return p === "/auction" || p.startsWith("/auction/");
    case "stock":
      return !p.startsWith("/finance") && !p.startsWith("/auction");
  }
}

export function readHubPath(hub: HubId): string {
  if (typeof window === "undefined") return defaultHubPath(hub);
  try {
    const saved = sessionStorage.getItem(STORAGE_PREFIX + hub);
    if (saved && isValidHubPath(hub, saved)) return saved;
  } catch {
    /* ignore */
  }
  return defaultHubPath(hub);
}

export function readHubPaths(): Record<HubId, string> {
  return {
    stock: readHubPath("stock"),
    finance: readHubPath("finance"),
    auction: readHubPath("auction"),
  };
}

export function saveHubPath(hub: HubId, path: string): void {
  if (typeof window === "undefined") return;
  if (!isValidHubPath(hub, path)) return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + hub, path);
  } catch {
    /* ignore */
  }
}

export function initialHubPaths(): Record<HubId, string> {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PATHS };
  }
  return readHubPaths();
}
