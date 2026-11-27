import { z } from "zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  colloquialResponseSchema,
  curriculumFacetsResponseSchema,
  curriculumItemDetailResponseSchema,
  curriculumItemsResponseSchema,
  curriculumStatusResponseSchema,
  meResponseSchema,
} from "../../shared/api";
import type { MeResponse } from "../../shared/api";
import type { HskBand, ItemType } from "../../shared/curriculum";
import { settingsResponseSchema, type SettingsUpdate } from "../../shared/settings";
import { sessionStateResponseSchema, type SessionAction, type SessionStateResponse } from "../../shared/debrief";
import { materialsResponseSchema, type MaterialsResponse } from "../../shared/lesson";
import { listeningResponseSchema, type ListeningEvent, type ListeningResponse } from "../../shared/listening";
import { DELETE_ALL_PHRASE, dataSummaryResponseSchema, deletionResponseSchema } from "../../shared/owner-data";
import { progressSummarySchema, type ProgressWindow } from "../../shared/progress";
import { onrampResultSchema, onrampStatusSchema } from "../../shared/onramp";
import { assessmentListResponseSchema, assessmentResponseSchema } from "../../shared/assessment";
import { flagListResponseSchema, flagResponseSchema, taskCheckResponseSchema } from "../../shared/task-check";
import { dueResponseSchema, rateResponseSchema, type ReviewRating } from "../../shared/review";
import { planResponseSchema, sessionListResponseSchema, type PlanRequest } from "../../shared/session";
import { monthlyUsageResponseSchema, turnResponseSchema, type SourceMode } from "../../shared/tutor";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../lib/api";

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
  /** An entry's most advanced state across skills; empty for any. */
  state?: string;
  /** Syllabus section; vocabulary when absent. */
  type?: ItemType;
}

