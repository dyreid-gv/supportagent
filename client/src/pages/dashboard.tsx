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
  Banknote,
  Plus,
  Pencil,
  Trash2,
  Save,
  Zap,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  MessageSquare,
  Flag,
  Link2,
} from "lucide-react";
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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

interface ServicePrice {
  id: number;
  serviceKey: string;
  serviceName: string;
  price: number;
  currency: string;
  description: string | null;
  category: string | null;
  sourceTemplate: string | null;
  effectiveDate: string | null;
  isActive: boolean;
  updatedAt: string | null;
}

interface ResponseTemplate {
  id: number;
  templateId: number;
  name: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  hjelpesenterCategory: string | null;
  hjelpesenterSubcategory: string | null;
  ticketType: string | null;
  intent: string | null;
  keyPoints: string[] | null;
  isActive: boolean;
  fetchedAt: string | null;
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
      queryClient.invalidateQueries({ queryKey: ["/api/training/help-center-match-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/help-center-matches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/autoreply-stats"] });
    }
  }, [endpoint]);

  return { isRunning, progress, logs, error, run };
}

function CombinedBatchCard() {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow("/api/training/test-combined");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          data-testid="button-combined-batch"
          onClick={run}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {isRunning ? "Kjorer..." : "Kjor Kombinert Analyse"}
        </Button>
      </div>
      {isRunning && <Progress value={progress} />}
      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
      {logs.length > 0 && (
        <ScrollArea className="h-24 rounded-md border p-2">
          <div className="space-y-1">
            {logs.map((log, i) => (
              <p key={i} className="text-xs text-muted-foreground font-mono">{log}</p>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
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

  const { data: prices } = useQuery<ServicePrice[]>({
    queryKey: ["/api/prices"],
  });

  const { data: responseTemplates } = useQuery<ResponseTemplate[]>({
    queryKey: ["/api/templates"],
  });

  interface FeedbackStats {
    total: number;
    resolved: number;
    partial: number;
    notResolved: number;
    nofeedback: number;
    byIntent: Record<string, { total: number; resolved: number; notResolved: number; partial: number }>;
  }

  interface ChatbotInteraction {
    id: number;
    conversationId: number | null;
    messageId: number | null;
    userQuestion: string;
    botResponse: string;
    responseMethod: string | null;
    matchedIntent: string | null;
    matchedCategory: string | null;
    feedbackResult: string | null;
    feedbackComment: string | null;
    flaggedForReview: boolean | null;
    authenticated: boolean | null;
    responseTimeMs: number | null;
    createdAt: string | null;
    feedbackAt: string | null;
  }

  const { data: feedbackStats } = useQuery<FeedbackStats>({
    queryKey: ["/api/feedback/stats"],
  });

  const { data: flaggedInteractions } = useQuery<ChatbotInteraction[]>({
    queryKey: ["/api/feedback/flagged"],
  });

  const { data: recentInteractions } = useQuery<ChatbotInteraction[]>({
    queryKey: ["/api/feedback/interactions"],
  });

  const { data: autoreplyStats } = useQuery<{
    totalAnalyzed: number;
    withAutoreply: number;
    withoutAutoreply: number;
    unanalyzed: number;
    avgConfidence: number;
    templateDistribution: { templateId: number; templateName: string; count: number }[];
    onlyAutoreply: number;
  }>({
    queryKey: ["/api/training/autoreply-stats"],
  });

  const { data: helpCenterMatchStats } = useQuery<{
    totalMatches: number;
    avgConfidence: number;
    highAlignment: number;
    mediumAlignment: number;
    lowAlignment: number;
    contradicts: number;
    followsProcedure: number;
    topArticles: { articleId: number; title: string; matchCount: number }[];
    commonMissing: string[];
  }>({
    queryKey: ["/api/training/help-center-match-stats"],
  });

  const { data: helpCenterMatches } = useQuery<{
    id: number;
    ticketId: number;
    articleId: number;
    matchConfidence: number;
    matchReason: string | null;
    followsOfficialProcedure: boolean | null;
    alignmentQuality: string | null;
    missingFromAgent: string[] | null;
    addedByAgent: string[] | null;
    createdAt: string | null;
  }[]>({
    queryKey: ["/api/training/help-center-matches"],
  });

  const [editingPrice, setEditingPrice] = useState<ServicePrice | null>(null);
  const [addingPrice, setAddingPrice] = useState(false);
  const [seedingPrices, setSeedingPrices] = useState(false);
  const [fetchingTemplates, setFetchingTemplates] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<number | null>(null);

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
        <div className="flex items-center gap-2 flex-wrap">
          {stats?.rawTickets === 0 && (
            <Button
              size="sm"
              variant="default"
              onClick={async () => {
                try {
                  await apiRequest("POST", "/api/training/seed-test-data", { count: 100 });
                  queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
                } catch (e: any) {
                  alert(e.message || "Feil ved seeding");
                }
              }}
              data-testid="button-seed-test-data"
            >
              <Database className="h-4 w-4" />
              Legg inn 100 test-saker
            </Button>
          )}
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
          <TabsTrigger value="prices" data-testid="tab-prices">
            Priser ({prices?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            Autosvar ({responseTemplates?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="feedback" data-testid="tab-feedback">
            Tilbakemelding
          </TabsTrigger>
          <TabsTrigger value="article-match" data-testid="tab-article-match">
            Artikkel-match ({helpCenterMatchStats?.totalMatches || 0})
          </TabsTrigger>
          <TabsTrigger value="autoreply-detect" data-testid="tab-autoreply-detect">
            Autosvar-gjenkjenning
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
          <Card className="mt-4 border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Zap className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-medium">Kombinert Batch-Analyse (Steg 3+5+6)</CardTitle>
                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">5x parallell</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Kjor kategori + intent + resolusjon i EN API-kall per 10 tickets med 5x parallell prosessering. Estimert &lt;20 timer for 40K tickets.
              </p>
              <CombinedBatchCard />
            </CardContent>
          </Card>
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

        <TabsContent value="prices" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Tjenestepriser</CardTitle>
              <div className="flex items-center gap-2">
                {(!prices || prices.length === 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={seedingPrices}
                    onClick={async () => {
                      setSeedingPrices(true);
                      try {
                        await apiRequest("POST", "/api/prices/seed");
                        queryClient.invalidateQueries({ queryKey: ["/api/prices"] });
                      } catch (e) {}
                      setSeedingPrices(false);
                    }}
                    data-testid="button-seed-prices"
                  >
                    {seedingPrices ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    Importer standardpriser
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setAddingPrice(true)}
                  data-testid="button-add-price"
                >
                  <Plus className="h-4 w-4" />
                  Legg til pris
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!prices || prices.length === 0 ? (
                <div className="text-center py-8">
                  <Banknote className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">Ingen priser konfigurert ennå.</p>
                  <p className="text-muted-foreground text-xs mt-1">Klikk "Importer standardpriser" for å laste inn priser fra Pureservice-maler.</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1 pr-4">
                    {Object.entries(
                      prices.reduce((acc: Record<string, ServicePrice[]>, p) => {
                        const cat = p.category || "Annet";
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(p);
                        return acc;
                      }, {})
                    ).map(([category, catPrices]) => (
                      <div key={category} className="mb-4">
                        <h3 className="text-sm font-semibold text-muted-foreground mb-2">{category}</h3>
                        {catPrices.map((p) => (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between gap-3 p-3 rounded-md border mb-1 flex-wrap ${!p.isActive ? "opacity-50" : ""}`}
                            data-testid={`price-row-${p.serviceKey}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{p.serviceName}</span>
                                {!p.isActive && <Badge variant="secondary">Inaktiv</Badge>}
                              </div>
                              {p.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                              )}
                              {p.sourceTemplate && (
                                <p className="text-xs text-muted-foreground italic">Kilde: {p.sourceTemplate}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-bold whitespace-nowrap" data-testid={`price-value-${p.serviceKey}`}>
                                {p.price === 0 ? "Gratis" : `${p.price.toLocaleString("nb-NO")} ${p.currency}`}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingPrice(p)}
                                data-testid={`button-edit-price-${p.serviceKey}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={async () => {
                                  if (confirm(`Slett "${p.serviceName}"?`)) {
                                    await apiRequest("DELETE", `/api/prices/${p.id}`);
                                    queryClient.invalidateQueries({ queryKey: ["/api/prices"] });
                                  }
                                }}
                                data-testid={`button-delete-price-${p.serviceKey}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <PriceDialog
            key="add-price"
            open={addingPrice}
            onClose={() => setAddingPrice(false)}
            price={null}
          />
          {editingPrice && (
            <PriceDialog
              key={`edit-price-${editingPrice.id}`}
              open={true}
              onClose={() => setEditingPrice(null)}
              price={editingPrice}
            />
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Autosvar-maler fra Pureservice</CardTitle>
              <Button
                variant="outline"
                disabled={fetchingTemplates}
                onClick={async () => {
                  setFetchingTemplates(true);
                  try {
                    await apiRequest("POST", "/api/templates/fetch");
                    queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
                  } catch (e) {}
                  setFetchingTemplates(false);
                }}
                data-testid="button-fetch-templates"
              >
                {fetchingTemplates ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {responseTemplates && responseTemplates.length > 0 ? "Oppdater fra Pureservice" : "Hent fra Pureservice"}
              </Button>
            </CardHeader>
            <CardContent>
              {!responseTemplates || responseTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-templates">
                  Ingen autosvar-maler lastet ned ennå. Klikk &quot;Hent fra Pureservice&quot; for å laste ned.
                </p>
              ) : (
                <ScrollArea className="h-[500px]">
                  {Object.entries(
                    responseTemplates.reduce((acc: Record<string, ResponseTemplate[]>, t) => {
                      const cat = t.hjelpesenterCategory || "Ukategorisert";
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(t);
                      return acc;
                    }, {})
                  ).map(([category, templates]) => (
                    <div key={category} className="mb-4">
                      <h3 className="font-semibold text-sm mb-2 text-muted-foreground">{category} ({templates.length})</h3>
                      <div className="space-y-2">
                        {templates.map((t) => (
                          <div
                            key={t.id}
                            className="border rounded-md p-3 hover-elevate cursor-pointer"
                            data-testid={`template-row-${t.templateId}`}
                            onClick={() => setExpandedTemplate(expandedTemplate === t.id ? null : t.id)}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm" data-testid={`template-name-${t.templateId}`}>{t.name}</span>
                                {t.intent && <Badge variant="secondary">{t.intent}</Badge>}
                              </div>
                              <div className="flex items-center gap-2">
                                {t.hjelpesenterSubcategory && (
                                  <Badge variant="outline">{t.hjelpesenterSubcategory}</Badge>
                                )}
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              </div>
                            </div>
                            {t.ticketType && (
                              <p className="text-xs text-muted-foreground mt-1">Saktype: {t.ticketType}</p>
                            )}
                            {expandedTemplate === t.id && (
                              <div className="mt-3 pt-3 border-t space-y-2">
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Innhold:</p>
                                  <p className="text-sm whitespace-pre-wrap" data-testid={`template-body-${t.templateId}`}>
                                    {t.bodyText || "(Ingen tekst)"}
                                  </p>
                                </div>
                                {t.keyPoints && Array.isArray(t.keyPoints) && t.keyPoints.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1">Nøkkelpunkter:</p>
                                    <ul className="text-sm list-disc pl-4">
                                      {t.keyPoints.map((kp, i) => <li key={i}>{kp}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Totalt</CardTitle>
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-feedback-total">{feedbackStats?.total || 0}</div>
                  <p className="text-xs text-muted-foreground">interaksjoner logget</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Hjelpsomt</CardTitle>
                  <ThumbsUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600" data-testid="text-feedback-resolved">{feedbackStats?.resolved || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {feedbackStats && feedbackStats.total > 0 ? `${Math.round((feedbackStats.resolved / feedbackStats.total) * 100)}%` : "0%"} av totalt
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Delvis</CardTitle>
                  <MinusCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600" data-testid="text-feedback-partial">{feedbackStats?.partial || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {feedbackStats && feedbackStats.total > 0 ? `${Math.round((feedbackStats.partial / feedbackStats.total) * 100)}%` : "0%"} av totalt
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Ikke hjelpsomt</CardTitle>
                  <ThumbsDown className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600" data-testid="text-feedback-not-resolved">{feedbackStats?.notResolved || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {feedbackStats && feedbackStats.total > 0 ? `${Math.round((feedbackStats.notResolved / feedbackStats.total) * 100)}%` : "0%"} av totalt
                  </p>
                </CardContent>
              </Card>
            </div>

            {flaggedInteractions && flaggedInteractions.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base">Flagget for gjennomgang</CardTitle>
                  <Badge variant="destructive">
                    <Flag className="h-3 w-3 mr-1" />
                    {flaggedInteractions.length}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {flaggedInteractions.map((interaction) => (
                        <div key={interaction.id} className="border rounded-md p-3" data-testid={`flagged-interaction-${interaction.id}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline">{interaction.responseMethod || "ai"}</Badge>
                              {interaction.matchedIntent && <Badge variant="secondary">{interaction.matchedIntent}</Badge>}
                              {interaction.authenticated && <Badge variant="secondary">Innlogget</Badge>}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {interaction.createdAt ? new Date(interaction.createdAt).toLocaleString("nb-NO") : ""}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm"><span className="font-medium">Sp:</span> {interaction.userQuestion}</p>
                            <p className="text-sm text-muted-foreground"><span className="font-medium">Sv:</span> {interaction.botResponse.length > 200 ? interaction.botResponse.substring(0, 200) + "..." : interaction.botResponse}</p>
                            {interaction.feedbackComment && (
                              <p className="text-sm text-destructive"><span className="font-medium">Kommentar:</span> {interaction.feedbackComment}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {feedbackStats && Object.keys(feedbackStats.byIntent).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tilbakemelding per intent</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {Object.entries(feedbackStats.byIntent)
                        .sort((a, b) => b[1].total - a[1].total)
                        .map(([intent, stats]) => {
                          const successRate = stats.total > 0 ? Math.round(((stats.resolved) / stats.total) * 100) : 0;
                          return (
                            <div key={intent} className="flex items-center justify-between gap-2 p-2 rounded-md border" data-testid={`intent-stats-${intent}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{intent}</span>
                                <Badge variant="outline">{stats.total}</Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1">
                                  <ThumbsUp className="h-3 w-3 text-green-600" />
                                  <span className="text-xs">{stats.resolved}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MinusCircle className="h-3 w-3 text-yellow-600" />
                                  <span className="text-xs">{stats.partial}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <ThumbsDown className="h-3 w-3 text-red-600" />
                                  <span className="text-xs">{stats.notResolved}</span>
                                </div>
                                <Badge variant={successRate >= 70 ? "default" : successRate >= 40 ? "secondary" : "destructive"}>
                                  {successRate}%
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Siste interaksjoner</CardTitle>
              </CardHeader>
              <CardContent>
                {!recentInteractions || recentInteractions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen interaksjoner logget ennå.</p>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {recentInteractions.map((interaction) => (
                        <div key={interaction.id} className="border rounded-md p-3" data-testid={`interaction-${interaction.id}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline">{interaction.responseMethod || "ai"}</Badge>
                              {interaction.matchedIntent && <Badge variant="secondary">{interaction.matchedIntent}</Badge>}
                              {interaction.feedbackResult && (
                                <Badge variant={interaction.feedbackResult === "resolved" ? "default" : interaction.feedbackResult === "partial" ? "secondary" : "destructive"}>
                                  {interaction.feedbackResult === "resolved" ? "Hjelpsomt" : interaction.feedbackResult === "partial" ? "Delvis" : "Ikke hjelpsomt"}
                                </Badge>
                              )}
                              {interaction.responseTimeMs && (
                                <span className="text-xs text-muted-foreground">{interaction.responseTimeMs}ms</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {interaction.createdAt ? new Date(interaction.createdAt).toLocaleString("nb-NO") : ""}
                            </span>
                          </div>
                          <p className="text-sm truncate"><span className="font-medium">Sp:</span> {interaction.userQuestion}</p>
                          <p className="text-xs text-muted-foreground truncate"><span className="font-medium">Sv:</span> {interaction.botResponse}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="article-match" className="mt-4">
          <ArticleMatchTab
            stats={helpCenterMatchStats}
            matches={helpCenterMatches}
          />
        </TabsContent>

        <TabsContent value="autoreply-detect" className="mt-4">
          <AutoReplyDetectionTab stats={autoreplyStats} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ArticleMatchTab({ stats, matches }: {
  stats: {
    totalMatches: number;
    avgConfidence: number;
    highAlignment: number;
    mediumAlignment: number;
    lowAlignment: number;
    contradicts: number;
    followsProcedure: number;
    topArticles: { articleId: number; title: string; matchCount: number }[];
    commonMissing: string[];
  } | undefined;
  matches: {
    id: number;
    ticketId: number;
    articleId: number;
    matchConfidence: number;
    matchReason: string | null;
    followsOfficialProcedure: boolean | null;
    alignmentQuality: string | null;
    missingFromAgent: string[] | null;
    addedByAgent: string[] | null;
    createdAt: string | null;
  }[] | undefined;
}) {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow("/api/training/match-articles");

  const alignmentColor = (q: string | null) => {
    switch (q) {
      case "high": return "default";
      case "medium": return "secondary";
      case "low": return "outline";
      case "contradicts": return "destructive";
      default: return "outline";
    }
  };

  const alignmentLabel = (q: string | null) => {
    switch (q) {
      case "high": return "Fullt samsvar";
      case "medium": return "Delvis";
      case "low": return "Lavt samsvar";
      case "contradicts": return "Motstridende";
      default: return "Ukjent";
    }
  };

  const totalAligned = stats ? stats.highAlignment + stats.mediumAlignment + stats.lowAlignment + stats.contradicts : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="button-match-articles"
          onClick={() => {
            run();
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/training/help-center-match-stats"] });
              queryClient.invalidateQueries({ queryKey: ["/api/training/help-center-matches"] });
            }, 2000);
          }}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {isRunning ? "Matcher..." : "Kjør Artikkel-matching"}
        </Button>
        {isRunning && <Progress value={progress} className="flex-1 min-w-[200px]" />}
      </div>

      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {logs.length > 0 && (
        <ScrollArea className="h-[120px] border rounded-md p-2">
          {logs.map((l, i) => (
            <p key={i} className="text-xs text-muted-foreground">{l}</p>
          ))}
        </ScrollArea>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totalt matchet</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-match-total">{stats?.totalMatches || 0}</div>
            <p className="text-xs text-muted-foreground">tickets koblet til artikler</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Snitt confidence</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-match-confidence">
              {stats ? `${(stats.avgConfidence * 100).toFixed(0)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground">gjennomsnittlig match-score</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Følger prosedyre</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-match-follows">
              {stats?.followsProcedure || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats && stats.totalMatches > 0 ? `${Math.round((stats.followsProcedure / stats.totalMatches) * 100)}%` : "0%"} av matchede
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Motstridende</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-match-contradicts">
              {stats?.contradicts || 0}
            </div>
            <p className="text-xs text-muted-foreground">agent motsier offisiell prosedyre</p>
          </CardContent>
        </Card>
      </div>

      {totalAligned > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alignment-fordeling</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Fullt samsvar", value: stats?.highAlignment || 0, color: "bg-green-500" },
                { label: "Delvis", value: stats?.mediumAlignment || 0, color: "bg-yellow-500" },
                { label: "Lavt samsvar", value: stats?.lowAlignment || 0, color: "bg-orange-500" },
                { label: "Motstridende", value: stats?.contradicts || 0, color: "bg-red-500" },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-lg font-semibold">{item.value}</div>
                  <div className={`h-2 rounded-full ${item.color} mt-1`} style={{ width: `${totalAligned > 0 ? (item.value / totalAligned) * 100 : 0}%`, minWidth: item.value > 0 ? "8px" : "0" }} />
                  <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{totalAligned > 0 ? `${Math.round((item.value / totalAligned) * 100)}%` : "0%"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {stats?.topArticles && stats.topArticles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mest matchede artikler</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {stats.topArticles.map((art, i) => (
                    <div key={art.articleId} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`top-article-${art.articleId}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline">{i + 1}</Badge>
                        <span className="text-sm truncate">{art.title}</span>
                      </div>
                      <Badge>{art.matchCount}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {stats?.commonMissing && stats.commonMissing.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vanligste mangler i agent-svar</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                <div className="space-y-1.5">
                  {stats.commonMissing.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 border rounded-md">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-orange-500 shrink-0" />
                      <span className="text-sm">{item}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>

      {matches && matches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Siste match-resultater</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {matches.map((m) => (
                  <div key={m.id} className="border rounded-md p-3" data-testid={`match-${m.id}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline">Ticket #{m.ticketId}</Badge>
                        <Badge variant="outline">Artikkel #{m.articleId}</Badge>
                        <Badge variant={alignmentColor(m.alignmentQuality)}>{alignmentLabel(m.alignmentQuality)}</Badge>
                        {m.followsOfficialProcedure !== null && (
                          <Badge variant={m.followsOfficialProcedure ? "default" : "destructive"}>
                            {m.followsOfficialProcedure ? "Følger prosedyre" : "Avviker"}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-medium">{(m.matchConfidence * 100).toFixed(0)}%</span>
                    </div>
                    {m.matchReason && (
                      <p className="text-sm text-muted-foreground mt-1">{m.matchReason}</p>
                    )}
                    {m.missingFromAgent && m.missingFromAgent.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-xs font-medium text-orange-600 dark:text-orange-400">Mangler:</p>
                        <ul className="text-xs text-muted-foreground list-disc pl-4">
                          {m.missingFromAgent.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {m.addedByAgent && m.addedByAgent.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Tillegg fra agent:</p>
                        <ul className="text-xs text-muted-foreground list-disc pl-4">
                          {m.addedByAgent.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AutoReplyDetectionTab({ stats }: {
  stats: {
    totalAnalyzed: number;
    withAutoreply: number;
    withoutAutoreply: number;
    unanalyzed: number;
    avgConfidence: number;
    templateDistribution: { templateId: number; templateName: string; count: number }[];
    onlyAutoreply: number;
  } | undefined;
}) {
  const keywordWorkflow = useSSEWorkflow("/api/training/generate-keywords");
  const detectWorkflow = useSSEWorkflow("/api/training/detect-autoreply");

  const autoreplyRate = stats && stats.totalAnalyzed > 0
    ? Math.round((stats.withAutoreply / stats.totalAnalyzed) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="button-generate-keywords"
          onClick={() => keywordWorkflow.run()}
          disabled={keywordWorkflow.isRunning || detectWorkflow.isRunning}
          size="sm"
        >
          {keywordWorkflow.isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {keywordWorkflow.isRunning ? "Genererer keywords..." : "1. Generer keywords"}
        </Button>
        <Button
          data-testid="button-detect-autoreply"
          onClick={() => {
            detectWorkflow.run();
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/training/autoreply-stats"] });
            }, 2000);
          }}
          disabled={keywordWorkflow.isRunning || detectWorkflow.isRunning}
          size="sm"
        >
          {detectWorkflow.isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {detectWorkflow.isRunning ? "Gjenkjenner..." : "2. Kjør gjenkjenning"}
        </Button>
        {(keywordWorkflow.isRunning || detectWorkflow.isRunning) && (
          <Progress value={keywordWorkflow.isRunning ? keywordWorkflow.progress : detectWorkflow.progress} className="flex-1 min-w-[200px]" />
        )}
      </div>

      {(keywordWorkflow.error || detectWorkflow.error) && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{keywordWorkflow.error || detectWorkflow.error}</span>
        </div>
      )}

      {(keywordWorkflow.logs.length > 0 || detectWorkflow.logs.length > 0) && (
        <ScrollArea className="h-[120px] border rounded-md p-2">
          {[...keywordWorkflow.logs, ...detectWorkflow.logs].map((l, i) => (
            <p key={i} className="text-xs text-muted-foreground">{l}</p>
          ))}
        </ScrollArea>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyserte tickets</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-autoreply-analyzed">{stats?.totalAnalyzed || 0}</div>
            <p className="text-xs text-muted-foreground">{stats?.unanalyzed || 0} gjenstår</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Med autosvar</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-autoreply-with">{stats?.withAutoreply || 0}</div>
            <p className="text-xs text-muted-foreground">{autoreplyRate}% av analyserte</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Uten autosvar</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-autoreply-without">{stats?.withoutAutoreply || 0}</div>
            <p className="text-xs text-muted-foreground">{stats && stats.totalAnalyzed > 0 ? 100 - autoreplyRate : 0}% av analyserte</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kun autosvar</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="text-autoreply-only">{stats?.onlyAutoreply || 0}</div>
            <p className="text-xs text-muted-foreground">ingen menneskelig oppfølging</p>
          </CardContent>
        </Card>
      </div>

      {stats?.avgConfidence !== undefined && stats.totalAnalyzed > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snitt confidence (autosvar-match)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Progress value={stats.avgConfidence * 100} className="flex-1" />
              <span className="text-sm font-semibold">{(stats.avgConfidence * 100).toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {stats?.templateDistribution && stats.templateDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mest brukte autosvar-templates</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {stats.templateDistribution.map((item, i) => {
                  const pct = stats.withAutoreply > 0 ? Math.round((item.count / stats.withAutoreply) * 100) : 0;
                  return (
                    <div key={item.templateId} className="flex items-center gap-3 p-2 border rounded-md" data-testid={`autoreply-template-${item.templateId}`}>
                      <Badge variant="outline">{i + 1}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate font-medium">{item.templateName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={pct} className="flex-1 h-2" />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{item.count} ({pct}%)</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PriceDialog({ open, onClose, price }: { open: boolean; onClose: () => void; price: ServicePrice | null }) {
  const [serviceKey, setServiceKey] = useState(price?.serviceKey || "");
  const [serviceName, setServiceName] = useState(price?.serviceName || "");
  const [priceValue, setPriceValue] = useState(price?.price?.toString() || "");
  const [currency, setCurrency] = useState(price?.currency || "NOK");
  const [description, setDescription] = useState(price?.description || "");
  const [category, setCategory] = useState(price?.category || "");
  const [isActive, setIsActive] = useState(price?.isActive !== false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!price;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit && price) {
        await apiRequest("PATCH", `/api/prices/${price.id}`, {
          serviceName,
          price: parseFloat(priceValue),
          currency,
          description: description || null,
          category: category || null,
          isActive,
        });
      } else {
        await apiRequest("POST", "/api/prices", {
          serviceKey: serviceKey || serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          serviceName,
          price: parseFloat(priceValue),
          currency,
          description: description || null,
          category: category || null,
          isActive,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/prices"] });
      onClose();
    } catch (e) {}
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger pris" : "Legg til ny pris"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit && (
            <div>
              <Label>Nøkkel (unik ID)</Label>
              <Input
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
                placeholder="f.eks. eierskifte_hund"
                data-testid="input-price-key"
              />
            </div>
          )}
          <div>
            <Label>Tjenestenavn</Label>
            <Input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="f.eks. Eierskifte av kjæledyr"
              data-testid="input-price-name"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label>Pris</Label>
              <Input
                type="number"
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value)}
                placeholder="0"
                data-testid="input-price-value"
              />
            </div>
            <div className="w-24">
              <Label>Valuta</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger data-testid="select-price-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NOK">NOK</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Kategori</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="f.eks. Eierskifte, QR Brikke, Abonnement"
              data-testid="input-price-category"
            />
          </div>
          <div>
            <Label>Beskrivelse</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kort beskrivelse av tjenesten..."
              className="resize-none"
              data-testid="input-price-description"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              data-testid="switch-price-active"
            />
            <Label>Aktiv</Label>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !serviceName || !priceValue}
            className="w-full"
            data-testid="button-save-price"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? "Lagre endringer" : "Opprett pris"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
