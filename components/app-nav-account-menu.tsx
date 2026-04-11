"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { loadBrokerProfile } from "@/lib/broker-profile";
import { googleOAuthConnectUrl } from "@/lib/google-connect";

export function AppNavAccountMenu() {
  const [googleHref, setGoogleHref] = useState("/api/gmail/connect");

  useEffect(() => {
    const p = loadBrokerProfile();
    setGoogleHref(googleOAuthConnectUrl(p.email));
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          aria-label="Account and Google connections"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          Account
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-1rem))]">
        <DropdownMenuItem asChild>
          <a href={googleHref} className="no-underline">
            Reconnect Google…
          </a>
        </DropdownMenuItem>
        <p className="px-2 py-2 text-[10px] leading-snug text-muted-foreground">
          Sign in again after Gmail or Drive permission errors (for example sharing RFP attachments). Uses your broker
          profile email as a hint when set.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/mail" className="no-underline">
            Communications &amp; OAuth setup
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
