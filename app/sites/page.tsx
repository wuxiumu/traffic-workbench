import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import SitesManager from "@/components/SitesManager";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  if (!isAuthenticated()) redirect("/login");
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <TopBar />
      <SitesManager />
    </div>
  );
}
