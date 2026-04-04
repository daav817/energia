import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NewsPage() {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Industry news</h1>
      <p className="text-muted-foreground text-sm mb-6">
        This page will host energy brokerage and macro-economic feeds. Wire your preferred RSS or news APIs
        here.
      </p>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
