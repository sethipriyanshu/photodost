import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { getWorkspaceForUser, type Workspace } from "./workspaces";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/**
 * Read the current session, or null. Safe to call anywhere on the server.
 */
export async function getSession(): Promise<{ user: SessionUser } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
  };
}

/**
 * Require a signed-in user; redirect to /sign-in otherwise. Returns the user.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}

/**
 * Require a signed-in user *and* a workspace. Redirects to /sign-in if not
 * authenticated, or /onboarding if the user hasn't created a workspace yet.
 * This is the standard guard for every owner-facing page and management API.
 */
export async function requireWorkspace(): Promise<{
  user: SessionUser;
  workspace: Workspace;
}> {
  const user = await requireSession();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/onboarding");
  return { user, workspace };
}

/**
 * API-route variant: never redirects. Returns null when unauthenticated or
 * workspace-less so the route can answer with the right HTTP status.
 */
export async function getSessionWorkspace(): Promise<{
  user: SessionUser;
  workspace: Workspace;
} | null> {
  const session = await getSession();
  if (!session) return null;
  const workspace = await getWorkspaceForUser(session.user.id);
  if (!workspace) return null;
  return { user: session.user, workspace };
}
