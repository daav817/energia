import Link from "next/link";
import { Button } from "@/components/ui/button";

const FEEDS = [
  { label: "EIA - Today in Energy", href: "https://www.eia.gov/todayinenergy/" },
  { label: "FERC news", href: "https://www.ferc.gov/news-events/news" },
  { label: "NERC announcements", href: "https://www.nerc.com/news/Pages/default.aspx" },
] as const;

export default function NewsPage() {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Industry news</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Quick links for energy markets, compliance, and macro context. Wire RSS or other feeds here when you
        want headlines inside the app.
      </p>
      <ul className="space-y-2 text-sm mb-8">
        {FEEDS.map((f) => (
          <li key={f.href}>
            <a href={f.href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
              {f.label}
            </a>
          </li>
        ))}
      </ul>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
