const milestones = [
  "Import and safely parse synthetic .eml files",
  "Reconstruct conversations and detect duplicates",
  "Add human-reviewed AI classification",
  "Build approved knowledge retrieval and grounded drafts",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-20 sm:px-10">
      <div className="max-w-3xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
          MVP foundation
        </p>
        <h1 className="text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          MailOps AI
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          A provider-agnostic, human-in-the-loop workspace for turning incoming
          email into reviewed classifications, trusted knowledge, and grounded
          reply drafts.
        </p>

        <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Foundation checkpoint</h2>
              <p className="mt-1 text-sm text-slate-600">
                PostgreSQL, Prisma, validated configuration, and automated checks.
              </p>
            </div>
            <a
              className="inline-flex w-fit items-center rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              href="/api/health"
            >
              Check database health
            </a>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Next learning milestones
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {milestones.map((milestone, index) => (
              <li
                className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"
                key={milestone}
              >
                <span className="font-mono text-sky-700">0{index + 1}</span>
                {milestone}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
