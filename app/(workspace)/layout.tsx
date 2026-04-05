export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="comms-inbox flex min-h-0 min-w-0 flex-1 flex-col bg-background px-4 py-4 text-foreground overflow-y-auto">
      {children}
    </div>
  );
}
