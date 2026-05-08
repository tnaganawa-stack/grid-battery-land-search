import { createHash } from 'crypto'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { password } = await request.json()

  const correctPassword = process.env.APP_PASSWORD
  if (!correctPassword) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (password !== correctPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createHash('sha256').update(correctPassword).digest('hex')

  const response = NextResponse.json({ ok: true })
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30日
    path: '/',
  })
  return response
}
