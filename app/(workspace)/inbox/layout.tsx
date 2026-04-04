export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mr-[min(0,calc(-50vw+50%))]">
      {children}
    </div>
  );
}
