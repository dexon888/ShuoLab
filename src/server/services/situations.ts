import type { PlanSituation } from "../../shared/session";

/**
 * Everyday situations written for ShuoLab (SPEC §6.2 step 3). The HSK topic
 * and task lists are not imported, so these are labelled `app-authored` and
 * are never presented as HSK topics or tasks. The order is fixed: the planner
 * rotates through it.
 */
const AUTHORED: readonly Omit<PlanSituation, "sourceType">[] = [
  { id: "meet-someone", titleZh: "认识新朋友", titleEn: "Meeting someone new", communicativeGoal: "Introduce yourself and ask a new acquaintance about themselves." },
  { id: "order-food", titleZh: "点菜", titleEn: "Ordering a meal", communicativeGoal: "Order food and drinks, ask what is good, and pay." },
  { id: "plan-dinner", titleZh: "约朋友吃饭", titleEn: "Making dinner plans", communicativeGoal: "Agree a time and place to eat with a friend." },
  { id: "ask-directions", titleZh: "问路", titleEn: "Asking the way", communicativeGoal: "Ask how to get somewhere and confirm you understood the answer." },
  { id: "shopping", titleZh: "买东西", titleEn: "Buying something", communicativeGoal: "Ask about an item, its price and alternatives, and decide." },
  { id: "weekend", titleZh: "聊周末", titleEn: "Talking about the weekend", communicativeGoal: "Say what you did or plan to do, and ask the same of someone else." },
  { id: "family", titleZh: "聊家人", titleEn: "Talking about family", communicativeGoal: "Describe the people in your family and ask about someone else's." },
  { id: "daily-routine", titleZh: "聊一天的生活", titleEn: "Describing your day", communicativeGoal: "Explain what an ordinary day looks like for you." },
  { id: "transport", titleZh: "坐车", titleEn: "Getting around", communicativeGoal: "Buy a ticket or take a ride, and check times and stops." },
  { id: "weather-plans", titleZh: "聊天气", titleEn: "Weather and plans", communicativeGoal: "Talk about the weather and change a plan because of it." },
  { id: "feeling-unwell", titleZh: "身体不舒服", titleEn: "Feeling unwell", communicativeGoal: "Say what is wrong and understand simple advice." },
  { id: "work-study", titleZh: "聊工作和学习", titleEn: "Work and study", communicativeGoal: "Say what you do and ask someone about their work or studies." },
];

export const SITUATIONS: readonly PlanSituation[] = AUTHORED.map((s) => ({ ...s, sourceType: "app-authored" }));

export const FREE_CHAT_SITUATION: PlanSituation = {
  id: "free-chat",
  sourceType: "app-authored",
  titleZh: "自由聊天",
  titleEn: "Open conversation",
  communicativeGoal: "Talk about whatever you like. Nothing in this conversation is tied to the HSK syllabus.",
};

/** The situation for the nth session, rotating through the authored list. */
export function situationFor(sessionIndex: number): PlanSituation {
  const index = ((sessionIndex % SITUATIONS.length) + SITUATIONS.length) % SITUATIONS.length;
  // The list is never empty, so this lookup always succeeds.
  return SITUATIONS[index] as PlanSituation;
}
