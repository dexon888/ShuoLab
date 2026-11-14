import { PageHeader } from "../components/PageHeader";
import { NotBuiltYet } from "../components/Section";

export function ReviewPage() {
  return (
    <>
      <PageHeader zh="复习" en="Review" />
      <NotBuiltYet phase={4}>
        Spaced review of vocabulary you have met, with separate schedules for listening, speaking,
        reading and writing.
      </NotBuiltYet>
    </>
  );
}
