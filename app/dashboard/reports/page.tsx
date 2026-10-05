import Link from "next/link";
import { 
  Users, 
  Wrench, 
  FileText, 
  TrendingUp 
} from "lucide-react";

const reportsModules = [
  {
    title: "Daily Work Efficiency",
    description: "Monitor daily output and performance",
    href: "/dashboard/reports/efficiency",
    icon: TrendingUp,
    iconBg: "bg-amber-100 text-amber-600",
  },
  {
    title: "Diagnostic Reports",
    description: "View and download diagnostic reports",
    href: "/dashboard/reports/diagnostic",
    icon: FileText,
    iconBg: "bg-blue-100 text-blue-600",
  },
];

export default function ReportsPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Select a report module below to view your analytics
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportsModules.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between p-6 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 group"
            >
              <div className="flex items-center space-x-4">
                <div className={`p-3 rounded-lg ${item.iconBg}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {item.description}
                  </p>
                </div>
              </div>
              <span className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all">
                ›
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}