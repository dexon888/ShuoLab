import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  curriculumFacetsResponseSchema,
  curriculumItemDetailResponseSchema,
  curriculumItemsResponseSchema,
  curriculumStatusResponseSchema,
  meResponseSchema,
} from "../../shared/api";
import type { HskBand } from "../../shared/curriculum";
import { apiGet } from "../lib/api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiGet("/me", meResponseSchema) });
}

export function useCurriculumStatus() {
  return useQuery({
    queryKey: ["curriculum", "status"],
    queryFn: () => apiGet("/curriculum/status", curriculumStatusResponseSchema),
  });
}

export interface ItemFilters {
  band: HskBand;
  pos: string;
  q: string;
}

/** Entries of one band, a page at a time; more are fetched only when asked for. */
export function useCurriculumItems(filters: ItemFilters) {
  return useInfiniteQuery({
    queryKey: ["curriculum", "items", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ band: filters.band });
      if (filters.pos) params.set("pos", filters.pos);
      if (filters.q) params.set("q", filters.q);
      if (pageParam) params.set("cursor", pageParam);
      return apiGet(`/curriculum/items?${params.toString()}`, curriculumItemsResponseSchema);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useCurriculumFacets(band: HskBand) {
  return useQuery({
    queryKey: ["curriculum", "facets", band],
    queryFn: () =>
      apiGet(`/curriculum/facets?band=${encodeURIComponent(band)}`, curriculumFacetsResponseSchema),
    // Reference data: it only changes when the curriculum is re-imported.
    staleTime: 10 * 60_000,
  });
}

export function useCurriculumItem(id: string) {
  return useQuery({
    queryKey: ["curriculum", "item", id],
    queryFn: () =>
      apiGet(`/curriculum/items/${encodeURIComponent(id)}`, curriculumItemDetailResponseSchema),
  });
}
