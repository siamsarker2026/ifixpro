import Link from "next/link";
import { 
  Users, 
  Wrench, 
  FileText, 
  Target 
} from "lucide-react";

const settingsModules = [
  {
    title: "Technicians / Vendors",
    description: "Manage staff, vendors, and teams",
    href: "/dashboard/settings/technicians",
    icon: Users,
    iconBg: "bg-purple-100 text-purple-600",
  },
  {
    title: "Services",
    description: "Configure repair services list",
    href: "/dashboard/settings/services",
    icon: Wrench,
    iconBg: "bg-red-100 text-red-600",
  },
  {
    title: "Repair Request Lists",
    description: "View and manage submitted requests",
    href: "/dashboard/settings/requests",
    icon: FileText,
    iconBg: "bg-blue-100 text-blue-600",
  },
  {
    title: "Daily Target",
    description: "Configure work hours and targets",
    href: "/dashboard/settings/targets",
    icon: Target,
    iconBg: "bg-emerald-100 text-emerald-600",
  },
  {
    title: "User Access Management",
    description: "Manage user roles, passwords, and account access",
    href: "/dashboard/settings/users",
    icon: Users,
    iconBg: "bg-yellow-100 text-yellow-600",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Select a configuration module below to manage your system settings
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settingsModules.map((item) => {
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