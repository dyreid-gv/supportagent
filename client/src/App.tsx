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
  ClipboardList,
  AlertTriangle,
  ThumbsUp,
  Layers,
  Shuffle,
  Globe,
  Monitor,
  Link2,
  Clock,
  Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Chatbot from "@/pages/chatbot";
import AdminPanel from "@/pages/admin";
import HealthDashboard from "@/pages/health";

const sidebarGroups = [
  {
    label: "",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Chatbot", url: "/chat", icon: MessageSquare },
    ],
  },
  {
    label: "Kunnskap",
    items: [
      { title: "Playbook", url: "/?tab=playbook", icon: BookOpen },
      { title: "Pipeline", url: "/?tab=pipeline", icon: GraduationCap },
    ],
  },
  {
    label: "Review",
    items: [
      { title: "Review Kø", url: "/?tab=review", icon: ClipboardList, badge: true },
      { title: "Usikkerhet", url: "/?tab=uncertainty", icon: AlertTriangle },
      { title: "Tilbakemelding", url: "/?tab=feedback", icon: ThumbsUp },
    ],
  },
  {
    label: "Analyse",
    items: [
      { title: "Temaer / Discovery", url: "/?tab=themes", icon: Layers },
      { title: "Dialog-mønstre", url: "/?tab=dialog-patterns", icon: BarChart3 },
      { title: "Min Side-kobling", url: "/?tab=minside-mappings", icon: Monitor },
      { title: "Artikkel-match", url: "/?tab=article-match", icon: Link2 },
      { title: "Reklassifisering", url: "/?tab=reclassification", icon: Shuffle },
      { title: "Health Score", url: "/admin/health", icon: Activity },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Historikk", url: "/?tab=history", icon: Clock },
      { title: "Autosvar", url: "/?tab=templates", icon: Zap },
      { title: "Admin", url: "/admin", icon: Settings },
    ],
  },
];

function AppSidebar() {
  const [location] = useLocation();
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const currentTab = searchParams.get("tab");

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/training/stats"],
    refetchInterval: 30000,
  });

  const reviewCount = stats?.stats?.reviewQueuePending || 0;

  const isActive = (url: string) => {
    if (url === "/") return location === "/" && !currentTab;
    if (url === "/chat") return location === "/chat";
    if (url === "/admin/health") return location === "/admin/health";
    if (url === "/admin") return location === "/admin";
    if (url.startsWith("/?tab=")) {
      const tabParam = url.split("tab=")[1];
      return location === "/" && currentTab === tabParam;
    }
    return false;
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <Link href="/">
            <div className="flex items-center gap-3 px-3 pt-4 pb-2 cursor-pointer" data-testid="link-logo-dashboard">
              <img
                src="https://www.dyreid.no/images/logodyreid.png"
                alt="DyreID – eiet av Den norske veterinærforening"
                className="h-8 w-auto"
              />
            </div>
          </Link>
          <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Support AI Admin
          </p>
        </SidebarGroup>
        {sidebarGroups.map((group, gi) => (
          <SidebarGroup key={gi}>
            {group.label && (
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive(item.url)}>
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span className="text-[13px]">{item.title}</span>
                        {"badge" in item && item.badge && reviewCount > 0 && (
                          <span
                            className="ml-auto inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold"
                            style={{ backgroundColor: "#C0392B", color: "#FFFFFF" }}
                            data-testid="badge-review-count"
                          >
                            {reviewCount}
                          </span>
                        )}
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
    "--sidebar-width": "15rem",
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
                <header className="flex items-center justify-between gap-2 p-2 border-b bg-card">
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
