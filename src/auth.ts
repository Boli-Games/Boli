import { Clerk } from "@clerk/clerk-js";
import {
  loadLocalProfile,
  mergeProfiles,
  saveLocalProfile,
  sanitizeProfile,
  type ProfileData,
} from "./profile";

let clerk: Clerk | null = null;
let profile: ProfileData = loadLocalProfile();
const listeners = new Set<() => void>();

export async function initAuth(): Promise<void> {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!key) {
    return;
  }
  try {
    clerk = new Clerk(key);
    await clerk.load();
  } catch {
    clerk = null;
    return;
  }
  clerk.addListener((resources) => {
    const user = resources.user;
    if (user) {
      const remote = metadataProfile(user.unsafeMetadata);
      profile = mergeProfiles(loadLocalProfile(), remote ?? profile);
      saveLocalProfile(profile);
      void persistRemote();
    }
    emit();
  });
  if (clerk.user) {
    const remote = metadataProfile(clerk.user.unsafeMetadata);
    if (remote) {
      profile = mergeProfiles(profile, remote);
      saveLocalProfile(profile);
    }
  }
}

export function getProfile(): ProfileData {
  return profile;
}

export function setProfile(next: ProfileData): void {
  profile = sanitizeProfile(next);
  saveLocalProfile(profile);
  void persistRemote();
  emit();
}

export function patchProfile(partial: Partial<ProfileData>): void {
  setProfile({ ...profile, ...partial });
}

export function isSignedIn(): boolean {
  return Boolean(clerk?.user);
}

export function authAvailable(): boolean {
  return Boolean(clerk);
}

export function openSignIn(): void {
  clerk?.openSignIn();
}

export async function signOut(): Promise<void> {
  await clerk?.signOut();
  emit();
}

export function onProfileChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function metadataProfile(meta: Record<string, unknown> | undefined): ProfileData | null {
  const raw = meta?.boli;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return sanitizeProfile(raw as Partial<ProfileData>);
}

async function persistRemote(): Promise<void> {
  const user = clerk?.user;
  if (!user) {
    return;
  }
  try {
    await user.update({
      unsafeMetadata: {
        ...user.unsafeMetadata,
        boli: profile,
      },
    });
  } catch {
    /* ignore */
  }
}
