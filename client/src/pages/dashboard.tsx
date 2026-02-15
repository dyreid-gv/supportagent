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
  Users,
  ArrowRight,
  Shuffle,
  Lightbulb,
  BarChart3,
  TrendingDown,
  ExternalLink,
  Globe,
  Monitor,
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
  hjelpesenterCategory: string | null;
  hjelpesenterSubcategory: string | null;
  keywords: string | null;
  primaryAction: string | null;
  primaryEndpoint: string | null;
  resolutionSteps: string | null;
  successIndicators: string | null;
  paymentRequiredProbability: number | null;
  autoCloseProbability: number | null;
  ticketCount: number;
  isActive: boolean;
  avgConfidence: number | null;
  hasAutoreplyAvailable: boolean | null;
  autoreplyTemplateName: string | null;
  autoreplyContent: string | null;
  typicalDialogPattern: string | null;
  avgMessagesAfterAutoreply: number | null;
  dialogPatternDistribution: Record<string, number> | null;
  wasReclassified: boolean | null;
  originalCategories: string[] | null;
  reclassifiedFrom: Record<string, number> | null;
  avgResolutionQuality: string | null;
  qualityDistribution: Record<string, number> | null;
  commonMissingElements: string[] | null;
  commonPositiveElements: string[] | null;
  needsImprovement: boolean | null;
  helpCenterArticleId: number | null;
  helpCenterArticleUrl: string | null;
  helpCenterArticleTitle: string | null;
  officialProcedure: string[] | null;
  helpCenterContentSummary: string | null;
  requiresLogin: boolean | null;
  requiresAction: boolean | null;
  actionType: string | null;
  apiEndpoint: string | null;
  httpMethod: string | null;
  requiredRuntimeDataArray: string[] | null;
  requiredRuntimeData: string | null;
  paymentRequired: boolean | null;
  paymentAmount: string | null;
  autoreplyTemplateId: number | null;
  chatbotSteps: string[] | null;
  combinedResponse: string | null;
  successfulResolutions: number | null;
  failedResolutions: number | null;
  totalUses: number | null;
  successRate: number | null;
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

interface MinsideFieldMapping {
  id: number;
  minsidePage: string;
  minsideField: string;
  fieldDescription: string;
  dataType: string;
  actionType: string;
  hjelpesenterCategory: string | null;
  intent: string | null;
  chatbotCapability: string | null;
  minsideUrl: string | null;
  adminNotes: string | null;
  isActive: boolean;
  updatedAt: string | null;
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
      queryClient.invalidateQueries({ queryKey: ["/api/training/dialog-pattern-stats"] });
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

function DialogPatternPipelineCard() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const steps = [
    { endpoint: "/api/training/generate-keywords", label: "Keywords" },
    { endpoint: "/api/training/detect-autoreply", label: "Autosvar" },
    { endpoint: "/api/training/analyze-dialog-patterns", label: "Mønstre" },
  ];

