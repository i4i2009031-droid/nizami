/**
 * Persist only the offline authorization snapshot, never the customer's password.
 * With a configured HTTPS gateway the client stores a license-scoped session ticket.
 * In GitHub-only compatibility mode it stores no ticket (the public registry is checked online).
 * Never persist a password or GitHub personal access token.
 */
export const SESSION_KEY = 'qatfah_session';

export function persistSessionObject(session, storage = globalThis.localStorage) {
  if (!session || !['github', 'demo'].includes(session.mode) ||
      !session.user || typeof session.user.id !== 'string' || !session.user.id ||
      typeof session.user.expiresAt !== 'string' ||
      !Number.isFinite(session.lastChecked)) {
    throw new Error('تعذر حفظ جلسة غير صالحة');
  }
  // Only the tenant identifier, username, expiry and time of last verification.
  // No password or admin GitHub token is saved here.
  const snapshot = {
    mode: session.mode,
    user: {
      id: session.user.id,
      username: session.user.username,
      storeName: session.user.storeName,
      expiresAt: session.user.expiresAt,
    },
    lastChecked: session.lastChecked,
    ...(typeof session.licenseToken==='string'&&session.licenseToken.length<4096?{licenseToken:session.licenseToken}:{}),
  };
  storage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function readSessionObject(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !['github', 'demo'].includes(saved.mode) ||
        typeof saved.user?.id !== 'string' || !saved.user.id ||
        typeof saved.user?.expiresAt !== 'string' ||
        !Number.isFinite(saved.lastChecked)) {
      return null;
    }
    if(saved.licenseToken!==undefined&&(typeof saved.licenseToken!=='string'||saved.licenseToken.length>4096))return null;
    return saved;
  } catch {
    return null; // Corrupt local storage must never crash the login form.
  }
}

export function clearSessionObject(storage = globalThis.localStorage) {
  storage.removeItem(SESSION_KEY);
}
