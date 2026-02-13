import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database,
  Shield,
  Tags,
  Brain,
  FileText,
  BookOpen,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";

interface TrainingStats {
  stats: {
    rawTickets: number;
    scrubbedTickets: number;
    categoryMappings: number;
    intentClassifications: number;
    resolutionPatterns: number;
    playbookEntries: number;
    uncertaintyCases: number;
  };
  runs: {
    id: number;
    workflow: string;
    status: string;
    totalTickets: number;
    processedTickets: number;
    errorCount: number;
    startedAt: string;
    completedAt: string | null;
  }[];
}

interface PlaybookEntry {
  id: number;
  intent: string;
  hjelpesenterCategory: string;
  hjelpesenterSubcategory: string;
  keywords: string;
  primaryAction: string;
  resolutionSteps: string;
  paymentRequiredProbability: number;
  autoCloseProbability: number;
  ticketCount: number;
  isActive: boolean;
}

function useSSEWorkflow(endpoint: string) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    setLogs([]);
    setError(null);

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.message) {
                setLogs((prev) => [...prev, data.message]);
              }
              if (data.progress !== undefined) {
                setProgress(data.progress);
              }
              if (data.error) {
                setError(data.error);
              }
              if (data.done) {
                setProgress(100);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRunning(false);
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
    }
  }, [endpoint]);

  return { isRunning, progress, logs, error, run };
}

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: number;
  icon: any;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${title.toLowerCase().replace(/\s/g, "-")}`}>
          {value.toLocaleString()}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowStep({
  title,
  description,
  endpoint,
  icon: Icon,
  disabled,
}: {
  title: string;
  description: string;
  endpoint: string;
  icon: any;
  disabled?: boolean;
}) {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow(endpoint);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <Button
          data-testid={`button-${title.toLowerCase().replace(/\s/g, "-")}`}
          onClick={run}
          disabled={isRunning || disabled}
          size="sm"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? "Kjører..." : "Start"}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">{description}</p>
        {isRunning && <Progress value={progress} className="mb-2" />}
        {error && (
          <div className="flex items-center gap-1 text-sm text-destructive mb-2">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        {logs.length > 0 && (
          <ScrollArea className="h-24 rounded-md border p-2">
            <div className="space-y-1">
              {logs.map((log, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono">
                  {log}
                </p>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<TrainingStats>({
    queryKey: ["/api/training/stats"],
  });

  const { data: playbook } = useQuery<PlaybookEntry[]>({
    queryKey: ["/api/playbook"],
  });

  const stats = data?.stats;
  const runs = data?.runs || [];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
          DyreID Support AI - Training Dashboard
        </h1>
        <p className="text-muted-foreground">
          Administrer treningspipeline og overvåk support-playbook
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard title="Raw Tickets" value={stats?.rawTickets || 0} icon={Database} />
        <StatCard title="Scrubbed" value={stats?.scrubbedTickets || 0} icon={Shield} />
        <StatCard title="Mapped" value={stats?.categoryMappings || 0} icon={Tags} />
        <StatCard title="Classified" value={stats?.intentClassifications || 0} icon={Brain} />
        <StatCard title="Resolutions" value={stats?.resolutionPatterns || 0} icon={FileText} />
        <StatCard title="Playbook" value={stats?.playbookEntries || 0} icon={BookOpen} />
        <StatCard title="Uncertain" value={stats?.uncertaintyCases || 0} icon={AlertCircle} />
      </div>

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline">
            Treningspipeline
          </TabsTrigger>
          <TabsTrigger value="playbook" data-testid="tab-playbook">
            Playbook
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            Kjørehistorikk
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <WorkflowStep
              title="1. Hent Tickets"
              description="Hent historiske supportsaker fra Pureservice API"
              endpoint="/api/training/ingest"
              icon={Database}
            />
            <WorkflowStep
              title="2. GDPR Rensing"
              description="Fjern persondata (navn, telefon, e-post, chip-ID, adresser)"
              endpoint="/api/training/scrub"
              icon={Shield}
            />
            <WorkflowStep
              title="3. Kategorisering"
              description="Koble tickets mot 9 hjelpesenter-kategorier via AI"
              endpoint="/api/training/categorize"
              icon={Tags}
            />
            <WorkflowStep
              title="4. Intent-klassifisering"
              description="Identifiser kundeintent og nødvendige handlinger"
              endpoint="/api/training/classify"
              icon={Brain}
            />
            <WorkflowStep
              title="5. Løsningsekstraksjon"
              description="Ekstraher løsningsmønstre fra klassifiserte tickets"
              endpoint="/api/training/extract-resolutions"
              icon={FileText}
            />
            <WorkflowStep
              title="6. Generer Playbook"
              description="Bygg Support Playbook fra trente data"
              endpoint="/api/training/generate-playbook"
              icon={BookOpen}
            />
          </div>
        </TabsContent>

        <TabsContent value="playbook" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Support Playbook</CardTitle>
            </CardHeader>
            <CardContent>
              {!playbook || playbook.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Ingen playbook-entries ennå. Kjør treningspipelinen eller generer playbook direkte.
                </p>
              ) : (
                <div className="space-y-3">
                  {playbook.map((entry) => (
                    <Card key={entry.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold" data-testid={`text-intent-${entry.id}`}>
                                {entry.intent}
                              </h3>
                              <Badge variant="secondary">{entry.hjelpesenterCategory}</Badge>
                              {entry.hjelpesenterSubcategory && (
                                <Badge variant="outline">{entry.hjelpesenterSubcategory}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {entry.primaryAction}
                            </p>
                            {entry.resolutionSteps && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Steg: {entry.resolutionSteps}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {entry.paymentRequiredProbability > 0.5 && (
                              <Badge variant="destructive">Betaling</Badge>
                            )}
                            {entry.autoCloseProbability > 0.5 && (
                              <Badge>Auto-lukking</Badge>
                            )}
                            <Badge variant={entry.isActive ? "default" : "secondary"}>
                              {entry.isActive ? "Aktiv" : "Inaktiv"}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>Siste kjøringer</CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] })}
                data-testid="button-refresh-history"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-muted-foreground text-sm">Ingen kjøringer ennå.</p>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between gap-2 p-3 rounded-md border flex-wrap"
                      data-testid={`run-${run.id}`}
                    >
                      <div className="flex items-center gap-2">
                        {run.status === "completed" ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : run.status === "running" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-sm font-medium">{run.workflow}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString("nb-NO")}
                        </span>
                        {run.errorCount > 0 && (
                          <Badge variant="destructive">{run.errorCount} feil</Badge>
                        )}
                        <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                          {run.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
