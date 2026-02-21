import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Activity,
  GraduationCap,
  BookOpen,
  BarChart3,
} from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Chatbot from "@/pages/chatbot";
import AdminPanel from "@/pages/admin";
import HealthDashboard from "@/pages/health";

const sidebarGroups = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Chatbot", url: "/chat", icon: MessageSquare },
    ],
  },
  {
    label: "Training",
    items: [
      { title: "Pipeline", url: "/?tab=pipeline", icon: GraduationCap },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { title: "Playbook", url: "/?tab=playbook", icon: BookOpen },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Health", url: "/admin/health", icon: Activity },
      { title: "Discovery", url: "/?tab=discovery", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Admin", url: "/admin", icon: Settings },
    ],
  },
];

function AppSidebar() {
  const [location] = useLocation();

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    if (url.startsWith("/?tab=")) return false;
    return location === url || location.startsWith(url + "/");
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-bold uppercase tracking-wider">
            DyreID Support AI
          </SidebarGroupLabel>
        </SidebarGroup>
        {sidebarGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive(item.url)}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/chat" component={Chatbot} />
      <Route path="/admin/health" component={HealthDashboard} />
      <Route path="/admin" component={AdminPanel} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 p-2 border-b">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-hidden">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
