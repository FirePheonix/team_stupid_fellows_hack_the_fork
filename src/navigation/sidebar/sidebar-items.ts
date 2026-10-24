import {
  Bell,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Settings,
  Sparkles,
} from "lucide-react";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Plant",
    items: [
      { id: "overview", title: "Overview", url: "/dashboard", icon: LayoutDashboard },
      {
        id: "runs",
        title: "Runs",
        icon: FlaskConical,
        subItems: [
          { id: "live", title: "Live", url: "/dashboard/runs" },
          { id: "history", title: "History", url: "/dashboard/history" },
          { id: "compare", title: "Compare", url: "/dashboard/compare" },
        ],
      },
      { id: "alarms", title: "Alarms", url: "/dashboard/alarms", icon: Bell },
      { id: "trends", title: "Trends", url: "/dashboard/trends", icon: LineChart },
      { id: "insights", title: "Insights", url: "/dashboard/insights", icon: Sparkles },
      { id: "benchmark", title: "Benchmark", url: "/dashboard/benchmark", icon: Gauge },
    ],
  },
  {
    id: 2,
    label: "Plant setup",
    items: [{ id: "settings", title: "Settings", url: "/dashboard/settings", icon: Settings }],
  },
];
