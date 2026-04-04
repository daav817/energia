export default function CommunicationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background comms-inbox text-foreground">
      <div className="flex flex-1 min-h-0 w-full max-w-none flex-col overflow-hidden px-4 py-4">
        {children}
      </div>
    </div>
  );
}
