import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Talexio HR</h1>
        <p className="text-gray-500 mb-8">Your all-in-one HR dashboard</p>
        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  )
}
