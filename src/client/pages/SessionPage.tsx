import { PageHeader } from "../components/PageHeader";
import { NotBuiltYet } from "../components/Section";

export function SessionPage() {
  return (
    <>
      <PageHeader zh="练习" en="Session" />
      <NotBuiltYet phase={2}>
        A guided session: listen first, then speak, read and write around one everyday situation.
        Typed conversation comes first; voice follows in Phase 3.
      </NotBuiltYet>
    </>
  );
}
