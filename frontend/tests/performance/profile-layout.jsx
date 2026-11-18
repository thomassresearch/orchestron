import React from "react";

// Both comparisons use the same fixture, audio client and measurement controls.
export const workspaceProfile = new URLSearchParams(location.search).has("workspace");

export function ProfileLayout({ controls, footer, children }) {
  if (!workspaceProfile) return <main className="p-4">{controls}{children}{footer}</main>;
  return <div data-perform-workspace><div data-app-frame>
    <header>{controls}{footer}</header>
    {children}
  </div></div>;
}
