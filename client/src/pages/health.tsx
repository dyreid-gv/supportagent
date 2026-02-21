import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  Shield,
  Target,
  AlertTriangle,
  BookOpen,
  Loader2,
} from "lucide-react";
import { useState } from "react";

interface CIData {
  lower: number;
  upper: number;
  margin: number;
}

interface HealthData {
  period: number;
  healthScore: number;
  confidenceIntervals?: {
    autoResolution: CIData;
    coverage: CIData;
    escalation: CIData;
  };
  baseline?: {
    sampleSize: number;
    healthScore: number;
    autoResolutionRate: number;
    coverageScore: number;
    escalationRate: number;
    coverageMapped: number;
    coverageTotal: number;
  };
  delta?: {
    healthScore: number;
    autoResolutionRate: number;
    coverageScore: number;
    escalationRate: number;
    sampleSize: number;
  };
  breakdown: {
    autoResolution: { rate: number; score: number; weight: number };
    reopenRate: { rate: number; score: number; weight: number; note?: string };
    coverage: { rate: number; score: number; weight: number };
    escalation: { rate: number; score: number; weight: number };
  };
  kpi: {
    totalTickets: number;
    autoResolved: number;
    autoResolvedStrict: number;
    agentHandled: number;
    autoResolutionRate: number;
    coverageScore: number;
    coverageMapped: number;
    coverageTotal: number;
    escalationRate: number;
    escalationCount: number;
    reopenRate: number;
    canonicalIntents: number;
    canonicalTotal: number;
    playbookEntries: number;
    playbookTotalUses: number;
    playbookSuccessful: number;
    chatbotTotal: number;
    chatbotMatched: number;
    chatbotFallback: number;
    chatbotFlagged: number;
  };
  intentBreakdown: Array<{
    intent: string;
    total: number;
    autoResolved: number;
    agentHandled: number;
    avgConfidence: number;
    autoClosePossible: number;
    isCanonical: boolean;
  }>;
  playbookUtilization: Array<{
    intent: string;
    ticketCount: number;
    autoCloseProbability: number;
    totalUses: number;
    successfulResolutions: number;
    failedResolutions: number;
    successRate: number;
    avgMessages: number;
    qualityLevel: string;
    isActive: boolean;
  }>;
  categoryDistribution: Array<{
    category: string;
    total: number;
    autoResolved: number;
    autoRate: number;
  }>;
  chatbotByIntent: Array<{
    intent: string;
    total: number;
    positive: number;
    negative: number;
    flagged: number;
    blocked: number;
  }>;
  trendMonthly: Array<{
    month: string;
    total: number;
    matched: number;
    fallback: number;
    flagged: number;
    blocked: number;
    matchRate: number;
    escalationRate: number;
  }>;
  trendDaily: Array<{
    day: string;
    total: number;
    matched: number;
    fallback: number;
    matchRate: number;
  }>;
}

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 75
      ? "text-green-600 dark:text-green-400"
      : score >= 50
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`text-5xl font-bold ${color}`} data-testid="text-health-score">
        {score}
      </div>
      <div className="text-sm text-muted-foreground">av 100</div>
      <Progress value={score} className="w-full max-w-[200px] h-2" />
    </div>
  );
}

function BreakdownBar({
  label,
  score,
  weight,
  rate,
  note,
}: {
  label: string;
  score: number;
  weight: number;
  rate: number;
  note?: string;
}) {
  const color =
    score >= 75
      ? "text-green-600 dark:text-green-400"
      : score >= 50
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <div className="w-36 text-sm truncate">{label}</div>
        <div className="flex-1">
          <Progress value={score} className="h-2" />
        </div>
        <div className={`w-12 text-right text-sm font-semibold ${color}`}>
          {score}
        </div>
        <div className="w-16 text-right text-xs text-muted-foreground">
          {Math.round(rate * 1000) / 10}%
        </div>
        <div className="w-14 text-right text-xs text-muted-foreground">
          x{weight}
        </div>
      </div>
      {note && <div className="text-xs text-muted-foreground ml-36 pl-3">{note}</div>}
    </div>
  );
}

