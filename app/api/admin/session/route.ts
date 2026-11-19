import { withSuperAdmin } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withSuperAdmin(
    "verificar sessão administrativa",
    async ({ user, isSuperAdmin, adminCompanyIds }) => {
      return Response.json({
        is_admin: isSuperAdmin || adminCompanyIds.length > 0,
        is_super_admin: isSuperAdmin,
        admin_company_ids: adminCompanyIds,
        email: user.email || "",
        user_id: user.id,
      });
    },
    request
  );
}
