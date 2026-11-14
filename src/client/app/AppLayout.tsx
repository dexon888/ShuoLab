import { NavLink, Outlet } from "react-router";
import { OfflineBanner } from "../components/OfflineBanner";

const DESTINATIONS = [
  { to: "/", zh: "今天", en: "Today" },
  { to: "/curriculum", zh: "课程", en: "Curriculum" },
  { to: "/review", zh: "复习", en: "Review" },
  { to: "/progress", zh: "进度", en: "Progress" },
  { to: "/settings", zh: "设置", en: "Settings" },
] as const;

/**
 * Phone: content with a thumb-reachable bottom tab bar.
 * Desktop: a left rail, with content held to a readable width.
 */
export function AppLayout() {
  return (
    <div className="min-h-dvh md:pl-52">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-glaze focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-glaze md:inset-y-0 md:right-auto md:w-52 md:border-r md:border-t-0 md:pb-0"
      >
        <p className="hidden px-6 pb-6 pt-8 md:block">
          <span lang="zh-Hans" className="font-kai text-5xl leading-none text-cobalt">
            说
          </span>
          <span className="ml-2 text-lg font-semibold tracking-tight text-cobalt-deep">ShuoLab</span>
        </p>
        <ul className="flex md:flex-col">
          {DESTINATIONS.map((item) => (
            <li key={item.to} className="min-w-0 flex-1 md:flex-none">
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [
                    "flex min-h-14 flex-col items-center justify-center border-t-[3px] px-1 py-1",
                    "md:min-h-12 md:flex-row md:justify-start md:gap-3 md:border-l-4 md:border-t-0 md:px-5",
                    isActive
                      ? "border-cobalt bg-wash font-semibold text-cobalt-deep"
                      : "border-transparent text-mist hover:bg-porcelain hover:text-ink",
                  ].join(" ")
                }
              >
                <span lang="zh-Hans" className="text-base leading-tight md:text-lg">
                  {item.zh}
                </span>
                <span className="text-[0.6875rem] leading-tight md:text-base">{item.en}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <OfflineBanner />

      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 pb-28 pt-8 md:px-10 md:pb-16 md:pt-12">
        <Outlet />
      </main>
    </div>
  );
}