  const run = useCallback(async () => {
    setIsRunning(true);
    setCurrentStep(0);
    setProgress(0);
    setLogs([]);
    setError(null);

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        setCurrentStep(i + 1);
        setLogs(prev => [...prev, `--- Steg ${i + 1}/3: ${step.label} ---`]);
        const base = (i / steps.length) * 100;
        const weight = 100 / steps.length;

        await runSSEEndpoint(
          step.endpoint,
          (msg) => setLogs(prev => [...prev, msg]),
          (pct) => setProgress(Math.round(base + (pct / 100) * weight))
        );
      }
      setProgress(100);
      setLogs(prev => [...prev, "Alle 3 steg fullført!"]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRunning(false);
      queryClient.invalidateQueries({ queryKey: ["/api/training/autoreply-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/dialog-pattern-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
    }
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate font-mono text-xs">
            10
          </Badge>
          <Layers className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Dialog-analyse</CardTitle>
        </div>
        <Button
          data-testid="button-workflow-10"
          onClick={run}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? `${currentStep}/3...` : "Start"}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">Keywords + autosvar-gjenkjenning + dialog-mønstre (3 steg)</p>
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
                <p key={i} className={`text-xs font-mono ${log.startsWith("---") ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
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

  const { data: minsideMappings } = useQuery<MinsideFieldMapping[]>({
    queryKey: ["/api/minside-mappings"],
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

  const { data: dialogPatternStats } = useQuery<{
    total: number;
    unanalyzed: number;
    patterns: { pattern: string; count: number; avgMessages: number; avgTotal: number }[];
    byCategory: { category: string; pattern: string; count: number }[];
    problematic: { category: string; count: number }[];
  }>({
    queryKey: ["/api/training/dialog-pattern-stats"],
  });

  const { data: qualityStats } = useQuery<{
    total: number;
    unassessed: number;
    byQuality: { level: string; count: number; avgConfidence: number }[];
    byCategory: { category: string; level: string; count: number }[];
    byPattern: { pattern: string; level: string; count: number }[];
    missingElements: { element: string; count: number }[];
    problematic: { category: string; lowNoneCount: number; totalCount: number; pct: number }[];
    examples: { level: string; subject: string | null; reasoning: string | null; missingElements: string[] | null; positiveElements: string[] | null }[];
  }>({
    queryKey: ["/api/training/quality-stats"],
  });

  const { data: reclassStats } = useQuery<{
    totalGeneral: number;
    reclassified: number;
    remainGeneral: number;
    unprocessed: number;
    avgConfidence: number;
    byCategory: { category: string; subcategory: string | null; count: number; avgConfidence: number }[];
    trulyGeneral: { subject: string; reasoning: string }[];
  }>({
    queryKey: ["/api/training/reclassification-stats"],
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
            12-stegs treningspipeline for support-automatisering
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
          <TabsTrigger value="dialog-patterns" data-testid="tab-dialog-patterns">
            Dialog-mønstre ({dialogPatternStats?.total || 0})
          </TabsTrigger>
          <TabsTrigger value="reclassification" data-testid="tab-reclassification">
            Reklassifisering ({reclassStats?.reclassified || 0})
          </TabsTrigger>
          <TabsTrigger value="quality" data-testid="tab-quality">
            Kvalitet ({qualityStats?.total || 0})
          </TabsTrigger>
          <TabsTrigger value="minside-mappings" data-testid="tab-minside-mappings">
            Min Side-kobling ({minsideMappings?.length || 0})
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
            <DialogPatternPipelineCard />
            <WorkflowCard
              step={11}
              title="Reklassifisering"
              description="Reklassifiser 'Generell e-post' til korrekte standardkategorier via AI"
              endpoint="/api/training/reclassify"
              icon={Shuffle}
            />
            <WorkflowCard
              step={12}
              title="Kvalitetsvurdering"
              description="Vurder løsningskvalitet (HIGH/MEDIUM/LOW/NONE) med AI-analyse av svar"
              endpoint="/api/training/assess-quality"
              icon={BarChart3}
            />
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
          <PlaybookTab playbook={playbook} />
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

        <TabsContent value="dialog-patterns" className="mt-4">
          <DialogPatternTab stats={dialogPatternStats} />
        </TabsContent>

        <TabsContent value="reclassification" className="mt-4">
          <ReclassificationTab stats={reclassStats} />
        </TabsContent>

        <TabsContent value="quality" className="mt-4">
          <QualityTab stats={qualityStats} />
        </TabsContent>

        <TabsContent value="minside-mappings" className="mt-4">
          <MinsideMappingsTab mappings={minsideMappings || []} />
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

const PATTERN_LABELS: Record<string, { label: string; color: string; icon: typeof AlertTriangle }> = {
  autosvar_only: { label: "Kun autosvar", color: "text-red-600", icon: AlertTriangle },
  autosvar_quick_resolution: { label: "Rask løsning", color: "text-green-600", icon: CheckCircle },
  autosvar_extended_dialog: { label: "Utvidet dialog", color: "text-yellow-600", icon: MessageSquare },
  direct_human_response: { label: "Direkte menneskelig", color: "text-blue-600", icon: Users },
};

function runSSEEndpoint(
  endpoint: string,
  onLog: (msg: string) => void,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const reader = response.body?.getReader();
      if (!reader) { reject(new Error("No reader")); return; }
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
              if (data.message) onLog(data.message);
              if (data.progress !== undefined) onProgress(data.progress);
              if (data.error) { reject(new Error(data.error)); return; }
            } catch {}
          }
        }
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

const SEQUENCE_STEPS = [
  { endpoint: "/api/training/generate-keywords", label: "Steg 1/3: Genererer keywords for maler..." },
  { endpoint: "/api/training/detect-autoreply", label: "Steg 2/3: Gjenkjenner autosvar i tickets..." },
  { endpoint: "/api/training/analyze-dialog-patterns", label: "Steg 3/3: Klassifiserer dialog-mønstre..." },
];

function DialogPatternTab({ stats }: {
  stats: {
    total: number;
    unanalyzed: number;
    patterns: { pattern: string; count: number; avgMessages: number; avgTotal: number }[];
    byCategory: { category: string; pattern: string; count: number }[];
    problematic: { category: string; count: number }[];
  } | undefined;
}) {
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqStep, setSeqStep] = useState(0);
  const [seqProgress, setSeqProgress] = useState(0);
  const [seqLogs, setSeqLogs] = useState<string[]>([]);
  const [seqError, setSeqError] = useState<string | null>(null);

  const runFullSequence = useCallback(async () => {
    setSeqRunning(true);
    setSeqStep(0);
    setSeqProgress(0);
    setSeqLogs([]);
    setSeqError(null);

    try {
      for (let i = 0; i < SEQUENCE_STEPS.length; i++) {
        const step = SEQUENCE_STEPS[i];
        setSeqStep(i + 1);
        setSeqLogs(prev => [...prev, `--- ${step.label} ---`]);
        const baseProgress = (i / SEQUENCE_STEPS.length) * 100;
        const stepWeight = 100 / SEQUENCE_STEPS.length;

        await runSSEEndpoint(
          step.endpoint,
          (msg) => setSeqLogs(prev => [...prev, msg]),
          (pct) => setSeqProgress(Math.round(baseProgress + (pct / 100) * stepWeight))
        );

        queryClient.invalidateQueries({ queryKey: ["/api/training/autoreply-stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/training/dialog-pattern-stats"] });
      }
      setSeqProgress(100);
      setSeqLogs(prev => [...prev, "Fullført! Alle 3 steg er kjørt."]);
    } catch (err: any) {
      setSeqError(err.message);
    } finally {
      setSeqRunning(false);
      queryClient.invalidateQueries({ queryKey: ["/api/training/autoreply-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/dialog-pattern-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
    }
  }, []);

  const getPatternCount = (p: string) => stats?.patterns.find(x => x.pattern === p)?.count || 0;
  const getPatternAvg = (p: string) => stats?.patterns.find(x => x.pattern === p)?.avgMessages || 0;

  const categories = stats?.byCategory ? Array.from(new Set(stats.byCategory.map(b => b.category))) : [];
  const categoryRows = categories.map(cat => {
    const rows = stats!.byCategory.filter(b => b.category === cat);
    const patternCounts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      patternCounts[r.pattern] = r.count;
      total += r.count;
    }
    return { category: cat, patternCounts, total };
  }).sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="button-run-full-sequence"
          onClick={runFullSequence}
          disabled={seqRunning}
          size="sm"
        >
          {seqRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {seqRunning ? `Kjører steg ${seqStep}/3...` : "Kjør full analyse (3 steg)"}
        </Button>
        {stats?.unanalyzed !== undefined && stats.unanalyzed > 0 && (
          <Badge variant="secondary">{stats.unanalyzed} uanalyserte</Badge>
        )}
        {seqRunning && (
          <Progress value={seqProgress} className="flex-1 min-w-[200px]" />
        )}
      </div>

      {seqRunning && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          <span>{SEQUENCE_STEPS[seqStep - 1]?.label}</span>
        </div>
      )}

      {seqError && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{seqError}</span>
        </div>
      )}

      {seqLogs.length > 0 && (
        <ScrollArea className="h-[160px] border rounded-md p-2">
          {seqLogs.map((l: string, i: number) => (
            <p key={i} className={`text-xs ${l.startsWith("---") ? "font-semibold text-foreground mt-1" : "text-muted-foreground"}`}>{l}</p>
          ))}
        </ScrollArea>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kun autosvar</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-pattern-autosvar-only">{getPatternCount('autosvar_only')}</div>
            <p className="text-xs text-muted-foreground">Ingen menneskelig oppfølging</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rask løsning</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-pattern-quick">{getPatternCount('autosvar_quick_resolution')}</div>
            <p className="text-xs text-muted-foreground">Snitt {getPatternAvg('autosvar_quick_resolution')} meldinger etter autosvar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utvidet dialog</CardTitle>
            <MessageSquare className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-pattern-extended">{getPatternCount('autosvar_extended_dialog')}</div>
            <p className="text-xs text-muted-foreground">Snitt {getPatternAvg('autosvar_extended_dialog')} meldinger etter autosvar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Direkte menneskelig</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" data-testid="text-pattern-direct">{getPatternCount('direct_human_response')}</div>
            <p className="text-xs text-muted-foreground">God personlig service</p>
          </CardContent>
        </Card>
      </div>

      {stats && stats.total > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fordeling av dialog-mønstre</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.patterns.map(p => {
                const info = PATTERN_LABELS[p.pattern] || { label: p.pattern, color: "", icon: FileText };
                const pct = stats.total > 0 ? (p.count / stats.total) * 100 : 0;
                return (
                  <div key={p.pattern} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <info.icon className={`h-4 w-4 ${info.color}`} />
                        <span className="text-sm font-medium">{info.label}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{p.count} ({pct.toFixed(1)}%) - snitt {p.avgTotal.toFixed(1)} meldinger totalt</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {categoryRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per kategori</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-medium">Kategori</th>
                        <th className="text-right py-2 px-2 font-medium text-red-600">Kun auto</th>
                        <th className="text-right py-2 px-2 font-medium text-green-600">Rask</th>
                        <th className="text-right py-2 px-2 font-medium text-yellow-600">Utvidet</th>
                        <th className="text-right py-2 px-2 font-medium text-blue-600">Direkte</th>
                        <th className="text-right py-2 pl-2 font-medium">Totalt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-4 max-w-[200px] truncate">{row.category}</td>
                          <td className="text-right py-2 px-2">{row.patternCounts.autosvar_only || 0}</td>
                          <td className="text-right py-2 px-2">{row.patternCounts.autosvar_quick_resolution || 0}</td>
                          <td className="text-right py-2 px-2">{row.patternCounts.autosvar_extended_dialog || 0}</td>
                          <td className="text-right py-2 px-2">{row.patternCounts.direct_human_response || 0}</td>
                          <td className="text-right py-2 pl-2 font-semibold">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {stats.problematic.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Problematiske saker (kun autosvar)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">Disse sakene fikk kun autosvar uten menneskelig oppfølging</p>
                {stats.problematic.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
                    <span className="text-sm">{p.category}</span>
                    <Badge variant="destructive">{p.count} tickets</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {(!stats || stats.total === 0) && !seqRunning && (
        <Card>
          <CardContent className="py-8 text-center">
            <Layers className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Ingen dialog-mønstre analysert ennå. Klikk "Kjør full analyse" for å kjøre alle 3 steg automatisk.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReclassificationTab({ stats }: {
  stats: {
    totalGeneral: number;
    reclassified: number;
    remainGeneral: number;
    unprocessed: number;
    avgConfidence: number;
    byCategory: { category: string; subcategory: string | null; count: number; avgConfidence: number }[];
    trulyGeneral: { subject: string; reasoning: string }[];
  } | undefined;
}) {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow("/api/training/reclassify");

  const totalProcessed = (stats?.reclassified || 0) + (stats?.remainGeneral || 0);
  const pctReclassified = totalProcessed > 0 ? ((stats?.reclassified || 0) / totalProcessed * 100).toFixed(1) : "0";

  const topCategory = stats?.byCategory?.[0]?.category || "-";
  const topCategoryCount = stats?.byCategory?.[0]?.count || 0;
  const secondCategory = stats?.byCategory?.[1]?.category;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="button-run-reclassify"
          onClick={() => {
            run();
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/training/reclassification-stats"] });
            }, 3000);
          }}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          {isRunning ? "Reklassifiserer..." : "Kjør reklassifisering"}
        </Button>
        {stats?.unprocessed !== undefined && stats.unprocessed > 0 && (
          <Badge variant="secondary">{stats.unprocessed} ubehandlet</Badge>
        )}
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
            <CardTitle className="text-sm font-medium">Generelle funnet</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-reclass-total">{stats?.totalGeneral || 0}</div>
            <p className="text-xs text-muted-foreground">tickets kategorisert som generell</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reklassifisert</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-reclass-done">{stats?.reclassified || 0}</div>
            <p className="text-xs text-muted-foreground">{pctReclassified}% av behandlede</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Forblir generell</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-reclass-remain">{stats?.remainGeneral || 0}</div>
            <p className="text-xs text-muted-foreground">virkelig generelle henvendelser</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Snitt confidence</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-reclass-confidence">
              {stats?.avgConfidence ? `${(stats.avgConfidence * 100).toFixed(0)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground">gjennomsnittlig AI-sikkerhet</p>
          </CardContent>
        </Card>
      </div>

      {stats && stats.byCategory.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reklassifiserings-fordeling</CardTitle>
              <p className="text-xs text-muted-foreground">Hva "Generell e-post" faktisk inneholder</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.byCategory.map((cat) => {
                const pct = stats.reclassified > 0 ? (cat.count / stats.reclassified) * 100 : 0;
                return (
                  <div key={`${cat.category}-${cat.subcategory}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{cat.category}</span>
                        {cat.subcategory && (
                          <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-xs">{cat.subcategory}</Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {cat.count} tickets ({pct.toFixed(1)}%) - snitt {(cat.avgConfidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {topCategory !== "-" && (
            <Card className="border-primary/30">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Innsikt</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {pctReclassified}% av "Generell e-post" handler egentlig om spesifikke temaer.
                      Topp-kategori: <span className="font-medium text-foreground">{topCategory}</span> ({topCategoryCount} tickets)
                      {secondCategory && <>, etterfulgt av <span className="font-medium text-foreground">{secondCategory}</span></>}.
                      Forbedr routing ved å legge til relevante nøkkelord i e-post-parser for automatisk kategorisering.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {stats && stats.trulyGeneral.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Virkelig generelle henvendelser
            </CardTitle>
            <p className="text-xs text-muted-foreground">Disse kunne ikke reklassifiseres (confidence &lt; 0.6)</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.trulyGeneral.map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.subject || "Uten emne"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(!stats || (stats.totalGeneral === 0 && stats.reclassified === 0)) && !isRunning && (
        <Card>
          <CardContent className="py-8 text-center">
            <Shuffle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Ingen reklassifiseringsdata ennå. Kjør kategori-mapping (steg 3) først, og deretter reklassifisering for å analysere generelle tickets.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QualityTab({ stats }: {
  stats: {
    total: number;
    unassessed: number;
    byQuality: { level: string; count: number; avgConfidence: number }[];
    byCategory: { category: string; level: string; count: number }[];
    byPattern: { pattern: string; level: string; count: number }[];
    missingElements: { element: string; count: number }[];
    problematic: { category: string; lowNoneCount: number; totalCount: number; pct: number }[];
    examples: { level: string; subject: string | null; reasoning: string | null; missingElements: string[] | null; positiveElements: string[] | null }[];
  } | undefined;
}) {
  const { isRunning, progress, logs, error, run } = useSSEWorkflow("/api/training/assess-quality");
  const [showExamples, setShowExamples] = useState<string | null>(null);

  const levelInfo: Record<string, { label: string; color: string; textColor: string }> = {
    high: { label: "Utmerket", color: "text-green-500", textColor: "text-green-600" },
    medium: { label: "OK", color: "text-yellow-500", textColor: "text-yellow-600" },
    low: { label: "Dårlig", color: "text-orange-500", textColor: "text-orange-600" },
    none: { label: "Ingen", color: "text-red-500", textColor: "text-red-600" },
  };

  const getQualityCount = (level: string) => stats?.byQuality?.find(q => q.level === level)?.count || 0;
  const totalAssessed = stats?.total || 0;
  const getPct = (level: string) => totalAssessed > 0 ? ((getQualityCount(level) / totalAssessed) * 100).toFixed(1) : "0";

  const categoryRows = () => {
    if (!stats?.byCategory?.length) return [];
    const catMap: Record<string, Record<string, number>> = {};
    for (const item of stats.byCategory) {
      if (!catMap[item.category]) catMap[item.category] = {};
      catMap[item.category][item.level] = item.count;
    }
    return Object.entries(catMap).map(([cat, levels]) => {
      const total = Object.values(levels).reduce((a, b) => a + b, 0);
      return {
        category: cat,
        high: levels.high || 0,
        medium: levels.medium || 0,
        low: levels.low || 0,
        none: levels.none || 0,
        total,
        highPct: total > 0 ? Math.round(((levels.high || 0) / total) * 100) : 0,
        lowNonePct: total > 0 ? Math.round((((levels.low || 0) + (levels.none || 0)) / total) * 100) : 0,
      };
    }).sort((a, b) => b.total - a.total);
  };

  const patternRows = () => {
    if (!stats?.byPattern?.length) return [];
    const patMap: Record<string, Record<string, number>> = {};
    for (const item of stats.byPattern) {
      if (!patMap[item.pattern]) patMap[item.pattern] = {};
      patMap[item.pattern][item.level] = item.count;
    }
    return Object.entries(patMap).map(([pattern, levels]) => {
      const total = Object.values(levels).reduce((a, b) => a + b, 0);
      return {
        pattern,
        high: levels.high || 0,
        medium: levels.medium || 0,
        low: levels.low || 0,
        none: levels.none || 0,
        total,
      };
    }).sort((a, b) => b.total - a.total);
  };

  const patternLabel: Record<string, string> = {
    autosvar_only: "Kun autosvar",
    autosvar_quick_resolution: "Rask løsning",
    autosvar_extended_dialog: "Utvidet dialog",
    direct_human_response: "Direkte svar",
  };

  const examplesForLevel = (level: string) => stats?.examples?.filter(e => e.level === level) || [];

  const highCount = getQualityCount("high");
  const mediumCount = getQualityCount("medium");
  const lowNoneCount = getQualityCount("low") + getQualityCount("none");
  const bestCategory = categoryRows().sort((a, b) => b.highPct - a.highPct)[0];
  const worstCategory = categoryRows().sort((a, b) => b.lowNonePct - a.lowNonePct)[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="button-run-quality"
          onClick={() => {
            run();
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/training/quality-stats"] });
            }, 3000);
          }}
          disabled={isRunning}
          size="sm"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          {isRunning ? "Vurderer..." : "Kjør kvalitetsvurdering"}
        </Button>
        {stats?.unassessed !== undefined && stats.unassessed > 0 && (
          <Badge variant="secondary">{stats.unassessed} uvurdert</Badge>
        )}
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

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totalt vurdert</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-quality-total">{totalAssessed}</div>
            <p className="text-xs text-muted-foreground">tickets kvalitetsvurdert</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">HIGH</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-quality-high">{highCount}</div>
            <p className="text-xs text-muted-foreground">{getPct("high")}% - utmerket løsning</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MEDIUM</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-quality-medium">{mediumCount}</div>
            <p className="text-xs text-muted-foreground">{getPct("medium")}% - ok løsning</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">LOW</CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="text-quality-low">{getQualityCount("low")}</div>
            <p className="text-xs text-muted-foreground">{getPct("low")}% - dårlig løsning</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">NONE</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-quality-none">{getQualityCount("none")}</div>
            <p className="text-xs text-muted-foreground">{getPct("none")}% - ingen løsning</p>
          </CardContent>
        </Card>
      </div>

      {totalAssessed > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kvalitetsfordeling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {["high", "medium", "low", "none"].map(level => {
                const pct = parseFloat(getPct(level));
                const info = levelInfo[level];
                return (
                  <div key={level} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${info.textColor}`}>{info.label} ({level.toUpperCase()})</span>
                      <span className="text-sm text-muted-foreground">{getQualityCount(level)} tickets ({pct}%)</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {categoryRows().length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Kvalitet per kategori</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4">Kategori</th>
                        <th className="text-right py-2 px-2 text-green-600">HIGH</th>
                        <th className="text-right py-2 px-2 text-yellow-600">MED</th>
                        <th className="text-right py-2 px-2 text-orange-600">LOW</th>
                        <th className="text-right py-2 px-2 text-red-600">NONE</th>
                        <th className="text-right py-2 pl-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows().map(row => (
                        <tr key={row.category} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">{row.category}</td>
                          <td className="text-right py-2 px-2 text-green-600">{row.high}</td>
                          <td className="text-right py-2 px-2 text-yellow-600">{row.medium}</td>
                          <td className="text-right py-2 px-2 text-orange-600">{row.low}</td>
                          <td className="text-right py-2 px-2 text-red-600">{row.none}</td>
                          <td className="text-right py-2 pl-2 text-muted-foreground">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {patternRows().length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Kvalitet per dialog-mønster</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4">Mønster</th>
                        <th className="text-right py-2 px-2 text-green-600">HIGH</th>
                        <th className="text-right py-2 px-2 text-yellow-600">MED</th>
                        <th className="text-right py-2 px-2 text-orange-600">LOW</th>
                        <th className="text-right py-2 px-2 text-red-600">NONE</th>
                        <th className="text-right py-2 pl-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patternRows().map(row => {
                        const total = row.total;
                        const nonePct = total > 0 ? Math.round((row.none / total) * 100) : 0;
                        return (
                          <tr key={row.pattern} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">
                              {patternLabel[row.pattern] || row.pattern}
                              {nonePct > 50 && <Badge variant="destructive" className="ml-2 text-xs">Problematisk</Badge>}
                            </td>
                            <td className="text-right py-2 px-2 text-green-600">{row.high}</td>
                            <td className="text-right py-2 px-2 text-yellow-600">{row.medium}</td>
                            <td className="text-right py-2 px-2 text-orange-600">{row.low}</td>
                            <td className="text-right py-2 px-2 text-red-600">{row.none}</td>
                            <td className="text-right py-2 pl-2 text-muted-foreground">{total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {stats?.missingElements && stats.missingElements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vanligste mangler</CardTitle>
                <p className="text-xs text-muted-foreground">Hva som oftest mangler i support-svar</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.missingElements.slice(0, 10).map((item, i) => {
                  const maxCount = stats.missingElements[0]?.count || 1;
                  const pct = (item.count / maxCount) * 100;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm">{item.element}</span>
                        <span className="text-sm text-muted-foreground">{item.count} tickets</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {stats?.problematic && stats.problematic.length > 0 && (
            <div className="space-y-2">
              {stats.problematic.filter(p => p.pct >= 25).map((item, i) => (
                <Card key={i} className="border-destructive/30">
                  <CardContent className="py-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Advarsel: {item.category}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {item.pct}% av tickets har LOW/NONE kvalitet ({item.lowNoneCount} av {item.totalCount})
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {(highCount > 0 || lowNoneCount > 0) && (
            <Card className="border-primary/30">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Innsikt</p>
                    <div className="text-sm text-muted-foreground mt-1 space-y-1">
                      <p>{getPct("high")}% av saker har utmerket løsning (HIGH), {getPct("none")}% fikk ingen løsning.</p>
                      {bestCategory && bestCategory.highPct > 0 && (
                        <p>Beste kategori: <span className="font-medium text-foreground">{bestCategory.category}</span> ({bestCategory.highPct}% HIGH)</p>
                      )}
                      {worstCategory && worstCategory.lowNonePct > 0 && (
                        <p>Trenger forbedring: <span className="font-medium text-foreground">{worstCategory.category}</span> ({worstCategory.lowNonePct}% LOW/NONE)</p>
                      )}
                      {stats?.missingElements?.[0] && (
                        <p>Vanligste mangel: <span className="font-medium text-foreground">{stats.missingElements[0].element}</span> ({stats.missingElements[0].count} tickets)</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eksempler per kvalitetsnivå</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {["high", "medium", "low", "none"].map(level => {
                const info = levelInfo[level];
                const examples = examplesForLevel(level);
                if (examples.length === 0) return null;
                const isOpen = showExamples === level;
                return (
                  <div key={level} className="border rounded-md">
                    <button
                      data-testid={`button-toggle-examples-${level}`}
                      className="w-full flex items-center justify-between gap-2 p-3 text-left"
                      onClick={() => setShowExamples(isOpen ? null : level)}
                    >
                      <span className={`text-sm font-medium ${info.textColor}`}>{info.label} ({level.toUpperCase()}) - {examples.length} eksempler</span>
                      <ArrowRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-3">
                        {examples.map((ex, i) => (
                          <div key={i} className="border-t pt-2 space-y-1">
                            <p className="text-sm font-medium">{ex.subject || "Uten emne"}</p>
                            <p className="text-xs text-muted-foreground">{ex.reasoning}</p>
                            {ex.positiveElements && ex.positiveElements.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {ex.positiveElements.map((elem, j) => (
                                  <Badge key={j} variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate text-green-600">{elem}</Badge>
                                ))}
                              </div>
                            )}
                            {ex.missingElements && ex.missingElements.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {ex.missingElements.map((elem, j) => (
                                  <Badge key={j} variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate text-red-600">{elem}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {totalAssessed === 0 && !isRunning && (
        <Card>
          <CardContent className="py-8 text-center">
            <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Ingen kvalitetsvurderinger ennå. Kjør GDPR-skrubbing og kategori-mapping først, deretter kvalitetsvurdering.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PlaybookTab({ playbook }: { playbook: PlaybookEntry[] | undefined }) {
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("");

  const qualityColor: Record<string, string> = {
    high: "text-green-600 dark:text-green-400",
    medium: "text-yellow-600 dark:text-yellow-400",
    low: "text-orange-600 dark:text-orange-400",
    none: "text-red-600 dark:text-red-400",
  };
  const qualityLabel: Record<string, string> = {
    high: "HIGH",
    medium: "MED",
    low: "LOW",
    none: "NONE",
  };
  const patternLabel: Record<string, string> = {
    autosvar_only: "Kun autosvar",
    autosvar_quick_resolution: "Rask losning",
    autosvar_extended_dialog: "Utvidet dialog",
    direct_human_response: "Direkte svar",
  };

  const filtered = playbook?.filter(e => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return e.intent.toLowerCase().includes(q)
      || e.hjelpesenterCategory?.toLowerCase().includes(q)
      || e.keywords?.toLowerCase().includes(q);
  }) || [];

  const withQuality = filtered.filter(e => e.avgResolutionQuality);
  const needsImprovementCount = filtered.filter(e => e.needsImprovement).length;
  const withAutoreply = filtered.filter(e => e.hasAutoreplyAvailable).length;
  const withHelpCenter = filtered.filter(e => e.helpCenterArticleTitle).length;
  const withFeedback = filtered.filter(e => (e.totalUses || 0) > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Sok etter intent, kategori, nokkelord..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-sm"
          data-testid="input-playbook-filter"
        />
        <Badge variant="outline">{filtered.length} entries</Badge>
        {withQuality.length > 0 && <Badge variant="secondary">{withQuality.length} kvalitetsvurdert</Badge>}
        {needsImprovementCount > 0 && <Badge variant="destructive">{needsImprovementCount} trenger forbedring</Badge>}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totalt</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-playbook-total">{filtered.length}</div>
            <p className="text-xs text-muted-foreground">playbook entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Autosvar</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withAutoreply}</div>
            <p className="text-xs text-muted-foreground">har autosvar-mal</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hjelpesenter</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withHelpCenter}</div>
            <p className="text-xs text-muted-foreground">koblet til artikkel</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tilbakemelding</CardTitle>
            <ThumbsUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withFeedback}</div>
            <p className="text-xs text-muted-foreground">har feedback-data</p>
          </CardContent>
        </Card>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Ingen playbook-entries. Kjor treningspipelinen (steg 1-8) for a generere.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-3 pr-4">
            {filtered.map((entry) => {
              const isExpanded = expandedEntry === entry.id;
              return (
                <div
                  key={entry.id}
                  className="rounded-md border"
                  data-testid={`playbook-entry-${entry.id}`}
                >
                  <button
                    className="w-full p-3 text-left space-y-2"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                    data-testid={`button-toggle-playbook-${entry.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{entry.intent}</span>
                        {entry.hjelpesenterCategory && <Badge variant="secondary">{entry.hjelpesenterCategory}</Badge>}
                        {entry.hjelpesenterSubcategory && <Badge variant="outline">{entry.hjelpesenterSubcategory}</Badge>}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {entry.avgResolutionQuality && (
                          <Badge variant={entry.avgResolutionQuality === "high" ? "default" : entry.avgResolutionQuality === "medium" ? "secondary" : "destructive"}>
                            {qualityLabel[entry.avgResolutionQuality] || entry.avgResolutionQuality}
                          </Badge>
                        )}
                        {entry.needsImprovement && <Badge variant="destructive">Trenger forbedring</Badge>}
                        {entry.hasAutoreplyAvailable && <Badge variant="outline">Autosvar</Badge>}
                        {entry.helpCenterArticleTitle && <Badge variant="outline">Artikkel</Badge>}
                        {(entry.paymentRequired || (entry.paymentRequiredProbability && entry.paymentRequiredProbability > 0.5)) && (
                          <Badge variant="destructive">Betaling</Badge>
                        )}
                        <Badge variant="outline">{entry.ticketCount} tickets</Badge>
                        <ArrowRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </div>
                    </div>
                    {entry.primaryAction && (
                      <p className="text-xs text-muted-foreground">Handling: {entry.primaryAction}</p>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t space-y-3">
                      <div className="grid gap-3 md:grid-cols-2 mt-3">
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Losning</h4>
                          {entry.resolutionSteps && <p className="text-sm">{entry.resolutionSteps}</p>}
                          {entry.keywords && <p className="text-xs text-muted-foreground">Nokkelord: {entry.keywords}</p>}
                          {entry.officialProcedure && entry.officialProcedure.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Offisiell prosedyre:</p>
                              <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
                                {entry.officialProcedure.map((step, j) => <li key={j}>{step}</li>)}
                              </ol>
                            </div>
                          )}
                          {(entry.primaryEndpoint || entry.apiEndpoint) && (
                            <p className="text-xs font-mono text-muted-foreground" data-testid={`text-endpoint-${entry.id}`}>{entry.httpMethod || "POST"} {entry.primaryEndpoint || entry.apiEndpoint}</p>
                          )}
                          {entry.actionType && entry.actionType !== "INFO_ONLY" && (
                            <Badge variant="outline">{entry.actionType}</Badge>
                          )}
                          {entry.requiredRuntimeDataArray && entry.requiredRuntimeDataArray.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-xs text-muted-foreground">Krever:</span>
                              {entry.requiredRuntimeDataArray.map((d, j) => (
                                <Badge key={j} variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">{d}</Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Kvalitet (D)</h4>
                          {entry.avgResolutionQuality ? (
                            <>
                              <p className={`text-sm font-medium ${qualityColor[entry.avgResolutionQuality] || ""}`}>
                                Gjennomsnittlig: {qualityLabel[entry.avgResolutionQuality] || entry.avgResolutionQuality}
                              </p>
                              {entry.qualityDistribution && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  {Object.entries(entry.qualityDistribution).map(([level, pct]) => (
                                    <span key={level} className={`text-xs ${qualityColor[level] || ""}`}>
                                      {qualityLabel[level] || level}: {typeof pct === "number" ? Math.round(pct * 100) : pct}%
                                    </span>
                                  ))}
                                </div>
                              )}
                              {entry.commonMissingElements && entry.commonMissingElements.length > 0 && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">Mangler ofte:</p>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {entry.commonMissingElements.map((elem, j) => (
                                      <Badge key={j} variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate text-red-600 dark:text-red-400">{elem}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {entry.commonPositiveElements && entry.commonPositiveElements.length > 0 && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">Fungerer bra:</p>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {entry.commonPositiveElements.map((elem, j) => (
                                      <Badge key={j} variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate text-green-600 dark:text-green-400">{elem}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Ikke vurdert enna</p>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Autosvar (A)</h4>
                          {entry.hasAutoreplyAvailable ? (
                            <>
                              <p className="text-sm">{entry.autoreplyTemplateName}</p>
                              {entry.autoreplyContent && (
                                <p className="text-xs text-muted-foreground line-clamp-3">{entry.autoreplyContent}</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Ingen autosvar</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Dialog-monster (B)</h4>
                          {entry.typicalDialogPattern ? (
                            <>
                              <Badge variant="secondary">{patternLabel[entry.typicalDialogPattern] || entry.typicalDialogPattern}</Badge>
                              {entry.avgMessagesAfterAutoreply != null && (
                                <p className="text-xs text-muted-foreground">Snitt meldinger etter autosvar: {entry.avgMessagesAfterAutoreply.toFixed(1)}</p>
                              )}
                              {entry.dialogPatternDistribution && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  {Object.entries(entry.dialogPatternDistribution).map(([p, pct]) => (
                                    <span key={p} className="text-xs text-muted-foreground">
                                      {patternLabel[p] || p}: {typeof pct === "number" ? Math.round(pct * 100) : pct}%
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Ikke analysert</p>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Hjelpesenter</h4>
                          {entry.helpCenterArticleTitle ? (
                            <>
                              <div className="flex items-center gap-1">
                                <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                                {entry.helpCenterArticleUrl ? (
                                  <a href={entry.helpCenterArticleUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline hover:no-underline flex items-center gap-1" data-testid={`link-helpcenter-${entry.id}`}>
                                    {entry.helpCenterArticleTitle}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-sm">{entry.helpCenterArticleTitle}</span>
                                )}
                              </div>
                              {entry.helpCenterContentSummary && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{entry.helpCenterContentSummary}</p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Ingen artikkel koblet</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Feedback</h4>
                          {(entry.totalUses || 0) > 0 ? (
                            <>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium" data-testid={`text-successrate-${entry.id}`}>{Math.round((entry.successRate || 0) * 100)}% suksessrate</span>
                                <span className="text-xs text-muted-foreground">({entry.totalUses} bruk)</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-green-600 dark:text-green-400" data-testid={`text-success-${entry.id}`}>{entry.successfulResolutions || 0} lost</span>
                                <span className="text-xs text-red-600 dark:text-red-400" data-testid={`text-failed-${entry.id}`}>{entry.failedResolutions || 0} ikke lost</span>
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Ingen bruksdata enna</p>
                          )}
                        </div>
                      </div>

                      {entry.wasReclassified && (
                        <div className="space-y-1">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Reklassifisering (C)</h4>
                          {entry.originalCategories && entry.originalCategories.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Opprinnelig kategori: {entry.originalCategories.join(", ")}
                            </p>
                          )}
                        </div>
                      )}

                      {entry.combinedResponse && (
                        <div className="space-y-1">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Kombinert chatbot-respons</h4>
                          <div className="bg-muted/50 rounded-md p-2">
                            <p className="text-sm whitespace-pre-line">{entry.combinedResponse}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

const ACTION_TYPES = [
  { value: "display", label: "Vis data", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "identify", label: "Identifiser", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  { value: "execute", label: "Utfør handling", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "guide", label: "Veilede", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
];

const DATA_TYPES = [
  { value: "read", label: "Les (read-only)" },
  { value: "write", label: "Skriv (action)" },
];

interface IntentDef {
  intent: string;
  category: string;
  subcategory: string;
  description: string;
}

function MinsideMappingsTab({ mappings }: { mappings: MinsideFieldMapping[] }) {
  const { data: intentData } = useQuery<{ intents: IntentDef[]; categories: string[] }>({
    queryKey: ["/api/intents"],
  });
  const categoriesList = intentData?.categories || [];
  const intentsList = intentData?.intents?.map(i => i.intent) || [];

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<MinsideFieldMapping>>({});
  const [filterPage, setFilterPage] = useState<string>("all");
  const [filterAction, setFilterAction] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [newMapping, setNewMapping] = useState({
    minsidePage: "", minsideField: "", fieldDescription: "", dataType: "read",
    actionType: "display", hjelpesenterCategory: "", intent: "", chatbotCapability: "", minsideUrl: "", adminNotes: "",
  });

  const pages = Array.from(new Set(mappings.map(m => m.minsidePage))).sort();

  const filtered = mappings.filter(m => {
    if (filterPage !== "all" && m.minsidePage !== filterPage) return false;
    if (filterAction !== "all" && m.actionType !== filterAction) return false;
    return true;
  });

  const grouped = filtered.reduce((acc, m) => {
    if (!acc[m.minsidePage]) acc[m.minsidePage] = [];
    acc[m.minsidePage].push(m);
    return acc;
  }, {} as Record<string, MinsideFieldMapping[]>);

  const stats = {
    total: mappings.length,
    read: mappings.filter(m => m.dataType === "read").length,
    write: mappings.filter(m => m.dataType === "write").length,
    execute: mappings.filter(m => m.actionType === "execute").length,
    guide: mappings.filter(m => m.actionType === "guide").length,
    pages: pages.length,
    categories: Array.from(new Set(mappings.map(m => m.hjelpesenterCategory).filter(Boolean))).length,
  };

  const startEdit = (m: MinsideFieldMapping) => {
    setEditingId(m.id);
    setEditData({
      hjelpesenterCategory: m.hjelpesenterCategory,
      intent: m.intent,
      chatbotCapability: m.chatbotCapability,
      actionType: m.actionType,
      dataType: m.dataType,
      adminNotes: m.adminNotes,
      isActive: m.isActive,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await apiRequest("PATCH", `/api/minside-mappings/${editingId}`, editData);
    queryClient.invalidateQueries({ queryKey: ["/api/minside-mappings"] });
    setEditingId(null);
    setEditData({});
  };

  const deleteMapping = async (id: number) => {
    await apiRequest("DELETE", `/api/minside-mappings/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/minside-mappings"] });
  };

  const seedMappings = async () => {
    await apiRequest("POST", "/api/minside-mappings/seed");
    queryClient.invalidateQueries({ queryKey: ["/api/minside-mappings"] });
  };

  const canAdd = newMapping.minsidePage.trim() !== "" && newMapping.minsideField.trim() !== "" && newMapping.fieldDescription.trim() !== "";

  const addMapping = async () => {
    if (!canAdd) return;
    const cleaned = {
      ...newMapping,
      hjelpesenterCategory: newMapping.hjelpesenterCategory || null,
      intent: newMapping.intent || null,
      chatbotCapability: newMapping.chatbotCapability || null,
      minsideUrl: newMapping.minsideUrl || null,
      adminNotes: newMapping.adminNotes || null,
    };
    await apiRequest("POST", "/api/minside-mappings", cleaned);
    queryClient.invalidateQueries({ queryKey: ["/api/minside-mappings"] });
    setShowAdd(false);
    setNewMapping({
      minsidePage: "", minsideField: "", fieldDescription: "", dataType: "read",
      actionType: "display", hjelpesenterCategory: "", intent: "", chatbotCapability: "", minsideUrl: "", adminNotes: "",
    });
  };

  const getActionBadge = (actionType: string) => {
    const at = ACTION_TYPES.find(a => a.value === actionType);
    return at ? <Badge className={`${at.color} no-default-hover-elevate no-default-active-elevate`} data-testid={`badge-action-${actionType}`}>{at.label}</Badge> : <Badge>{actionType}</Badge>;
  };

  return (
    <div className="space-y-4" data-testid="minside-mappings-tab">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totalt felt</CardTitle>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-fields">{stats.total}</div>
            <p className="text-xs text-muted-foreground">{stats.pages} sider, {stats.categories} kategorier</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lesbare felt</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-read-fields">{stats.read}</div>
            <p className="text-xs text-muted-foreground">Data som kan vises til bruker</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Handlinger</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-execute-fields">{stats.execute}</div>
            <p className="text-xs text-muted-foreground">Chatbot kan utføre direkte</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Veiledninger</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-guide-fields">{stats.guide}</div>
            <p className="text-xs text-muted-foreground">Chatbot veileder brukeren</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterPage} onValueChange={setFilterPage}>
          <SelectTrigger className="w-48" data-testid="select-filter-page">
            <SelectValue placeholder="Filtrer etter side" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle sider</SelectItem>
            {pages.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-48" data-testid="select-filter-action">
            <SelectValue placeholder="Filtrer etter type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle handlingstyper</SelectItem>
            {ACTION_TYPES.map(at => (
              <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap gap-2">
          {mappings.length === 0 && (
            <Button onClick={seedMappings} data-testid="button-seed-mappings">
              <Database className="h-4 w-4 mr-2" />
              Last inn forslag
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)} data-testid="button-add-mapping">
            <Plus className="h-4 w-4 mr-2" />
            Legg til
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nytt felt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <Input placeholder="Min Side-side" value={newMapping.minsidePage} onChange={e => setNewMapping({...newMapping, minsidePage: e.target.value})} data-testid="input-new-page" />
              <Input placeholder="Feltnavn" value={newMapping.minsideField} onChange={e => setNewMapping({...newMapping, minsideField: e.target.value})} data-testid="input-new-field" />
              <Input placeholder="Beskrivelse" value={newMapping.fieldDescription} onChange={e => setNewMapping({...newMapping, fieldDescription: e.target.value})} data-testid="input-new-description" />
              <Select value={newMapping.dataType} onValueChange={v => setNewMapping({...newMapping, dataType: v})}>
                <SelectTrigger data-testid="select-new-datatype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map(dt => <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newMapping.actionType} onValueChange={v => setNewMapping({...newMapping, actionType: v})}>
                <SelectTrigger data-testid="select-new-actiontype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map(at => <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newMapping.hjelpesenterCategory || ""} onValueChange={v => setNewMapping({...newMapping, hjelpesenterCategory: v})}>
                <SelectTrigger data-testid="select-new-category"><SelectValue placeholder="Kategori" /></SelectTrigger>
                <SelectContent>
                  {categoriesList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newMapping.intent || ""} onValueChange={v => setNewMapping({...newMapping, intent: v})}>
                <SelectTrigger data-testid="select-new-intent"><SelectValue placeholder="Intent" /></SelectTrigger>
                <SelectContent>
                  {intentsList.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Chatbot-kapabilitet" value={newMapping.chatbotCapability} onChange={e => setNewMapping({...newMapping, chatbotCapability: e.target.value})} data-testid="input-new-capability" />
              <Input placeholder="Min Side URL" value={newMapping.minsideUrl} onChange={e => setNewMapping({...newMapping, minsideUrl: e.target.value})} data-testid="input-new-url" />
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={addMapping} disabled={!canAdd} data-testid="button-save-new-mapping">
                <Save className="h-4 w-4 mr-2" />
                Lagre
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Avbryt</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mappings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Ingen Min Side-koblinger ennå</p>
            <p className="text-sm text-muted-foreground mt-1">Klikk "Last inn forslag" for å starte med foreslåtte koblinger</p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-4">
            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([page, fields]) => (
              <Card key={page}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {page}
                    <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">{fields.length} felt</Badge>
                  </CardTitle>
                  {fields[0]?.minsideUrl && (
                    <span className="text-xs text-muted-foreground">{fields[0].minsideUrl}</span>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {fields.map(field => (
                      <div key={field.id} className={`rounded-md border p-3 ${!field.isActive ? "opacity-50" : ""}`} data-testid={`mapping-row-${field.id}`}>
                        {editingId === field.id ? (
                          <div className="space-y-3">
                            <div className="grid gap-2 md:grid-cols-3">
                              <div>
                                <Label className="text-xs">Kategori</Label>
                                <Select value={editData.hjelpesenterCategory || ""} onValueChange={v => setEditData({...editData, hjelpesenterCategory: v})}>
                                  <SelectTrigger data-testid="select-edit-category"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {categoriesList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-xs">Intent</Label>
                                <Select value={editData.intent || ""} onValueChange={v => setEditData({...editData, intent: v})}>
                                  <SelectTrigger data-testid="select-edit-intent"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {intentsList.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-xs">Handlingstype</Label>
                                <Select value={editData.actionType || ""} onValueChange={v => setEditData({...editData, actionType: v})}>
                                  <SelectTrigger data-testid="select-edit-actiontype"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {ACTION_TYPES.map(at => <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              <div>
                                <Label className="text-xs">Chatbot-kapabilitet</Label>
                                <Input value={editData.chatbotCapability || ""} onChange={e => setEditData({...editData, chatbotCapability: e.target.value})} data-testid="input-edit-capability" />
                              </div>
                              <div>
                                <Label className="text-xs">Admin-notater</Label>
                                <Input value={editData.adminNotes || ""} onChange={e => setEditData({...editData, adminNotes: e.target.value})} data-testid="input-edit-notes" />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={editData.isActive !== false} onCheckedChange={v => setEditData({...editData, isActive: v})} data-testid="switch-edit-active" />
                              <Label className="text-xs">Aktiv</Label>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={saveEdit} data-testid="button-save-edit">
                                <Save className="h-3 w-3 mr-1" /> Lagre
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditData({}); }}>Avbryt</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="font-mono text-sm font-medium" data-testid={`text-field-name-${field.id}`}>{field.minsideField}</span>
                                {getActionBadge(field.actionType)}
                                <Badge variant={field.dataType === "write" ? "default" : "secondary"} className="no-default-hover-elevate no-default-active-elevate">
                                  {field.dataType === "write" ? "Skriv" : "Les"}
                                </Badge>
                                {!field.isActive && <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">Inaktiv</Badge>}
                              </div>
                              <p className="text-sm text-muted-foreground">{field.fieldDescription}</p>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                {field.hjelpesenterCategory && (
                                  <span className="text-xs text-muted-foreground">
                                    Kategori: <span className="font-medium">{field.hjelpesenterCategory}</span>
                                  </span>
                                )}
                                {field.intent && (
                                  <span className="text-xs text-muted-foreground">
                                    Intent: <span className="font-mono font-medium">{field.intent}</span>
                                  </span>
                                )}
                              </div>
                              {field.chatbotCapability && (
                                <p className="text-xs mt-1 text-muted-foreground">
                                  Chatbot: {field.chatbotCapability}
                                </p>
                              )}
                              {field.adminNotes && (
                                <p className="text-xs mt-1 italic text-muted-foreground">
                                  Notat: {field.adminNotes}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => startEdit(field)} data-testid={`button-edit-${field.id}`}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteMapping(field.id)} data-testid={`button-delete-${field.id}`}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