function DeltaBadge({ value, unit, inverted }: { value: number; unit: string; inverted: boolean }) {
  if (value === 0) return <span className="text-muted-foreground">0{unit}</span>;
  const isPositive = inverted ? value < 0 : value > 0;
  const color = isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const prefix = value > 0 ? "+" : "";
  return <span className={`font-semibold ${color}`}>{prefix}{Math.round(value * 10) / 10}{unit}</span>;
}

function HealthBadge({ value, thresholdGreen = 5, thresholdYellow = 10 }: { value: number; thresholdGreen?: number; thresholdYellow?: number }) {
  if (value < thresholdGreen) return <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">Bra</Badge>;
  if (value < thresholdYellow) return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700 text-white">OK</Badge>;
  return <Badge variant="destructive">Svak</Badge>;
}

const pieConfig: ChartConfig = {
  auto: { label: "Auto-løst", color: "hsl(var(--chart-1))" },
  agent: { label: "Agent", color: "hsl(var(--chart-2))" },
};

const coveragePieConfig: ChartConfig = {
  mapped: { label: "Canonical", color: "hsl(var(--chart-1))" },
  unmapped: { label: "Ikke mappet", color: "hsl(var(--chart-3))" },
};

const trendConfig: ChartConfig = {
  matchRate: { label: "Coverage %", color: "hsl(var(--chart-1))" },
  escalationRate: { label: "Eskalering %", color: "hsl(var(--chart-3))" },
};

