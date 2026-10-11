import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";

/**
 * Every application page sits under this layout, which checks the session on the server before anything is
 * rendered. (The middleware already redirects; this is a second, independent check.)
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentUser())) redirect("/signin");
  return children;
}
