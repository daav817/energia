export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-[#f8f9fa] text-[#202124]">
      {children}
    </div>
  );
}
