import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">That page doesn&apos;t exist. Your files were never uploaded anywhere, so nothing is lost.</p>
      <Link href="/" className="btn btn-primary mt-6 inline-flex">
        Back to the converter
      </Link>
    </div>
  );
}
