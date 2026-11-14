import { PageHeader } from "../components/PageHeader";
import { NotBuiltYet } from "../components/Section";

export function OnboardingPage() {
  return (
    <>
      <PageHeader zh="开始" en="Getting started" />
      <NotBuiltYet phase={2}>
        Choosing your session length, speech rate, help level and a starting study band.
      </NotBuiltYet>
    </>
  );
}
