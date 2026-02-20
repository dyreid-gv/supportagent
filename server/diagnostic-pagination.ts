const fetch = globalThis.fetch;

const API_BASE = "https://dyreid.pureservice.com/agent/api";
const API_KEY = process.env.PURESERVICE_API_KEY!;
const BATCH_SIZE = 200;
const TARGET_TICKETS = 2000;

interface DiagnosticReport {
  totalApiCalls: number;
  totalTicketsRetrieved: number;
  uniqueTickets: number;
  duplicateIds: number;
  highestIdSeen: number;
  lowestIdSeen: number;
  batchesProcessed: number;
  continuityViolations: number;
  warnings: string[];
  errors: string[];
  status: "PASS" | "FAIL";
  batchLog: BatchLog[];
  preCheck: PreCheck;
}

interface BatchLog {
  batchNumber: number;
  maxId: number;
  minId: number;
  count: number;
  overlapWithPrevious: number;
  overlapWithGlobal: number;
}

interface PreCheck {
  highestId: number;
  totalCount: number;
  difference: number;
  differencePercent: number;
  status: "PASS" | "FAIL";
}

async function apiGet(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

function fail(report: DiagnosticReport, error: string): DiagnosticReport {
  report.errors.push(error);
  report.status = "FAIL";
  return report;
}

export async function runPaginationDiagnostic(): Promise<DiagnosticReport> {
  const report: DiagnosticReport = {
    totalApiCalls: 0,
    totalTicketsRetrieved: 0,
    uniqueTickets: 0,
    duplicateIds: 0,
    highestIdSeen: 0,
    lowestIdSeen: Infinity,
    batchesProcessed: 0,
    continuityViolations: 0,
    warnings: [],
    errors: [],
    status: "PASS",
    batchLog: [],
    preCheck: { highestId: 0, totalCount: 0, difference: 0, differencePercent: 0, status: "PASS" },
  };

  console.log("[diagnostic] === PAGINATION DIAGNOSTIC START ===");

  // PRE-CHECK: Compare highest ID with count
  console.log("[diagnostic] Pre-check: Fetching highest ID and total count...");
  const topTicket = await apiGet(`${API_BASE}/ticket?sort=-id&limit=1`);
  report.totalApiCalls++;
  const highestId = topTicket[0].id;

  const countResp = await apiGet(`${API_BASE}/ticket/count`);
  report.totalApiCalls++;
  const totalCount = countResp.count;

  const difference = highestId - totalCount;
  const differencePercent = (difference / highestId) * 100;

  report.preCheck = {
    highestId,
    totalCount,
    difference,
    differencePercent: Math.round(differencePercent * 100) / 100,
    status: differencePercent > 10 ? "FAIL" : "PASS",
  };

  console.log(`[diagnostic] Highest ID: ${highestId}`);
  console.log(`[diagnostic] Total count: ${totalCount}`);
  console.log(`[diagnostic] Difference: ${difference} (${report.preCheck.differencePercent}%)`);

  if (report.preCheck.status === "FAIL") {
    return fail(report, `Pre-check FAIL: ID/count difference ${report.preCheck.differencePercent}% exceeds 10% threshold`);
  }
  console.log("[diagnostic] Pre-check: PASS");

  // PAGINATION TEST
  const globalSeenIds = new Set<number>();
  let previousBatchIds = new Set<number>();
  let globalMaxId = -1;
  let lastMinId: number | null = null;

  for (let batch = 1; report.totalTicketsRetrieved < TARGET_TICKETS; batch++) {
    const url = lastMinId === null
      ? `${API_BASE}/ticket?sort=-id&limit=${BATCH_SIZE}`
      : `${API_BASE}/ticket?sort=-id&limit=${BATCH_SIZE}&filter=id<${lastMinId}`;

    console.log(`[diagnostic] Batch #${batch}: Fetching... (lastMinId=${lastMinId ?? "none"})`);
    const tickets = await apiGet(url);
    report.totalApiCalls++;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      console.log(`[diagnostic] Batch #${batch}: Empty response — termination`);
      break;
    }

    const batchIds: number[] = tickets.map((t: any) => t.id);
    const batchMaxId = batchIds[0];
    const batchMinId = batchIds[batchIds.length - 1];

    // CHECK: IDs within batch must be strictly descending
    for (let i = 1; i < batchIds.length; i++) {
      if (batchIds[i] >= batchIds[i - 1]) {
        return fail(report, `Batch #${batch}: IDs not strictly descending at position ${i}: ${batchIds[i - 1]} -> ${batchIds[i]}`);
      }
    }

    // CHECK: No ID in batch greater than previously observed max (except first batch)
    if (globalMaxId >= 0 && batchMaxId >= globalMaxId) {
      return fail(report, `Batch #${batch}: maxId ${batchMaxId} >= global max ${globalMaxId} — sorting broken`);
    }

    // CHECK: Batch(n).maxId < Batch(n-1).minId
    if (lastMinId !== null && batchMaxId >= lastMinId) {
      report.continuityViolations++;
      return fail(report, `Batch #${batch}: maxId ${batchMaxId} >= previous minId ${lastMinId} — continuity violation`);
    }

    // CHECK: Overlap with previous batch
    const overlapPrevious = batchIds.filter(id => previousBatchIds.has(id)).length;

    // CHECK: Overlap with global seen set
    const overlapGlobal = batchIds.filter(id => globalSeenIds.has(id)).length;
    const overlapGlobalPercent = (overlapGlobal / batchIds.length) * 100;

    if (overlapGlobal > 0) {
      report.warnings.push(`Batch #${batch}: ${overlapGlobal} IDs overlap with previously seen (${overlapGlobalPercent.toFixed(1)}%)`);
      console.log(`[diagnostic] WARNING: Batch #${batch}: ${overlapGlobal} duplicate IDs detected`);
    }

    if (overlapGlobalPercent > 5) {
      return fail(report, `Batch #${batch}: overlap ${overlapGlobalPercent.toFixed(1)}% > 5% threshold — repeat window detected`);
    }

    // CHECK: Identical batch (100% overlap with previous)
    if (previousBatchIds.size > 0 && overlapPrevious === batchIds.length) {
      return fail(report, `Batch #${batch}: 100% identical to previous batch — API returning same data`);
    }

    // Count duplicates
    const newDuplicates = batchIds.filter(id => globalSeenIds.has(id)).length;
    report.duplicateIds += newDuplicates;

    if (newDuplicates > 0) {
      return fail(report, `Batch #${batch}: ${newDuplicates} duplicate IDs detected — aborting`);
    }

    // Update tracking
    batchIds.forEach(id => globalSeenIds.add(id));
    if (batch === 1) globalMaxId = batchMaxId;
    report.highestIdSeen = Math.max(report.highestIdSeen, batchMaxId);
    report.lowestIdSeen = Math.min(report.lowestIdSeen, batchMinId);
    report.totalTicketsRetrieved += batchIds.length;

    const batchLogEntry: BatchLog = {
      batchNumber: batch,
      maxId: batchMaxId,
      minId: batchMinId,
      count: batchIds.length,
      overlapWithPrevious: overlapPrevious,
      overlapWithGlobal: overlapGlobal,
    };
    report.batchLog.push(batchLogEntry);

    console.log(`[diagnostic] Batch #${batch}: ${batchIds.length} tickets, IDs ${batchMaxId}→${batchMinId}, overlap prev=${overlapPrevious} global=${overlapGlobal}`);

    // CHECK: Final batch should have fewer than BATCH_SIZE
    if (batchIds.length < BATCH_SIZE) {
      console.log(`[diagnostic] Batch #${batch}: Partial batch (${batchIds.length} < ${BATCH_SIZE}) — natural termination`);
      report.batchesProcessed = batch;
      break;
    }

    previousBatchIds = new Set(batchIds);
    lastMinId = batchMinId;
    report.batchesProcessed = batch;
  }

  report.uniqueTickets = globalSeenIds.size;

  // Final summary
  console.log("\n[diagnostic] === PAGINATION DIAGNOSTIC REPORT ===");
  console.log(`Total API calls: ${report.totalApiCalls}`);
  console.log(`Total tickets retrieved: ${report.totalTicketsRetrieved}`);
  console.log(`Unique tickets: ${report.uniqueTickets}`);
  console.log(`Duplicate IDs: ${report.duplicateIds}`);
  console.log(`Highest ID seen: ${report.highestIdSeen}`);
  console.log(`Lowest ID seen: ${report.lowestIdSeen}`);
  console.log(`Batches processed: ${report.batchesProcessed}`);
  console.log(`Continuity violations: ${report.continuityViolations}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Errors: ${report.errors.length}`);
  console.log(`Status: ${report.status}`);
  console.log("[diagnostic] === END ===\n");

  return report;
}
