import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { ApiRequestError } from "../lib/api";
import { CurriculumItemPage } from "../pages/CurriculumItemPage";
import { CurriculumPage } from "../pages/CurriculumPage";
import { DashboardPage } from "../pages/DashboardPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { ProgressPage } from "../pages/ProgressPage";
import { ReviewPage } from "../pages/ReviewPage";
import { SessionPage } from "../pages/SessionPage";
import { SettingsPage } from "../pages/SettingsPage";
import { AppLayout } from "./AppLayout";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // No background polling (cost control); data refreshes on navigation or user action.
        refetchInterval: false,
        refetchOnWindowFocus: false,
        // At most two retries, and only for failures that can succeed on retry (SPEC §9.1).
        retry: (failureCount, error) =>
          failureCount < 2 && (!(error instanceof ApiRequestError) || error.retryable),
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="session/:sessionId" element={<SessionPage />} />
        <Route path="curriculum" element={<CurriculumPage />} />
        <Route path="curriculum/:band" element={<CurriculumPage />} />
        <Route path="curriculum/item/:itemId" element={<CurriculumItemPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
