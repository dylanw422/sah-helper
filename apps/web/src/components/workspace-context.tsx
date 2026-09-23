"use client";
import { createContext, useContext } from "react";

export const WorkspaceContext = createContext<string | null>(null);
export function useWorkspaceId() {
  const id = useContext(WorkspaceContext);
  if (!id) throw new Error("Workspace is not ready");
  return id;
}
