import { WorkspaceLayoutShell } from "@/components/workspace-layout-shell";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceLayoutShell>{children}</WorkspaceLayoutShell>;
}
