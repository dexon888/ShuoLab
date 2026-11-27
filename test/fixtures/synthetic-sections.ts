/**
 * Generated placeholder grammar, characters, topics and tasks in the shape of
 * the sections source, matched to the synthetic vocabulary. Not HSK content.
 */
import { prepareSectionsImport } from "../../src/server/services/curriculum-import";
import { HSK_BANDS, SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { TEST_SOURCE, sourceFile } from "../helpers/import";
import type { SyntheticRecord } from "./synthetic-vocab";

const LEVELS = HSK_BANDS.map((b) => `HSK${b}`);

export function sectionFiles(records: readonly SyntheticRecord[]) {
  const grammar = [
    "examLevelId,content,grammarType,categoryType,grammarDetail,cases",
    "HSK1,是……的,特殊表达法,强调,,我是坐车来的。\\n他是昨天到的。",
    "HSK1,了,动作的态,完成,,我吃了饭。",
    "HSK1,,句子的类型,句类,样例陈述句,这是样例。",
    ...LEVELS.slice(1).map((l, i) => `${l},样例语法${i},词类,名词,,样例语法${i}很好。`),
  ].join("\n");
  const hanzi = ["examLevelId,word,type", "HSK1,样,1", "HSK1,例,2", "HSK1,词,1", ...LEVELS.slice(1).map((l, i) => `${l},${"二三四五六七"[i]},1`)].join("\n");
  const topic = [
    "examLevelId,children,level1Content,level2Content,level3Content",
    "HSK1,[],样例领域,样例主题甲,样例细节甲",
    ...LEVELS.map((l, i) => `${l},[],样例领域,样例主题${i},样例细节${i}`),
  ].join("\n");
  const task = [
    "examLevelId,children,level1Content,level2Content",
    "HSK1,[],样例任务甲,能完成样例任务甲。",
    ...LEVELS.map((l, i) => `${l},[],样例任务${i},能完成样例任务${i}。`),
  ].join("\n");
  const vocab = ["type,word,pinyin,cixing,sort,levelName", ...records.map((r) => ["1", r.hanzi, r.pinyin, "", String(r.id), "x"].join(","))].join("\n");
  return [
    sourceFile("hsk_grammar.csv", grammar),
    sourceFile("hsk_hanzi.csv", hanzi),
    sourceFile("hsk_topic.csv", topic),
    sourceFile("hsk_task.csv", task),
    sourceFile("hsk_vocabulary.csv", vocab),
  ];
}

/** Statements that load the synthetic sections over the synthetic vocabulary. */
export function syntheticSections(records: readonly SyntheticRecord[]) {
  const result = prepareSectionsImport({
    editionId: SYNTHETIC_EDITION_ID,
    files: sectionFiles(records),
    storedVocab: records.map((r) => ({ sourceId: r.id, hanzi: r.hanzi, pinyin: r.pinyin })),
    source: TEST_SOURCE,
    importedAt: "2026-11-26T00:00:00.000Z",
  });
  if (!result.ok) throw new Error(`sections fixture rejected: ${JSON.stringify(result.issues)}`);
  return result.statements;
}
