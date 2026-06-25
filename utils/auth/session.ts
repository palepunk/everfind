import type { AuthSession } from './AuthContext';

// FOSS placeholder: cloud builds replace this with Supabase session handling.
// Public builds always behave as signed out.

export function isInvalidRefreshTokenError() {
  return false;
}

export async function safeGetSession(): Promise<AuthSession | null> {
  return null;
}
