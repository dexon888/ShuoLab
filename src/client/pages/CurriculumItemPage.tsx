import { Link } from "react-router";
import { PageHeader } from "../components/PageHeader";
import { NotBuiltYet } from "../components/Section";

export function CurriculumItemPage() {
  return (
    <>
      <PageHeader zh="词条" en="Entry" />
      <NotBuiltYet phase={1}>
        One syllabus entry with its source page, pinyin, homographs and your recorded evidence.
      </NotBuiltYet>
      <p className="mt-6">
        <Link to="/curriculum" className="font-medium text-cobalt underline">
          Back to curriculum
        </Link>
      </p>
    </>
  );
}
