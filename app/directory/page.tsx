import Link from "next/link";
import { Users, Building2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DirectoryPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Directory</h1>
        <p className="text-muted-foreground">
          Manage your customers, suppliers, and contracts. Filter by Electric, Natural Gas, or Both.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Link href="/directory/customers">
          <Card className="transition-colors hover:bg-muted/50 cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-6 w-6" />
                Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View and manage customer contacts. Filter by Electric, Natural Gas, or Both.
              </p>
              <Button variant="outline" className="mt-4">
                Manage Customers
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/directory/suppliers">
          <Card className="transition-colors hover:bg-muted/50 cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-6 w-6" />
                Suppliers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View and manage supplier contacts. Filter by Electric, Natural Gas, or Both.
              </p>
              <Button variant="outline" className="mt-4">
                Manage Suppliers
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/directory/contracts">
          <Card className="transition-colors hover:bg-muted/50 cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-6 w-6" />
                Contracts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Manage current and past customer contracts. Track expirations and link to signed documents.
              </p>
              <Button variant="outline" className="mt-4">
                Manage Contracts
              </Button>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
