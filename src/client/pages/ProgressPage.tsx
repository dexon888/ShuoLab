import { PageHeader } from "../components/PageHeader";
import { NotBuiltYet } from "../components/Section";

export function ProgressPage() {
  return (
    <>
      <PageHeader zh="进度" en="Progress" />
      <NotBuiltYet phase={4}>
        Practice minutes, listening accuracy, speaking turns and HSK coverage by skill, each shown
        with its sample size.
      </NotBuiltYet>
    </>
  );
}