/** Entries of one band, a page at a time; more are fetched only when asked for. */
export function useCurriculumItems(filters: ItemFilters) {
  return useInfiniteQuery({
    queryKey: ["curriculum", "items", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ band: filters.band });
      if (filters.type && filters.type !== "vocab") params.set("type", filters.type);
      if (filters.pos) params.set("pos", filters.pos);
      if (filters.q) params.set("q", filters.q);
      if (filters.state) params.set("state", filters.state);
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

export interface ColloquialFilters {
  q: string;
  register: string;
  channel: string;
  status: string;
}

/** Colloquial expressions, a page at a time. A separate track from the HSK syllabus. */
export function useColloquial(filters: ColloquialFilters) {
  return useInfiniteQuery({
    queryKey: ["colloquial", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.register) params.set("register", filters.register);
      if (filters.channel) params.set("channel", filters.channel);
      if (filters.status) params.set("status", filters.status);
      if (filters.q) params.set("q", filters.q);
      if (pageParam) params.set("cursor", pageParam);
      const query = params.toString();
      return apiGet(query ? `/colloquial?${query}` : "/colloquial", colloquialResponseSchema);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Saves preferences. Never retried automatically: the owner sees the error and decides. */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => apiPut("/settings", patch, settingsResponseSchema),
    onSuccess: ({ settings }) => {
      client.setQueryData<MeResponse>(["me"], (me) => (me ? { ...me, settings } : me));
      // The spending display compares against the amounts just saved.
      void client.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

/** This month's estimated spending. An estimate, not a provider bill. */
export function useMonthlyUsage() {
  return useQuery({
    queryKey: ["usage", "monthly"],
    queryFn: () => apiGet("/usage/monthly", monthlyUsageResponseSchema),
    retry: false,
  });
}

/** Recent sessions and today's unfinished one. */
export function useSessions() {
  return useQuery({
    queryKey: ["sessions", "list"],
    queryFn: () => apiGet("/sessions?limit=5", sessionListResponseSchema),
  });
}

const sessionKey = (id: string) => ["sessions", "detail", id] as const;

/** One session with its plan, its saved turns and, once complete, its summary. */
export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKey(id),
    queryFn: () => apiGet(`/sessions/${encodeURIComponent(id)}`, sessionStateResponseSchema),
  });
}

export interface OutgoingTurn {
  /** Made once per message and reused on every retry, so the message is saved once. */
  clientTurnId: string;
  transcript: string;
  /** `speech` when the words came from speech recognition, even if checked or corrected by hand. */
  sourceMode?: SourceMode;
  /** Speech recognition was unsure of what it heard. */
  asrUncertain?: boolean;
}

/** Sends a typed message to the tutor. Never retried automatically: the learner decides. */
export function useSendTurn(sessionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (turn: OutgoingTurn) =>
      apiPost(
        `/sessions/${encodeURIComponent(sessionId)}/turn`,
        {
          clientTurnId: turn.clientTurnId,
          transcript: turn.transcript,
          sourceMode: turn.sourceMode ?? "typed",
          asrUncertain: turn.sourceMode === "speech" ? (turn.asrUncertain ?? false) : false,
        },
        turnResponseSchema,
      ),
    onSuccess: (result) => {
      client.setQueryData<SessionStateResponse>(sessionKey(sessionId), (state) => {
        if (!state) return state;
        const known = state.turns.some((t) => t.turnId === result.turn.turnId);
        return {
          ...state,
          session: { ...state.session, status: result.sessionStatus },
          turns: known ? state.turns : [...state.turns, result.turn],
        };
      });
      void client.invalidateQueries({ queryKey: ["sessions", "list"] });
      void client.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

/** Keeps the session's cached listening exercise in step with the server's answer. */
function useStoreListening(sessionId: string) {
  const client = useQueryClient();
  return (result: ListeningResponse) =>
    client.setQueryData<SessionStateResponse>(sessionKey(sessionId), (state) => (state ? { ...state, listening: result.exercise } : state));
}

/** Writes the session's listen-first exercise, or fetches the one it has. Starting it starts the session. */
export function useCreateListening(sessionId: string) {
  const client = useQueryClient();
  const store = useStoreListening(sessionId);
  return useMutation({
    mutationFn: () => apiPost(`/sessions/${encodeURIComponent(sessionId)}/listening`, {}, listeningResponseSchema),
    onSuccess: (result) => {
      store(result);
      void client.invalidateQueries({ queryKey: sessionKey(sessionId) });
      void client.invalidateQueries({ queryKey: ["sessions", "list"] });
      void client.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

/** Records the first play or the first reveal of the text. */
export function useListeningEvent(sessionId: string) {
  const store = useStoreListening(sessionId);
  return useMutation({
    mutationFn: (event: ListeningEvent) =>
      apiPost(`/sessions/${encodeURIComponent(sessionId)}/listening/events`, { event }, listeningResponseSchema),
    onSuccess: store,
  });
}

/** Sends the answers to the comprehension questions. The first answers sent are kept. */
export function useAnswerListening(sessionId: string) {
  const store = useStoreListening(sessionId);
  return useMutation({
    mutationFn: (answers: number[]) =>
      apiPost(`/sessions/${encodeURIComponent(sessionId)}/listening/answers`, { answers }, listeningResponseSchema),
    onSuccess: store,
  });
}

/** Pauses, resumes or abandons a session. */
export function useSessionAction(sessionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: SessionAction) =>
      apiPatch(`/sessions/${encodeURIComponent(sessionId)}`, { action }, sessionStateResponseSchema),
    onSuccess: (state) => {
      client.setQueryData(sessionKey(sessionId), state);
      void client.invalidateQueries({ queryKey: ["sessions", "list"] });
    },
  });
}

/** Finishes a session. Safe to repeat: the server returns the same summary. */
export function useCompleteSession(sessionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/sessions/${encodeURIComponent(sessionId)}/complete`, {}, sessionStateResponseSchema),
    onSuccess: (state) => {
      client.setQueryData(sessionKey(sessionId), state);
      void client.invalidateQueries({ queryKey: ["sessions", "list"] });
      // New review cards, and new practice to count.
      void client.invalidateQueries({ queryKey: ["reviews"] });
      void client.invalidateQueries({ queryKey: ["progress"] });
      void client.invalidateQueries({ queryKey: ["curriculum"] });
    },
  });
}

/** Plans today's session. Asking twice returns the same unfinished session. */
export function usePlanSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PlanRequest) => apiPost("/sessions/plan", request, planResponseSchema),
    onSuccess: ({ session }) => {
      client.setQueryData<SessionStateResponse>(sessionKey(session.id), { session, turns: [], debrief: null, listening: null, materials: null, glosses: {} });
      void client.invalidateQueries({ queryKey: ["sessions", "list"] });
    },
  });
}

const dueKey = ["reviews", "due"] as const;

/** Cards due now. Fetched on demand; nothing polls in the background. */
export function useDueReviews() {
  return useQuery({ queryKey: dueKey, queryFn: () => apiGet("/reviews/due?limit=20", dueResponseSchema) });
}

export interface OutgoingRating {
  cardId: string;
  rating: ReviewRating;
  /** Made once per rating and reused on a retry, so it is recorded once. */
  clientEventId: string;
  /** What was typed on a writing card. */
  answer?: string;
}

export function useRateCard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (r: OutgoingRating) =>
      apiPost(`/reviews/${encodeURIComponent(r.cardId)}/rate`, { rating: r.rating, clientEventId: r.clientEventId, ...(r.answer ? { answer: r.answer } : {}) }, rateResponseSchema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: dueKey });
      void client.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

/** The progress summary for a window of days. Fetched when a page needs it; nothing polls. */
export function useProgressSummary(days: ProgressWindow) {
  return useQuery({
    queryKey: ["progress", days],
    queryFn: () => apiGet(`/progress/summary?days=${days}`, progressSummarySchema),
  });
}

/** What is stored, and whether retention has removed any conversation text. */
export function useDataSummary() {
  return useQuery({ queryKey: ["my-data"], queryFn: () => apiGet("/my-data", dataSummaryResponseSchema) });
}

/** Everything a deletion can change in the browser's copy is fetched again. */
function useForgetCachedData() {
  const client = useQueryClient();
  return () => {
    for (const key of [["sessions"], ["reviews"], ["progress"], ["curriculum"], ["my-data"], ["me"], ["usage"]]) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
}

export function useDeleteSession(sessionId: string) {
  const forget = useForgetCachedData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/sessions/${encodeURIComponent(sessionId)}`, undefined, deletionResponseSchema),
    onSuccess: () => {
      client.removeQueries({ queryKey: sessionKey(sessionId) });
      forget();
    },
  });
}

export function useDeleteAllData() {
  const forget = useForgetCachedData();
  return useMutation({
    mutationFn: () => apiDelete("/my-data", { confirm: DELETE_ALL_PHRASE }, deletionResponseSchema),
    onSuccess: forget,
  });
}

// --- Reading, guided practice and writing (SPEC §5.3) ----------------------------

function useStoreMaterials(sessionId: string) {
  const client = useQueryClient();
  return (result: MaterialsResponse) =>
    client.setQueryData<SessionStateResponse>(sessionKey(sessionId), (state) => (state ? { ...state, materials: result.materials } : state));
}

/** Writes the session's reading, practice and writing, or fetches what it has. */
export function useCreateMaterials(sessionId: string) {
  const client = useQueryClient();
  const store = useStoreMaterials(sessionId);
  return useMutation({
    mutationFn: () => apiPost(`/sessions/${encodeURIComponent(sessionId)}/materials`, {}, materialsResponseSchema),
    onSuccess: (result) => {
      store(result);
      void client.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export function useAnswerReading(sessionId: string) {
  const store = useStoreMaterials(sessionId);
  return useMutation({
    mutationFn: (answers: number[]) => apiPost(`/sessions/${encodeURIComponent(sessionId)}/materials/reading/answers`, { answers }, materialsResponseSchema),
    onSuccess: store,
  });
}

export function useRevealReading(sessionId: string) {
  const store = useStoreMaterials(sessionId);
  return useMutation({
    mutationFn: () => apiPost(`/sessions/${encodeURIComponent(sessionId)}/materials/reading/reveal`, {}, materialsResponseSchema),
    onSuccess: store,
  });
}

export function useAnswerPractice(sessionId: string) {
  const store = useStoreMaterials(sessionId);
  return useMutation({
    mutationFn: (body: { index: number; answer: string; mode: "spoken" | "typed" }) =>
      apiPost(`/sessions/${encodeURIComponent(sessionId)}/materials/practice`, body, materialsResponseSchema),
    onSuccess: store,
  });
}

export function useAnswerWriting(sessionId: string) {
  const store = useStoreMaterials(sessionId);
  return useMutation({
    mutationFn: (answer: string) => apiPost(`/sessions/${encodeURIComponent(sessionId)}/materials/writing`, { answer }, materialsResponseSchema),
    onSuccess: store,
  });
}

// --- Task check and flags (SPEC §6.1, §2.5 rule 8) ---------------------------------

export function useTaskCheck(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["sessions", sessionId, "task-check"],
    queryFn: () => apiGet(`/sessions/${encodeURIComponent(sessionId)}/task-check`, taskCheckResponseSchema),
    enabled,
  });
}

export function useRunTaskCheck(sessionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/sessions/${encodeURIComponent(sessionId)}/task-check`, {}, taskCheckResponseSchema),
    onSuccess: (result) => {
      client.setQueryData(["sessions", sessionId, "task-check"], result);
      void client.invalidateQueries({ queryKey: ["usage"] });
      void client.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

export function useFlags() {
  return useQuery({ queryKey: ["curriculum", "flags"], queryFn: () => apiGet("/curriculum/flags", flagListResponseSchema) });
}

export function useFlagItem(itemId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (flag: { on: true; note: string } | { on: false }) =>
      flag.on
        ? apiPost(`/curriculum/items/${encodeURIComponent(itemId)}/flag`, flag.note ? { note: flag.note } : {}, flagResponseSchema)
        : apiDelete(`/curriculum/items/${encodeURIComponent(itemId)}/flag`, undefined, flagResponseSchema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["curriculum"] });
    },
  });
}

// --- Tests (SPEC §6.5) --------------------------------------------------------------

export function useAssessments() {
  return useQuery({ queryKey: ["tests", "list"], queryFn: () => apiGet("/tests", assessmentListResponseSchema) });
}

export function useAssessment(id: string) {
  return useQuery({ queryKey: ["tests", id], queryFn: () => apiGet(`/tests/${encodeURIComponent(id)}`, assessmentResponseSchema) });
}

export function useStartAssessment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { band: HskBand; kind: "band_test" | "checkpoint" }) => apiPost("/tests", body, assessmentResponseSchema),
    onSuccess: (result) => {
      client.setQueryData(["tests", result.assessment.id], result);
      void client.invalidateQueries({ queryKey: ["tests", "list"] });
    },
  });
}

export function useFinishAssessment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { answers: (number | string | null)[]; spoken: boolean[] }) =>
      apiPost(`/tests/${encodeURIComponent(id)}/answers`, body, assessmentResponseSchema),
    onSuccess: (result) => {
      client.setQueryData(["tests", id], result);
      void client.invalidateQueries({ queryKey: ["tests", "list"] });
      void client.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

// --- Sound-system on-ramp (SPEC §5.9) ------------------------------------------------

const onrampAnswerResponseSchema = z.object({ result: onrampResultSchema });

export function useOnramp() {
  return useQuery({ queryKey: ["onramp"], queryFn: () => apiGet("/onramp", onrampStatusSchema) });
}

export function useAnswerUnit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { unitId: string; answers: (number | string | null)[] }) => apiPost("/onramp/answers", body, onrampAnswerResponseSchema),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["onramp"] }),
  });
}
