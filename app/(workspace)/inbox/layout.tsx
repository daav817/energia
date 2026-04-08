export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mr-[min(0,calc(-50vw+50%))] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
