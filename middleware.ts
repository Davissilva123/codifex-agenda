import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // As rotas de API em /api/admin/* possuem proteção e autorização granular própria
  // em lib/admin-server.ts (withSuperAdmin / requireAdmin), validando tanto
  // Super Admins globais quanto administradores de empresas individuais (admin_empresa)
  // via Bearer Token e cookies com permissões por tenant.
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
