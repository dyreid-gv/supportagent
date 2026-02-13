import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Search,
  AlertTriangle,
  ClipboardList,
  Layers,
  Eye,
  X,
  Send,
} from "lucide-react";
import { useState, useCallback } from "react";

interface TrainingStats {
  stats: {
    rawTickets: number;
    scrubbedTickets: number;
    categoryMappings: number;
    intentClassifications: number;
    resolutionPatterns: number;
    playbookEntries: number;
    uncertaintyCases: number;
    uncategorizedThemes: number;
    reviewQueuePending: number;
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
    errorLog: string | null;
  }[];
}

interface PlaybookEntry {
  id: number;
  intent: string;
  hjelpesenterCategory: string;
  hjelpesenterSubcategory: string;
  keywords: string;
  primaryAction: string;
  primaryEndpoint: string;
  resolutionSteps: string;
  successIndicators: string;
  paymentRequiredProbability: number;
  autoCloseProbability: number;
  ticketCount: number;
  isActive: boolean;
}

interface ReviewQueueItem {
  id: number;
  reviewType: string;
  referenceId: number;
  priority: string;
  data: any;
  status: string;
  createdAt: string;
}

interface UncategorizedTheme {
  id: number;
  themeName: string;
  description: string;
  ticketCount: number;
  ticketIds: string;
  shouldBeNewCategory: boolean;
  suggestedExistingCategory: string | null;
  reviewed: boolean;
  reviewerNotes: string | null;
}

