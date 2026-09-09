import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchInterval: 45_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
