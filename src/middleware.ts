import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const session = request.cookies.get('session')?.value
  const appPassword = process.env.APP_PASSWORD

  if (!appPassword) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const expected = await hashPassword(appPassword)

  if (session !== expected) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
