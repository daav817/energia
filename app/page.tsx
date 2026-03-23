import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Users, Building2 } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-primary mb-4">
        Energia Power LLC
      </h1>
      <p className="text-muted-foreground text-center max-w-md mb-8">
        CRM & Brokerage Management System
      </p>
      <div className="flex gap-4">
        <Button asChild>
          <Link href="/directory" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Directory
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/communications" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Communications
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mt-8">
        Run <code className="bg-muted px-2 py-1 rounded">docker compose up</code> to start.
      </p>
    </main>
  );
}
