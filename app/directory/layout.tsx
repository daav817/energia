export default function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto bg-background">
      <div className="container max-w-[100%] flex-1 py-6 px-4">{children}</div>
    </div>
  );
}
