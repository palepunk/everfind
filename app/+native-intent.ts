const splitSegments = (value: string) =>
  value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

const normalizeInvitePath = (path: string | null): string | null => {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    const [first] = splitSegments(trimmed);
    if (first === 'invite') {
      return trimmed;
    }
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const [firstPath] = splitSegments(parsed.pathname);

    if (protocol === 'https:' || protocol === 'http:') {
      if (parsed.hostname === 'everfind.online' && firstPath === 'invite') {
        return `/invite${parsed.search || ''}`;
      }
      return null;
    }

    if (protocol.startsWith('everfind')) {
      if (firstPath === 'invite') {
        return `/invite${parsed.search || ''}`;
      }
      if (parsed.host === 'invite') {
        const search = parsed.search || '';
        return `/invite${search}`;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const parseSpotlightItemId = (path: string | null): string | null => {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    const [first, second] = splitSegments(trimmed);
    if (first === 'items' && second) return decodeURIComponent(second);
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol.toLowerCase().startsWith('everfind')) {
      return null;
    }

    const [firstPath, secondPath] = splitSegments(parsed.pathname);
    if (firstPath === 'items' && secondPath) {
      return decodeURIComponent(secondPath);
    }

    if (parsed.host === 'items') {
      const [firstHostPath] = splitSegments(parsed.pathname);
      if (firstHostPath) return decodeURIComponent(firstHostPath);
    }
  } catch {
    const [first, second] = splitSegments(trimmed);
    if (first === 'items' && second) return decodeURIComponent(second);
  }

  return null;
};

export function redirectSystemPath({ path }: { path: string | null; initial: boolean }) {
  const invitePath = normalizeInvitePath(path);
  if (invitePath) return invitePath;
  const itemId = parseSpotlightItemId(path);
  if (!itemId) return path ?? '/';
  return `/items/${encodeURIComponent(itemId)}?entry=direct&deepLinkSource=spotlight`;
}
