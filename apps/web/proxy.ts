import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (!request.cookies.has('serp_access') && !request.cookies.has('serp_refresh')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/pages/:path*'] };