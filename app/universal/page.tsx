import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import UniversalBoard from "@/components/UniversalBoard";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/** 万能统计独立大盘：/universal */
export default async function UniversalPage() {
  if (!isAuthenticated()) redirect("/login");
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <TopBar />
      <UniversalBoard />
    </div>
  );
}
