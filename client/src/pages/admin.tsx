import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Database,
  FileJson,
  FileSpreadsheet,
  Package,
  Layers,
  Eye,
  PenTool,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TableInfo {
  name: string;
  rows: number;
}

interface SchemaColumn {
  name: string;
  dbName: string;
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
}

interface SchemaTable {
  tableName: string;
  columns: SchemaColumn[];
}

interface PlaybookCandidate {
  id: number;
  intentId: string;
  category: string | null;
  subcategory: string | null;
  status: string;
  combinedResponse: string | null;
  resolutionSteps: string | null;
  keywords: string | null;
  actionType: string | null;
  requiresLogin: boolean | null;
  notesForReviewer: string | null;
  ticketsBasis: number | null;
  source: string | null;
  authoredBy: string | null;
  authoredAt: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface HjelpesenterCategory {
  id: number;
  categoryName: string;
  subcategoryName: string;
}

const TABLE_LABELS: Record<string, string> = {
  raw_tickets: "Ra tickets fra Pureservice",
  scrubbed_tickets: "GDPR-rensede tickets",
  hjelpesenter_categories: "Hjelpesenter-kategorier (kodeverk)",
  category_mappings: "Kategorimappinger",
  intent_classifications: "Intent-klassifiseringer",
  resolution_patterns: "Løsningsmønstre",
  playbook_entries: "Playbook-oppslag",
  uncategorized_themes: "Ukategoriserte temaer",
  uncertainty_cases: "Usikkerhetssaker",
  review_queue: "Review-kø",
  training_runs: "Treningskjøringer",
};

function downloadFile(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function statusBadge(status: string) {
  switch (status) {
    case "DRAFT_READY":
      return <Badge variant="secondary" data-testid="badge-status-draft">Utkast klar</Badge>;
    case "NEEDS_MANUAL_AUTHORING":
      return <Badge variant="destructive" data-testid="badge-status-manual">Manuell</Badge>;
    case "DEPRECATED":
      return <Badge variant="outline" data-testid="badge-status-deprecated">Utgatt</Badge>;
    case "APPROVED":
      return <Badge className="bg-green-600 hover:bg-green-700" data-testid="badge-status-approved">Godkjent</Badge>;
    case "REJECTED":
      return <Badge variant="destructive" data-testid="badge-status-rejected">Avvist</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function CandidateEditor({
  candidate,
  categories,
  onBack,
}: {
  candidate: PlaybookCandidate;
  categories: HjelpesenterCategory[];
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    combinedResponse: candidate.combinedResponse || "",
    resolutionSteps: candidate.resolutionSteps || "",
    keywords: candidate.keywords || "",
    category: candidate.category || "",
    subcategory: candidate.subcategory || "",
    actionType: candidate.actionType || "INFO_ONLY",
    requiresLogin: candidate.requiresLogin || false,
    notesForReviewer: candidate.notesForReviewer || "",
  });
  const [rejectReason, setRejectReason] = useState("");

  const uniqueCategories = Array.from(new Set(categories.map((c) => c.categoryName))).sort();
  const subcategoriesForCategory = categories
    .filter((c) => c.categoryName === form.category)
    .map((c) => c.subcategoryName)
    .sort();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/admin/playbook-candidates/${candidate.id}`, form);
    },
    onSuccess: () => {
      toast({ title: "Lagret", description: "Endringene ble lagret." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/playbook-candidates"] });
    },
    onError: (err: Error) => {
      toast({ title: "Feil", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/admin/playbook-candidates/${candidate.id}`, form);
      await apiRequest("POST", `/api/admin/playbook-candidates/${candidate.id}/approve`, {
        authoredBy: "admin",
      });
    },
    onSuccess: () => {
      toast({ title: "Godkjent!", description: `${candidate.intentId} er na aktivert i Playbook og chatbot.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/playbook-candidates"] });
      onBack();
    },
    onError: (err: Error) => {
      toast({ title: "Feil ved godkjenning", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/playbook-candidates/${candidate.id}/reject`, {
        reason: rejectReason,
      });
    },
    onSuccess: () => {
      toast({ title: "Avvist", description: `${candidate.intentId} ble avvist.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/playbook-candidates"] });
      onBack();
    },
    onError: (err: Error) => {
      toast({ title: "Feil", description: err.message, variant: "destructive" });
    },
  });

  const isEditable = !["APPROVED", "REJECTED"].includes(candidate.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Tilbake
        </Button>
        <h2 className="text-lg font-semibold" data-testid="text-editor-title">{candidate.intentId}</h2>
        {statusBadge(candidate.status)}
      </div>

      {candidate.status === "NEEDS_MANUAL_AUTHORING" && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20" data-testid="banner-manual-authoring">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Dette svaret mangler gyldig kilde. Skriv inn korrekt innhold manuelt
              for aktivering. Ikke basert pa historiske tickets.
            </p>
          </div>
        </div>
      )}

      {candidate.notesForReviewer && (
        <Card>
          <CardContent className="pt-4">
            <Label className="text-xs text-muted-foreground">Notater for reviewer</Label>
            <p className="text-sm mt-1 whitespace-pre-wrap" data-testid="text-reviewer-notes">{candidate.notesForReviewer}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div>
            <Label htmlFor="combinedResponse">Svar til kunden (combined response) *</Label>
            <Textarea
              id="combinedResponse"
              value={form.combinedResponse}
              onChange={(e) => setForm({ ...form, combinedResponse: e.target.value })}
              rows={8}
              placeholder="Skriv svaret som chatboten skal gi til kunden..."
              disabled={!isEditable}
              data-testid="textarea-combined-response"
            />
          </div>
          <div>
            <Label htmlFor="resolutionSteps">Løsningssteg (valgfritt)</Label>
            <Textarea
              id="resolutionSteps"
              value={form.resolutionSteps}
              onChange={(e) => setForm({ ...form, resolutionSteps: e.target.value })}
              rows={4}
              placeholder="Steg-for-steg løsning..."
              disabled={!isEditable}
              data-testid="textarea-resolution-steps"
            />
          </div>
          <div>
            <Label htmlFor="keywords">Nøkkelord (kommaseparert)</Label>
            <Input
              id="keywords"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="batteri, smart tag, bytte..."
              disabled={!isEditable}
              data-testid="input-keywords"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="category">Kategori</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v, subcategory: "" })}
              disabled={!isEditable}
            >
              <SelectTrigger data-testid="select-category">
                <SelectValue placeholder="Velg kategori" />
              </SelectTrigger>
              <SelectContent>
                {uniqueCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="subcategory">Underkategori</Label>
            <Select
              value={form.subcategory}
              onValueChange={(v) => setForm({ ...form, subcategory: v })}
              disabled={!isEditable || !form.category}
            >
              <SelectTrigger data-testid="select-subcategory">
                <SelectValue placeholder="Velg underkategori" />
              </SelectTrigger>
              <SelectContent>
                {subcategoriesForCategory.map((sub) => (
                  <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="actionType">Handlingstype</Label>
            <Select
              value={form.actionType}
              onValueChange={(v) => setForm({ ...form, actionType: v })}
              disabled={!isEditable}
            >
              <SelectTrigger data-testid="select-action-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INFO_ONLY">INFO_ONLY</SelectItem>
                <SelectItem value="API_CALL">API_CALL</SelectItem>
                <SelectItem value="FORM_FILL">FORM_FILL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="requiresLogin"
              checked={form.requiresLogin}
              onCheckedChange={(v) => setForm({ ...form, requiresLogin: v })}
              disabled={!isEditable}
              data-testid="switch-requires-login"
            />
            <Label htmlFor="requiresLogin">Krever innlogging</Label>
          </div>
          <div>
            <Label htmlFor="notesForReviewer">Interne notater (ikke vist til kunde)</Label>
            <Textarea
              id="notesForReviewer"
              value={form.notesForReviewer}
              onChange={(e) => setForm({ ...form, notesForReviewer: e.target.value })}
              rows={3}
              placeholder="Interne notater..."
              disabled={!isEditable}
              data-testid="textarea-notes"
            />
          </div>
        </div>
      </div>

      {isEditable && (
        <div className="flex items-center gap-3 pt-2 border-t">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            variant="outline"
            data-testid="button-save-draft"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Lagre utkast
          </Button>
          <Button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || !form.combinedResponse.trim()}
            className="bg-green-600 hover:bg-green-700"
            data-testid="button-approve"
          >
            {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Godkjenn og aktiver
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="button-reject-trigger">
                <XCircle className="h-4 w-4 mr-1" />
                Avvis
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Avvis kandidat?</AlertDialogTitle>
                <AlertDialogDescription>
                  Dette markerer {candidate.intentId} som avvist. Du kan legge til en begrunnelse.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Begrunnelse for avvisning (valgfritt)..."
                rows={3}
                data-testid="textarea-reject-reason"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => rejectMutation.mutate()}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-confirm-reject"
                >
                  Avvis
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {candidate.status === "APPROVED" && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-800 dark:text-green-200">
            Godkjent av {candidate.authoredBy} {candidate.authoredAt ? `den ${new Date(candidate.authoredAt).toLocaleDateString("no-NO")}` : ""}
          </span>
        </div>
      )}

      {candidate.status === "REJECTED" && candidate.rejectionReason && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
          <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <span className="text-sm font-medium text-red-800 dark:text-red-200">Avvist</span>
            <p className="text-sm text-red-700 dark:text-red-300">{candidate.rejectionReason}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualAuthoringSection() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: candidates, isLoading } = useQuery<PlaybookCandidate[]>({
    queryKey: ["/api/admin/playbook-candidates"],
  });

  const { data: categories } = useQuery<HjelpesenterCategory[]>({
    queryKey: ["/api/categories"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/playbook-candidates/seed");
    },
    onSuccess: () => {
      toast({ title: "Seeded", description: "Initielle kandidater ble opprettet." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/playbook-candidates"] });
    },
    onError: (err: Error) => {
      toast({ title: "Feil", description: err.message, variant: "destructive" });
    },
  });

  const editingCandidate = candidates?.find((c) => c.id === editingId);

  if (editingCandidate) {
    return (
      <CandidateEditor
        candidate={editingCandidate}
        categories={categories || []}
        onBack={() => {
          setEditingId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/admin/playbook-candidates"] });
        }}
      />
    );
  }

  const pendingCandidates = candidates?.filter(
    (c) => !["APPROVED", "REJECTED"].includes(c.status)
  ) || [];
  const completedCandidates = candidates?.filter(
    (c) => ["APPROVED", "REJECTED"].includes(c.status)
  ) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-authoring-title">Kandidater til godkjenning</h2>
          <p className="text-sm text-muted-foreground">
            Alle foreslatte intents som venter pa manuell gjennomgang og godkjenning
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seedMutation.mutate()}
          disabled={seedMutation.isPending}
          data-testid="button-seed-candidates"
        >
          {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PenTool className="h-4 w-4 mr-1" />}
          Seed initielle kandidater
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm text-muted-foreground">Laster kandidater...</span>
        </div>
      ) : pendingCandidates.length === 0 && completedCandidates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <PenTool className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Ingen kandidater ennå. Klikk "Seed initielle kandidater" for å opprette SmartTagBatteryInfo og SmartTagNotificationIssue.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendingCandidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ventende ({pendingCandidates.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Intent ID</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Underkategori</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead className="text-right">Sist oppdatert</TableHead>
                      <TableHead className="text-right">Handling</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingCandidates.map((c) => (
                      <TableRow key={c.id} data-testid={`row-candidate-${c.intentId}`}>
                        <TableCell className="font-mono text-sm">{c.intentId}</TableCell>
                        <TableCell className="text-sm">{c.category || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.subcategory || "-"}</TableCell>
                        <TableCell>{statusBadge(c.status)}</TableCell>
                        <TableCell className="text-right">{c.ticketsBasis || 0}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString("no-NO") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(c.id)}
                            data-testid={`button-edit-${c.intentId}`}
                          >
                            <PenTool className="h-3 w-3 mr-1" />
                            Rediger
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {completedCandidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Behandlet ({completedCandidates.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Intent ID</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Av</TableHead>
                      <TableHead className="text-right">Dato</TableHead>
                      <TableHead className="text-right">Handling</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedCandidates.map((c) => (
                      <TableRow key={c.id} data-testid={`row-candidate-${c.intentId}`}>
                        <TableCell className="font-mono text-sm">{c.intentId}</TableCell>
                        <TableCell className="text-sm">{c.category || "-"}</TableCell>
                        <TableCell>{statusBadge(c.status)}</TableCell>
                        <TableCell className="text-sm">{c.authoredBy || "-"}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {c.authoredAt ? new Date(c.authoredAt).toLocaleDateString("no-NO") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(c.id)}
                            data-testid={`button-view-${c.intentId}`}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Vis
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const { data: tablesData } = useQuery<{ tables: TableInfo[]; stats: any }>({
    queryKey: ["/api/admin/tables"],
  });

  const { data: schemaData } = useQuery<SchemaTable[]>({
    queryKey: ["/api/admin/schema"],
  });

  const tables = tablesData?.tables || [];
  const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);

  async function loadPreview(tableName: string) {
    if (previewTable === tableName) {
      setPreviewTable(null);
      setPreviewData(null);
      return;
    }
    setLoadingPreview(true);
    setPreviewTable(tableName);
    try {
      const res = await fetch(`/api/admin/export/${tableName}`);
      const data = await res.json();
      setPreviewData(Array.isArray(data) ? data.slice(0, 20) : []);
    } catch {
      setPreviewData([]);
    }
    setLoadingPreview(false);
  }

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground">
            Administrer database, kodeverk og manuell playbook-forfatter
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => downloadFile("/api/admin/export-all", "dyreid_full_export.json")}
          data-testid="button-export-all"
        >
          <Package className="h-4 w-4" />
          Eksporter alt (JSON)
        </Button>
      </div>

      <Tabs defaultValue="authoring" className="w-full">
        <TabsList data-testid="tabs-admin">
          <TabsTrigger value="authoring" data-testid="tab-authoring">
            <PenTool className="h-4 w-4 mr-1" />
            Manuell forfatter
          </TabsTrigger>
          <TabsTrigger value="database" data-testid="tab-database">
            <Database className="h-4 w-4 mr-1" />
            Database
          </TabsTrigger>
        </TabsList>

        <TabsContent value="authoring" className="mt-4">
          <ManualAuthoringSection />
        </TabsContent>

        <TabsContent value="database" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tabeller</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-table-count">{tables.length}</div>
                <p className="text-xs text-muted-foreground">i databasen</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Totalt rader</CardTitle>
                <Layers className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-rows">{totalRows}</div>
                <p className="text-xs text-muted-foreground">pa tvers av alle tabeller</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Skjemaer</CardTitle>
                <FileJson className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-schema-count">{schemaData?.length || 0}</div>
                <p className="text-xs text-muted-foreground">tabelldefinisjoner</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Database-tabeller</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tabell</TableHead>
                    <TableHead>Beskrivelse</TableHead>
                    <TableHead className="text-right">Rader</TableHead>
                    <TableHead className="text-right">Handlinger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tables.map((t) => (
                    <TableRow key={t.name} data-testid={`row-table-${t.name}`}>
                      <TableCell className="font-mono text-sm">{t.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {TABLE_LABELS[t.name] || t.name}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={t.rows > 0 ? "default" : "secondary"}>
                          {t.rows}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => loadPreview(t.name)}
                            data-testid={`button-preview-${t.name}`}
                            title="Forhandsvis"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => downloadFile(`/api/admin/export/${t.name}`, `${t.name}.json`)}
                            data-testid={`button-export-json-${t.name}`}
                            title="Last ned JSON"
                          >
                            <FileJson className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => downloadFile(`/api/admin/export/${t.name}?format=csv`, `${t.name}.csv`)}
                            data-testid={`button-export-csv-${t.name}`}
                            title="Last ned CSV"
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {previewTable && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">
                  Forhandsvisning: <span className="font-mono">{previewTable}</span>
                  {previewData && (
                    <Badge variant="secondary" className="ml-2">{previewData.length} av maks 20 rader</Badge>
                  )}
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => { setPreviewTable(null); setPreviewData(null); }}>
                  Lukk
                </Button>
              </CardHeader>
              <CardContent>
                {loadingPreview ? (
                  <p className="text-sm text-muted-foreground">Laster...</p>
                ) : previewData && previewData.length > 0 ? (
                  <ScrollArea className="max-h-[400px]">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(previewData[0]).map((key) => (
                              <TableHead key={key} className="text-xs whitespace-nowrap">{key}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.map((row, i) => (
                            <TableRow key={i}>
                              {Object.values(row).map((val: any, j) => (
                                <TableCell key={j} className="text-xs max-w-[200px] truncate" title={typeof val === "object" ? JSON.stringify(val) : String(val ?? "")}>
                                  {val === null ? <span className="text-muted-foreground italic">null</span> : typeof val === "object" ? JSON.stringify(val).slice(0, 80) : String(val).slice(0, 80)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen data i tabellen</p>
                )}
              </CardContent>
            </Card>
          )}

          {schemaData && schemaData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Database-skjema (kodeverk)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {schemaData.map((table) => (
                  <div key={table.tableName}>
                    <h3 className="font-mono text-sm font-semibold mb-1">{table.tableName}</h3>
                    <p className="text-xs text-muted-foreground mb-2">{TABLE_LABELS[table.tableName] || ""}</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Felt</TableHead>
                            <TableHead className="text-xs">DB-kolonne</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Pakrevd</TableHead>
                            <TableHead className="text-xs">Standard</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {table.columns.map((col) => (
                            <TableRow key={col.name}>
                              <TableCell className="text-xs font-mono">{col.name}</TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">{col.dbName}</TableCell>
                              <TableCell className="text-xs">{col.dataType}</TableCell>
                              <TableCell className="text-xs">{col.notNull ? "Ja" : "Nei"}</TableCell>
                              <TableCell className="text-xs">{col.hasDefault ? "Ja" : "Nei"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
