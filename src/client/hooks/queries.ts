import { useQuery } from "@tanstack/react-query";
import { curriculumStatusResponseSchema, meResponseSchema } from "../../shared/api";
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