export default function HealthDashboard() {
  const [period, setPeriod] = useState("12");

  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ["/api/admin/health", period],
    queryFn: async () => {
      const res = await fetch(`/api/admin/health?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch health data");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Ingen data tilgjengelig</p>
      </div>
    );
  }

  const autoVsAgent = [
    { name: "Auto-løst", value: data.kpi.autoResolvedStrict, fill: "hsl(var(--chart-1))" },
    { name: "Agent-håndtert", value: data.kpi.agentHandled, fill: "hsl(var(--chart-2))" },
  ];

  const coveragePie = [
    { name: "Canonical mappet", value: data.kpi.coverageMapped, fill: "hsl(var(--chart-1))" },
    { name: "Ikke mappet", value: data.kpi.coverageTotal - data.kpi.coverageMapped, fill: "hsl(var(--chart-3))" },
  ];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-health-title">
            Playbook Health Score
          </h1>
          <p className="text-sm text-muted-foreground">
            Objektiv analyse av systemhelse og ytelse
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[140px]" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 måneder</SelectItem>
            <SelectItem value="6">6 måneder</SelectItem>
            <SelectItem value="12">12 måneder</SelectItem>
            <SelectItem value="9999">All tid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Health Score</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-4">
            <ScoreGauge score={data.healthScore} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Score-fordeling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <BreakdownBar
              label="Auto Resolution"
              score={data.breakdown.autoResolution.score}
              weight={data.breakdown.autoResolution.weight}
              rate={data.breakdown.autoResolution.rate}
            />
            <BreakdownBar
              label="Reopen Rate"
              score={data.breakdown.reopenRate.score}
              weight={data.breakdown.reopenRate.weight}
              rate={data.breakdown.reopenRate.rate}
              note={data.breakdown.reopenRate.note}
            />
            <BreakdownBar
              label="Coverage"
              score={data.breakdown.coverage.score}
              weight={data.breakdown.coverage.weight}
              rate={data.breakdown.coverage.rate}
            />
            <BreakdownBar
              label="Escalation"
              score={data.breakdown.escalation.score}
              weight={data.breakdown.escalation.weight}
              rate={data.breakdown.escalation.rate}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Auto Resolution</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-auto-resolution-rate">
              {data.kpi.autoResolutionRate}%
            </div>
            <p className="text-xs text-muted-foreground">
              {data.kpi.autoResolvedStrict} auto-løst av {data.kpi.totalTickets} tickets
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Coverage Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-coverage-score">
              {data.kpi.coverageScore}%
            </div>
            <p className="text-xs text-muted-foreground">
              {data.kpi.coverageMapped} mappet til canonical av {data.kpi.coverageTotal}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Escalation Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-escalation-rate">
              {data.kpi.escalationRate}%
            </div>
            <p className="text-xs text-muted-foreground">
              {data.kpi.escalationCount} eskalert av {data.kpi.chatbotTotal}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Playbook</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-playbook-count">
              {data.kpi.playbookEntries}
            </div>
            <p className="text-xs text-muted-foreground">
              aktive / {data.kpi.canonicalIntents} canonical intents
            </p>
          </CardContent>
        </Card>
      </div>

      {data.confidenceIntervals && data.baseline && data.delta && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">95% Konfidensintervall (Wilson)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead className="text-right">Verdi</TableHead>
                    <TableHead className="text-right">Nedre</TableHead>
                    <TableHead className="text-right">Øvre</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow data-testid="row-ci-auto-resolution">
                    <TableCell className="text-sm">Auto Resolution</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.autoResolutionRate}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.autoResolution.lower}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.autoResolution.upper}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">±{data.confidenceIntervals.autoResolution.margin}%</TableCell>
                  </TableRow>
                  <TableRow data-testid="row-ci-coverage">
                    <TableCell className="text-sm">Coverage</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.coverageScore}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.coverage.lower}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.coverage.upper}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">±{data.confidenceIntervals.coverage.margin}%</TableCell>
                  </TableRow>
                  <TableRow data-testid="row-ci-escalation">
                    <TableCell className="text-sm">Escalation</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.escalationRate}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.escalation.lower}%</TableCell>
                    <TableCell className="text-right">{data.confidenceIntervals.escalation.upper}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">±{data.confidenceIntervals.escalation.margin}%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-3">
                n = {data.kpi.totalTickets} tickets (Wilson score interval, 95% konfidens)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Endring vs. 200-test baseline</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead className="text-right">Baseline (n={data.baseline.sampleSize})</TableHead>
                    <TableHead className="text-right">Nå (n={data.kpi.totalTickets})</TableHead>
                    <TableHead className="text-right">Endring</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow data-testid="row-delta-health">
                    <TableCell className="text-sm font-medium">Health Score</TableCell>
                    <TableCell className="text-right">{data.baseline.healthScore}</TableCell>
                    <TableCell className="text-right font-semibold">{data.healthScore}</TableCell>
                    <TableCell className="text-right">
                      <DeltaBadge value={data.delta.healthScore} unit="" inverted={false} />
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-delta-auto-resolution">
                    <TableCell className="text-sm">Auto Resolution</TableCell>
                    <TableCell className="text-right">{data.baseline.autoResolutionRate}%</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.autoResolutionRate}%</TableCell>
                    <TableCell className="text-right">
                      <DeltaBadge value={data.delta.autoResolutionRate} unit="%" inverted={false} />
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-delta-coverage">
                    <TableCell className="text-sm">Coverage</TableCell>
                    <TableCell className="text-right">{data.baseline.coverageScore}%</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.coverageScore}%</TableCell>
                    <TableCell className="text-right">
                      <DeltaBadge value={data.delta.coverageScore} unit="%" inverted={false} />
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-delta-escalation">
                    <TableCell className="text-sm">Escalation</TableCell>
                    <TableCell className="text-right">{data.baseline.escalationRate}%</TableCell>
                    <TableCell className="text-right font-semibold">{data.kpi.escalationRate}%</TableCell>
                    <TableCell className="text-right">
                      <DeltaBadge value={data.delta.escalationRate} unit="%" inverted={true} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-3">
                Utvidet fra {data.baseline.sampleSize} til {data.kpi.totalTickets} tickets (+{data.delta.sampleSize})
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auto vs Agent</CardTitle>
          </CardHeader>
          <CardContent>
            {data.kpi.totalTickets > 0 ? (
              <ChartContainer config={pieConfig} className="h-[250px]">
                <PieChart>
                  <Pie
                    data={autoVsAgent}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {autoVsAgent.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                Ingen ticket-data
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canonical Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {data.kpi.coverageTotal > 0 ? (
              <ChartContainer config={coveragePieConfig} className="h-[250px]">
                <PieChart>
                  <Pie
                    data={coveragePie}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {coveragePie.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                Ingen coverage-data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.trendMonthly.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trend over tid (månedlig)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendConfig} className="h-[300px]">
              <LineChart data={data.trendMonthly}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.toLocaleString("no", { month: "short" })} ${d.getFullYear()}`;
                  }}
                  className="text-xs"
                />
                <YAxis className="text-xs" unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="matchRate"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={true}
                  name="Coverage %"
                />
                <Line
                  type="monotone"
                  dataKey="escalationRate"
                  stroke="hsl(var(--chart-3))"
                  strokeWidth={2}
                  dot={true}
                  name="Eskalering %"
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {data.trendDaily.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daglig chatbot-aktivitet</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ matched: { label: "Matchet", color: "hsl(var(--chart-1))" }, fallback: { label: "Fallback", color: "hsl(var(--chart-3))" } }} className="h-[250px]">
              <LineChart data={data.trendDaily}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="day"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                  className="text-xs"
                />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="matched" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Matchet" />
                <Line type="monotone" dataKey="fallback" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Fallback" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kategori-fordeling</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Auto %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.categoryDistribution.map((cat) => (
                  <TableRow key={cat.category} data-testid={`row-category-${cat.category}`}>
                    <TableCell className="text-sm">{cat.category}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{cat.total}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {data.kpi.totalTickets > 0
                        ? Math.round((cat.total / data.kpi.totalTickets) * 1000) / 10
                        : 0}%
                    </TableCell>
                    <TableCell className="text-right text-sm">{cat.autoRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Intent Breakdown (Reopen Rate per Intent)</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Auto</TableHead>
                  <TableHead className="text-right">Agent</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-center">Canonical</TableHead>
                  <TableHead className="text-right">Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.intentBreakdown.map((ib) => (
                  <TableRow key={ib.intent} data-testid={`row-intent-${ib.intent}`}>
                    <TableCell className="font-mono text-sm">{ib.intent}</TableCell>
                    <TableCell className="text-right">{ib.total}</TableCell>
                    <TableCell className="text-right">{ib.autoResolved}</TableCell>
                    <TableCell className="text-right">{ib.agentHandled}</TableCell>
                    <TableCell className="text-right">{ib.avgConfidence}</TableCell>
                    <TableCell className="text-center">
                      {ib.isCanonical ? (
                        <Badge variant="default" className="bg-green-600 text-white">Ja</Badge>
                      ) : (
                        <Badge variant="secondary">Nei</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <HealthBadge value={ib.agentHandled > 0 ? (ib.agentHandled / ib.total) * 100 : 0} thresholdGreen={30} thresholdYellow={70} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Playbook Utilization</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Auto %</TableHead>
                  <TableHead className="text-right">Bruk</TableHead>
                  <TableHead className="text-right">Suksess %</TableHead>
                  <TableHead className="text-right">Snitt mld.</TableHead>
                  <TableHead className="text-right">Kvalitet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.playbookUtilization.map((pu) => (
                  <TableRow key={pu.intent} data-testid={`row-playbook-${pu.intent}`}>
                    <TableCell className="font-mono text-sm">{pu.intent}</TableCell>
                    <TableCell className="text-right">{pu.ticketCount}</TableCell>
                    <TableCell className="text-right">{pu.autoCloseProbability}%</TableCell>
                    <TableCell className="text-right">{pu.totalUses}</TableCell>
                    <TableCell className="text-right">{pu.successRate}%</TableCell>
                    <TableCell className="text-right">{pu.avgMessages > 0 ? pu.avgMessages.toFixed(1) : '-'}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{pu.qualityLevel}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chatbot Intent-fordeling</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Positiv</TableHead>
                  <TableHead className="text-right">Negativ</TableHead>
                  <TableHead className="text-right">Flagget</TableHead>
                  <TableHead className="text-right">Blokkert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.chatbotByIntent.map((ci) => (
                  <TableRow key={ci.intent} data-testid={`row-chatbot-${ci.intent}`}>
                    <TableCell className="font-mono text-sm">{ci.intent}</TableCell>
                    <TableCell className="text-right">{ci.total}</TableCell>
                    <TableCell className="text-right">{ci.positive}</TableCell>
                    <TableCell className="text-right">{ci.negative}</TableCell>
                    <TableCell className="text-right">
                      {ci.flagged > 0 ? (
                        <Badge variant="destructive">{ci.flagged}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {ci.blocked > 0 ? (
                        <Badge variant="destructive">{ci.blocked}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
