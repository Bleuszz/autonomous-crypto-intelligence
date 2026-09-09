import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { makeQueryClient } from "@/lib/query";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#16161a",
            border: "1px solid rgb(244 244 245 / 0.12)",
            color: "#f4f4f5",
          },
        }}
      />
    </QueryClientProvider>
  );
}
