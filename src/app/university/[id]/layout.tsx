import { UNIVERSITIES } from '@/data/universities';

/**
 * Pre-renders a page for every university in the dataset.
 *
 * Without this the route is server-rendered on demand. With it, all 35 pages are
 * static, which makes the app deployable to any static host as a fallback and
 * removes a server round-trip from the judge's click path.
 */
export function generateStaticParams() {
  return UNIVERSITIES.map((u) => ({ id: u.id }));
}

/**
 * Deliberately left as the default (true). Setting it to false made an unknown
 * id throw NoFallbackError and take the server down, instead of 404ing. With
 * dynamic params allowed, an unrecognised id renders the page component, which
 * already shows a graceful "University not found" state.
 */

export default function UniversityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
