import { z } from "zod";
import type { ItemType } from "./curriculum";

/**
 * Details stored with grammar, character, topic and task items (sections-v1,
 * DECISIONS 94). They come from a second-hand transcription and are shown as
 * not verified.
 */
export const itemDetailsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("grammar"),
    grammarType: z.string(),
    category: z.string().nullable(),
    detail: z.string().nullable(),
    examples: z.array(z.string()),
  }),
  z.object({ kind: z.literal("character"), skill: z.enum(["recognition", "writing"]) }),
  z.object({ kind: z.literal("topic"), area: z.string(), subject: z.string(), details: z.string() }),
  z.object({ kind: z.literal("task"), task: z.string(), canDo: z.string() }),
]);
export type ItemDetails = z.infer<typeof itemDetailsSchema>;

/** Reads `metadata_json` for a section item; null for vocabulary or anything malformed. */
export function parseItemDetails(itemType: ItemType, metadataJson: string | null): ItemDetails | null {
  if (itemType === "vocab" || !metadataJson) return null;
  try {
    const parsed = itemDetailsSchema.safeParse({ ...JSON.parse(metadataJson), kind: itemType });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One short line describing an item in a list. */
export function itemNote(details: ItemDetails | null): string | null {
  if (!details) return null;
  switch (details.kind) {
    case "grammar":
      return [details.grammarType, details.category].filter(Boolean).join(" · ");
    case "character":
      return details.skill === "writing" ? "To write" : "To recognise";
    case "topic":
      return `${details.area} · ${details.subject}`;
    case "task":
      return details.canDo;
  }
}

export const SECTION_NAMES: Readonly<Record<ItemType, { one: string; many: string; zh: string }>> = {
  vocab: { one: "word", many: "Vocabulary", zh: "词汇" },
  grammar: { one: "grammar point", many: "Grammar", zh: "语法" },
  character: { one: "character", many: "Characters", zh: "汉字" },
  topic: { one: "topic", many: "Topics", zh: "话题" },
  task: { one: "task", many: "Tasks", zh: "任务" },
};
