import { redirect } from 'next/navigation'
import { logout } from '@/app/dashboard/actions'
import { PASSWORD_RULES } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'
import { changePassword } from './actions'

export const dynamic = 'force-dynamic'

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const forced = user.app_metadata?.must_change_password === true

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {forced ? 'Set your password' : 'Change password'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {forced
            ? 'You signed in with a temporary password. Choose a new one to continue.'
            : 'Choose a new password for your account.'}
        </p>

        <p className="mb-4 text-xs text-gray-500">
          Signed in as <span className="font-medium text-gray-700">{user.email}</span>
        </p>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="flex flex-col gap-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <ul className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-500 space-y-0.5">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule}>&bull; {rule}</li>
            ))}
          </ul>

          <button
            formAction={changePassword}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-blue-700 transition-colors mt-2"
          >
            {forced ? 'Save and continue' : 'Save new password'}
          </button>
        </form>

        <form className="mt-6 text-center">
          <button formAction={logout} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
            {forced ? 'Not you? Sign out' : 'Cancel and sign out'}
          </button>
        </form>
      </div>
    </main>
  )
}
