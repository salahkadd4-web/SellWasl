import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-4">
      <Image
        src="/symbol.png"
        alt="SellWasl"
        width={160}
        height={120}
        className="h-auto w-[160px]"
        priority
      />
      <p className="text-center text-muted">One Platform. Every Flow.</p>
      <nav className="flex w-full flex-col gap-3">
        <Link
          href="/app"
          className="rounded-lg bg-primary px-4 py-3 text-center font-semibold text-white"
        >
          Espace entreprise
        </Link>
        <Link
          href="/admin"
          className="rounded-lg border border-border px-4 py-3 text-center font-semibold text-primary"
        >
          Administration plateforme
        </Link>
      </nav>
    </main>
  );
}