interface UncertaintyCase {
  id: number;
  ticketId: number;
  uncertaintyType: string;
  missingInformation: string;
  suggestedQuestions: string;
  needsHumanReview: boolean;
  reviewPriority: string;
  detectedAt: string;
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
              if (data.progress !== undefined && data.progress >= 0) {
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
      queryClient.invalidateQueries({ queryKey: ["/api/playbook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/uncategorized-themes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/uncertainty-cases"] });
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

function WorkflowCard({
  step,
  title,
  description,
  endpoint,
  icon: Icon,
}: {
  step: number;
  title: string;
  description: string;
  endpoint: string;
  icon: any;
}) {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow(endpoint);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate font-mono text-xs">
            {step}
          </Badge>
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
        <Button
          data-testid={`button-workflow-${step}`}
          onClick={run}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? "Kjorer..." : "Start"}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">{description}</p>
        {isRunning && <Progress value={progress} className="mb-2" />}
        {error && (
          <div className="flex items-center gap-1 text-xs text-destructive mb-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}
        {logs.length > 0 && (
          <ScrollArea className="h-20 rounded-md border p-2">
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

function ReviewPanel({ item, onClose }: { item: ReviewQueueItem; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [correctIntent, setCorrectIntent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (approved: boolean) => {
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/training/submit-review", {
        queueId: item.id,
        reviewerEmail: email || "admin@dyreid.no",
        decision: {
          approved,
          correctIntent: correctIntent || undefined,
          notes,
          addToPlaybook: approved,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/training/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
      onClose();
    } catch (err: any) {
      alert("Feil: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium">Review #{item.id}</CardTitle>
          <Badge variant={item.priority === "high" ? "destructive" : "secondary"}>
            {item.priority}
          </Badge>
          <Badge variant="outline">{item.reviewType.replace(/_/g, " ")}</Badge>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-review">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border p-3 bg-muted/30">
          <p className="text-xs font-medium mb-1">Data</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-auto">
            {JSON.stringify(item.data, null, 2)}
          </pre>
        </div>

        <div className="space-y-2">
          <Input
            placeholder="Din e-post"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="input-reviewer-email"
          />
          {(item.reviewType === "uncertain_classification" || item.reviewType === "new_intent") && (
            <Input
              placeholder="Korrekt intent (valgfritt)"
              value={correctIntent}
              onChange={(e) => setCorrectIntent(e.target.value)}
              data-testid="input-correct-intent"
            />
          )}
          <Textarea
            placeholder="Notater..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="resize-none"
            data-testid="input-review-notes"
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="flex-1"
            data-testid="button-approve-review"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Godkjenn
          </Button>
          <Button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            variant="destructive"
            className="flex-1"
            data-testid="button-reject-review"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Avvis
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const WORKFLOW_NAME_MAP: Record<string, string> = {
  ingestion: "1. Innhenting",
  gdpr_scrubbing: "2. GDPR Rensing",
  category_mapping: "3. Kategorisering",
  uncategorized_analysis: "4. Ukategoriserte",
  intent_classification: "5. Intent",
  resolution_extraction: "6. Losning",
  uncertainty_detection: "7. Usikkerhet",
  playbook_generation: "8. Playbook",
};

export default function Dashboard() {
  const [selectedReview, setSelectedReview] = useState<ReviewQueueItem | null>(null);

  const { data, isLoading } = useQuery<TrainingStats>({
    queryKey: ["/api/training/stats"],
    refetchInterval: 10000,
  });

  const { data: playbook } = useQuery<PlaybookEntry[]>({
    queryKey: ["/api/playbook"],
  });

  const { data: reviewQueue } = useQuery<ReviewQueueItem[]>({
    queryKey: ["/api/training/review-queue"],
  });

  const { data: themes } = useQuery<UncategorizedTheme[]>({
    queryKey: ["/api/training/uncategorized-themes"],
  });

  const { data: uncertainCases } = useQuery<UncertaintyCase[]>({
    queryKey: ["/api/training/uncertainty-cases"],
  });

  const stats = data?.stats;
  const runs = data?.runs || [];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
            DyreID Training Agent
          </h1>
          <p className="text-sm text-muted-foreground">
            9-stegs treningspipeline for support-automatisering
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/playbook"] });
            queryClient.invalidateQueries({ queryKey: ["/api/training/review-queue"] });
          }}
          data-testid="button-refresh-all"
        >
          <RefreshCw className="h-4 w-4" />
          Oppdater
        </Button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        <StatCard title="Raw" value={stats?.rawTickets || 0} icon={Database} />
        <StatCard title="Renset" value={stats?.scrubbedTickets || 0} icon={Shield} />
        <StatCard title="Mappet" value={stats?.categoryMappings || 0} icon={Tags} />
        <StatCard title="Ukat." value={stats?.uncategorizedThemes || 0} icon={Layers} />
        <StatCard title="Klassif." value={stats?.intentClassifications || 0} icon={Brain} />
        <StatCard title="Losning" value={stats?.resolutionPatterns || 0} icon={FileText} />
        <StatCard title="Usikker" value={stats?.uncertaintyCases || 0} icon={AlertTriangle} />
        <StatCard title="Playbook" value={stats?.playbookEntries || 0} icon={BookOpen} />
        <StatCard title="Review" value={stats?.reviewQueuePending || 0} icon={ClipboardList} />
      </div>

      <Tabs defaultValue="pipeline">
        <TabsList className="flex-wrap">
          <TabsTrigger value="pipeline" data-testid="tab-pipeline">
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="playbook" data-testid="tab-playbook">
            Playbook
          </TabsTrigger>
          <TabsTrigger value="review" data-testid="tab-review">
            Review Kø ({reviewQueue?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="themes" data-testid="tab-themes">
            Temaer
          </TabsTrigger>
          <TabsTrigger value="uncertainty" data-testid="tab-uncertainty">
            Usikkerhet
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            Historikk
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 mt-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <WorkflowCard
              step={1}
              title="Ticket Innhenting"
              description="Hent lukkede tickets fra Pureservice API med paginering"
              endpoint="/api/training/ingest"
              icon={Database}
            />
            <WorkflowCard
              step={2}
              title="GDPR Rensing"
              description="Fjern PII: navn, telefon, e-post, chip-ID, adresser, IP"
              endpoint="/api/training/scrub"
              icon={Shield}
            />
            <WorkflowCard
              step={3}
              title="Kategorimapping"
              description="Map tickets til 9 hjelpesenter-kategorier via AI"
              endpoint="/api/training/categorize"
              icon={Tags}
            />
            <WorkflowCard
              step={4}
              title="Ukategorisert Analyse"
              description="Klyngeanalyse av ukategoriserte tickets for temaidentifisering"
              endpoint="/api/training/analyze-uncategorized"
              icon={Search}
            />
            <WorkflowCard
              step={5}
              title="Intent-klassifisering"
              description="Klassifiser kundeintent med 34 kjente intents via AI"
              endpoint="/api/training/classify"
              icon={Brain}
            />
            <WorkflowCard
              step={6}
              title="Løsningsekstraksjon"
              description="Ekstraher steg-for-steg løsningsmønstre fra dialog"
              endpoint="/api/training/extract-resolutions"
              icon={FileText}
            />
            <WorkflowCard
              step={7}
              title="Usikkerhetsdeteksjon"
              description="Identifiser lav-confidence klassifiseringer for manuell review"
              endpoint="/api/training/detect-uncertainty"
              icon={AlertTriangle}
            />
            <WorkflowCard
              step={8}
              title="Playbook Builder"
              description="Aggreger alle data til final Support Playbook"
              endpoint="/api/training/generate-playbook"
              icon={BookOpen}
            />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate font-mono text-xs">
                    9
                  </Badge>
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">Manuell Review</CardTitle>
                </div>
                <Badge variant={reviewQueue && reviewQueue.length > 0 ? "destructive" : "secondary"}>
                  {reviewQueue?.length || 0} ventende
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Gjennomgå usikre klassifiseringer og nye intents i Review-fanen
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    const el = document.querySelector('[data-testid="tab-review"]') as HTMLElement;
                    el?.click();
                  }}
                  data-testid="button-workflow-9"
                >
                  <Eye className="h-4 w-4" />
                  Gå til Review
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="playbook" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Support Playbook</CardTitle>
              <Badge variant="outline">{playbook?.length || 0} entries</Badge>
            </CardHeader>
            <CardContent>
              {!playbook || playbook.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Ingen playbook-entries ennå. Kjør treningspipelinen eller generer playbook direkte (Steg 8).
                </p>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3 pr-4">
                    {playbook.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-md border p-3 space-y-2"
                        data-testid={`playbook-entry-${entry.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{entry.intent}</span>
                            <Badge variant="secondary">{entry.hjelpesenterCategory}</Badge>
                            {entry.hjelpesenterSubcategory && (
                              <Badge variant="outline">{entry.hjelpesenterSubcategory}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {entry.paymentRequiredProbability > 0.5 && (
                              <Badge variant="destructive">Betaling</Badge>
                            )}
                            {entry.autoCloseProbability > 0.5 && (
                              <Badge>Auto-lukk</Badge>
                            )}
                            <Badge variant={entry.isActive ? "default" : "secondary"}>
                              {entry.isActive ? "Aktiv" : "Inaktiv"}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {entry.primaryAction && (
                            <p className="text-xs text-muted-foreground">
                              Handling: {entry.primaryAction}
                            </p>
                          )}
                          {entry.primaryEndpoint && (
                            <p className="text-xs font-mono text-muted-foreground">
                              {entry.primaryEndpoint}
                            </p>
                          )}
                          {entry.keywords && (
                            <p className="text-xs text-muted-foreground">
                              Nøkkelord: {entry.keywords}
                            </p>
                          )}
                          {entry.resolutionSteps && (
                            <p className="text-xs text-muted-foreground">
                              Steg: {entry.resolutionSteps}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Ventende Reviews</CardTitle>
                <Badge variant="outline">{reviewQueue?.length || 0}</Badge>
              </CardHeader>
              <CardContent>
                {!reviewQueue || reviewQueue.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Ingen ventende reviews. Kjør Workflow 7 (Usikkerhetsdeteksjon) for å identifisere cases.
                  </p>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2 pr-4">
                      {reviewQueue.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
                          onClick={() => setSelectedReview(item)}
                          data-testid={`review-item-${item.id}`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge variant={item.priority === "high" ? "destructive" : item.priority === "medium" ? "secondary" : "outline"}>
                                {item.priority}
                              </Badge>
                              <span className="text-xs font-medium truncate">
                                {item.reviewType.replace(/_/g, " ")}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Ref: #{item.referenceId} | {new Date(item.createdAt).toLocaleDateString("nb-NO")}
                            </p>
                          </div>
                          <Button size="icon" variant="ghost" data-testid={`button-view-review-${item.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <div>
              {selectedReview ? (
                <ReviewPanel item={selectedReview} onClose={() => setSelectedReview(null)} />
              ) : (
                <Card>
                  <CardContent className="flex items-center justify-center h-48">
                    <p className="text-sm text-muted-foreground">Velg en review-item fra listen</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="themes" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Ukategoriserte Temaer</CardTitle>
              <Badge variant="outline">{themes?.length || 0} temaer</Badge>
            </CardHeader>
            <CardContent>
              {!themes || themes.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Ingen temaer identifisert ennå. Kjør Workflow 4 (Ukategorisert Analyse) etter kategorimapping.
                </p>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3 pr-4">
                    {themes.map((theme) => (
                      <div
                        key={theme.id}
                        className="rounded-md border p-3 space-y-2"
                        data-testid={`theme-${theme.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{theme.themeName}</span>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline">{theme.ticketCount} tickets</Badge>
                            {theme.shouldBeNewCategory && (
                              <Badge variant="destructive">Ny kategori?</Badge>
                            )}
                            {theme.reviewed && (
                              <Badge>Gjennomgått</Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{theme.description}</p>
                        {theme.suggestedExistingCategory && (
                          <p className="text-xs text-muted-foreground">
                            Foreslått kategori: <span className="font-medium">{theme.suggestedExistingCategory}</span>
                          </p>
                        )}
                        {theme.reviewerNotes && (
                          <p className="text-xs text-muted-foreground italic">
                            Reviewer: {theme.reviewerNotes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="uncertainty" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Usikre Klassifiseringer</CardTitle>
              <Badge variant="outline">{uncertainCases?.length || 0} cases</Badge>
            </CardHeader>
            <CardContent>
              {!uncertainCases || uncertainCases.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Ingen usikkerhets-cases ennå. Kjør Workflow 7 (Usikkerhetsdeteksjon) etter intent-klassifisering.
                </p>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3 pr-4">
                    {uncertainCases.map((uc) => (
                      <div
                        key={uc.id}
                        className="rounded-md border p-3 space-y-2"
                        data-testid={`uncertainty-${uc.id}`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-sm font-medium">Ticket #{uc.ticketId}</span>
                            <Badge
                              variant={
                                uc.reviewPriority === "high" ? "destructive"
                                : uc.reviewPriority === "medium" ? "secondary"
                                : "outline"
                              }
                            >
                              {uc.reviewPriority}
                            </Badge>
                          </div>
                          <Badge variant="outline">{uc.uncertaintyType?.replace(/_/g, " ")}</Badge>
                        </div>
                        {uc.missingInformation && (
                          <div>
                            <p className="text-xs font-medium">Manglende info:</p>
                            <p className="text-xs text-muted-foreground">{uc.missingInformation}</p>
                          </div>
                        )}
                        {uc.suggestedQuestions && (
                          <div>
                            <p className="text-xs font-medium">Foreslåtte spørsmål:</p>
                            <p className="text-xs text-muted-foreground">{uc.suggestedQuestions}</p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Oppdaget: {new Date(uc.detectedAt).toLocaleString("nb-NO")}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Kjørehistorikk</CardTitle>
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
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2 pr-4">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between gap-2 p-3 rounded-md border flex-wrap"
                        data-testid={`run-${run.id}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {run.status === "completed" ? (
                            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                          ) : run.status === "running" ? (
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                          )}
                          <span className="text-sm font-medium">
                            {WORKFLOW_NAME_MAP[run.workflow] || run.workflow}
                          </span>
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
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
