import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // If Google sent back an error, show it on the login page
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    )
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (exchangeError) {
      // Most likely: email not on allowlist (our DB trigger raised an exception)
      // Sign the user out so they can try a different account
      await supabase.auth.signOut()
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent('Your account is not authorised. Contact your admin.')}`
      )
    }

    return NextResponse.redirect(origin)
  }

  return NextResponse.redirect(`${origin}/login`)
}