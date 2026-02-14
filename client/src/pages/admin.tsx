import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Package,
  Layers,
  Eye,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";

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

const TABLE_LABELS: Record<string, string> = {
  raw_tickets: "Rå tickets fra Pureservice",
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
            Eksporter data og kvalitetssikre kodeverk og database
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
            <p className="text-xs text-muted-foreground">på tvers av alle tabeller</p>
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
                        title="Forhåndsvis"
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
              Forhåndsvisning: <span className="font-mono">{previewTable}</span>
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
                        <TableHead className="text-xs">Påkrevd</TableHead>
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
    </div>
  );
}
