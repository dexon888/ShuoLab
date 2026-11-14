import { Link } from "react-router";
import { PageHeader } from "../components/PageHeader";

export function NotFoundPage() {
  return (
    <>
      <PageHeader zh="找不到" en="Page not found" />
      <p>There is nothing at this address.</p>
      <p className="mt-4">
        <Link to="/" className="font-medium text-cobalt underline">
          Go to Today
        </Link>
      </p>
    </>
  );
}
