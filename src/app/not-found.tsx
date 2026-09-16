import Link from 'next/link';

/** Global 404. Kept dependency-free so it renders even if app state is broken. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[#98a0ad]">
          404
        </p>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.025em] text-[#10141c]">
          That page doesn&rsquo;t exist
        </h1>
        <p className="mt-3 text-[14.5px] leading-[1.65] text-[#6c7686]">
          The link may be out of date. Your profile and progress are stored in this browser and are
          unaffected.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-[10px] bg-[#10141c] px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-[#1c2534]"
          >
            Back to my route
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-[10px] border border-[#d6d5cf] bg-white px-5 text-[14.5px] font-medium text-[#10141c] transition-colors hover:bg-[#f5f5f2]"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
