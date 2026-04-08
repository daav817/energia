"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

type BlockPayload = { message: string; onConfirmLeave?: () => void };

const UnsavedNavContext = createContext<{
  setBlock: (payload: BlockPayload | null) => void;
} | null>(null);

/** Register in-page unsaved work; internal `<a>` navigations will confirm before leaving. */
export function useUnsavedNavigationBlock(
  active: boolean,
  message?: string,
  onConfirmLeave?: () => void
) {
  const ctx = useContext(UnsavedNavContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setBlock(
      active
        ? {
            message:
              message ??
              "You have unsaved changes. Leave this page without saving?",
            onConfirmLeave,
          }
        : null
    );
    return () => ctx.setBlock(null);
  }, [active, message, onConfirmLeave, ctx]);
}

export function UnsavedNavigationProvider({ children }: { children: React.ReactNode }) {
  const blockRef = useRef<BlockPayload | null>(null);

  const setBlock = useCallback((payload: BlockPayload | null) => {
    blockRef.current = payload;
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const b = blockRef.current;
      if (!b) return;
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const a = el.closest("a[href]");
      if (!a) return;
      if (a.getAttribute("target") === "_blank") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash
      ) {
        return;
      }

      if (!window.confirm(b.message)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        b.onConfirmLeave?.();
      }
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  const value = useMemo(() => ({ setBlock }), [setBlock]);

  return <UnsavedNavContext.Provider value={value}>{children}</UnsavedNavContext.Provider>;
}
