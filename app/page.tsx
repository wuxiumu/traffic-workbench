import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Overview from "@/components/Overview";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isAuthenticated()) redirect("/login");
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <TopBar />
      <Overview />
    </div>
  );
}
