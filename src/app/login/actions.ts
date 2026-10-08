'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
  })

  if (error) {
    const message = /banned/i.test(error.message)
      ? 'This account has been disabled. Contact an administrator.'
      : 'Invalid email or password'
    redirect('/login?error=' + encodeURIComponent(message))
  }

  revalidatePath('/', 'layout')
  // Accounts provisioned with a temporary password must replace it before
  // seeing anything else. The proxy enforces this too; this just skips a hop.
  redirect(data.user?.app_metadata?.must_change_password === true ? '/change-password' : '/dashboard')
}
