'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { validatePassword } from '@/lib/auth/password'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function fail(message: string): never {
  redirect('/change-password?error=' + encodeURIComponent(message))
}

export async function changePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password !== confirm) fail('The two passwords do not match')
  const problems = validatePassword(password)
  if (problems.length > 0) fail(problems.join('. '))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    fail(/same|different/i.test(error.message)
      ? 'The new password must be different from your temporary password'
      : error.message)
  }

  if (user.app_metadata?.must_change_password === true) {
    // app_metadata is only writable with the service role, which is the
    // point: the user cannot clear this flag without going through here.
    const admin = createAdminClient()
    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...user.app_metadata,
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
      },
    })
    if (metaError) fail('Password saved, but the account flag could not be updated. Please sign in again.')
    // Pull the updated claims into the session cookie.
    await supabase.auth.refreshSession()
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
