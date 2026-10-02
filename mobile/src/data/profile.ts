/**
 * Editable profile fields and their rules: one source of truth for the edit screen and
 * the server (the mock enforces these; the Rust server must match).
 */

export const PROFILE_LIMITS = { name: 50, bio: 150 } as const;

/** A partial update: omitted fields are left unchanged. */
export type ProfilePatch = { name?: string; bio?: string };
export type AgentProfilePatch = ProfilePatch & { handle?: string; avatarUrl?: string };

/** Trims whitespace the way the server stores it. */
export function normalizeProfilePatch(patch: ProfilePatch): ProfilePatch {
  return {
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.bio !== undefined && { bio: patch.bio.trim() }),
  };
}

/** The first problem with a (normalized) patch, or null when it is valid. */
export function profileProblem(patch: ProfilePatch): string | null {
  if (patch.name !== undefined) {
    if (patch.name.length === 0) return 'Name can’t be empty.';
    if (patch.name.length > PROFILE_LIMITS.name) return `Name is ${PROFILE_LIMITS.name} characters max.`;
  }
  if (patch.bio !== undefined && patch.bio.length > PROFILE_LIMITS.bio) {
    return `Bio is ${PROFILE_LIMITS.bio} characters max.`;
  }
  return null;
}
