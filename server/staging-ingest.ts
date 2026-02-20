const fetch = globalThis.fetch;

const API_BASE = "https://dyreid.pureservice.com/agent/api";
const API_KEY = process.env.PURESERVICE_API_KEY!;
const BATCH_SIZE = 200;
const TARGET = 5000;

interface IngestProgress {
  totalFetched: number;
  totalStored: number;
  duplicatesSkipped: number;
  batchesProcessed: number;
  highestId: number;
  lowestId: number;
  errors: string[];
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

export async function runStagingIngest(
  onProgress?: (msg: string, progress: number) => void
): Promise<IngestProgress> {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");

  const result: IngestProgress = {
    totalFetched: 0,
    totalStored: 0,
    duplicatesSkipped: 0,
    batchesProcessed: 0,
    highestId: 0,
    lowestId: Infinity,
    errors: [],
  };

  let lastMinId: number | null = null;

  const notify = (msg: string, pct: number) => {
    console.log(`[staging-ingest] ${msg}`);
    onProgress?.(msg, pct);
  };

  notify("Starting staging ingestion of 5000 newest tickets...", 0);

  while (result.totalStored < TARGET) {
    const url = lastMinId === null
      ? `${API_BASE}/ticket?sort=-id&limit=${BATCH_SIZE}`
      : `${API_BASE}/ticket?sort=-id&limit=${BATCH_SIZE}&filter=id<${lastMinId}`;

    const batchNum = result.batchesProcessed + 1;
    notify(`Batch #${batchNum}: Fetching (lastMinId=${lastMinId ?? "none"})...`, Math.round((result.totalStored / TARGET) * 100));

    const tickets = await apiGet(url);

    if (!Array.isArray(tickets) || tickets.length === 0) {
      notify(`Batch #${batchNum}: Empty response — done`, 100);
      break;
    }

    const batchIds = tickets.map((t: any) => t.id);
    const batchMaxId = batchIds[0];
    const batchMinId = batchIds[batchIds.length - 1];

    if (lastMinId !== null && batchMaxId >= lastMinId) {
      result.errors.push(`Continuity violation at batch #${batchNum}`);
      break;
    }

    let storedInBatch = 0;
    for (const t of tickets) {
      try {
        await db.execute(sql`
          INSERT INTO staging_tickets (
            ticket_id, subject, description, solution, email_address,
            status_id, category1_id, category2_id, category3_id,
            priority_id, assigned_agent_id, assigned_department_id,
            assigned_team_id, resolved_by_id, user_id,
            reopened_count, reopen_children, origin, source_id,
            ticket_type_id, request_type_id, channel_id, visibility,
            is_marked_for_deletion, total_timelog_minutes,
            created_at, modified_at, resolved_at, closed_at,
            reopened_at, responded_at, raw_json
          ) VALUES (
            ${t.id}, ${t.subject}, ${t.description}, ${t.solution},
            ${t.emailAddress}, ${t.statusId}, ${t.category1Id},
            ${t.category2Id}, ${t.category3Id}, ${t.priorityId},
            ${t.assignedAgentId}, ${t.assignedDepartmentId},
            ${t.assignedTeamId}, ${t.resolvedById}, ${t.userId},
            ${t.reopenedCount}, ${t.reopenChildren}, ${t.origin},
            ${t.sourceId}, ${t.ticketTypeId}, ${t.requestTypeId},
            ${t.channelId}, ${t.visibility}, ${t.isMarkedForDeletion},
            ${t.totalTimelogMinutes},
            ${t.created ? new Date(t.created) : null},
            ${t.modified ? new Date(t.modified) : null},
            ${t.resolved ? new Date(t.resolved) : null},
            ${t.closed ? new Date(t.closed) : null},
            ${t.reopened ? new Date(t.reopened) : null},
            ${t.responded ? new Date(t.responded) : null},
            ${JSON.stringify(t)}::jsonb
          )
          ON CONFLICT (ticket_id) DO NOTHING
        `);
        storedInBatch++;
      } catch (err: any) {
        if (!err.message?.includes("duplicate")) {
          result.errors.push(`Ticket ${t.id}: ${err.message}`);
        }
        result.duplicatesSkipped++;
      }
    }

    result.totalFetched += tickets.length;
    result.totalStored += storedInBatch;
    result.batchesProcessed = batchNum;
    result.highestId = Math.max(result.highestId, batchMaxId);
    result.lowestId = Math.min(result.lowestId, batchMinId);

    notify(`Batch #${batchNum}: ${storedInBatch} stored, IDs ${batchMaxId}→${batchMinId}`, Math.round((result.totalStored / TARGET) * 100));

    lastMinId = batchMinId;

    if (tickets.length < BATCH_SIZE) {
      notify(`Batch #${batchNum}: Partial batch — terminating`, 100);
      break;
    }
  }

  notify(`Done: ${result.totalStored} tickets stored, ${result.duplicatesSkipped} skipped`, 100);
  return result;
}

export async function runStagingAnalysis(): Promise<any> {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");

  const totalRows = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM staging_tickets`);
  const total = (totalRows.rows[0] as any).cnt;

  const categoryDist = await db.execute(sql`
    SELECT category1_id, COUNT(*)::int as cnt
    FROM staging_tickets
    GROUP BY category1_id
    ORDER BY cnt DESC
  `);

  const statusDist = await db.execute(sql`
    SELECT status_id, COUNT(*)::int as cnt
    FROM staging_tickets
    GROUP BY status_id
    ORDER BY cnt DESC
  `);

  const yearDist = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM created_at)::int as year, COUNT(*)::int as cnt
    FROM staging_tickets
    WHERE created_at IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
  `);

  const reopenStats = await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE reopened_count > 0)::int as reopened,
      ROUND(100.0 * COUNT(*) FILTER (WHERE reopened_count > 0) / NULLIF(COUNT(*), 0), 2) as reopen_rate_pct
    FROM staging_tickets
  `);

  const solutionStats = await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE solution IS NULL OR solution = '' OR solution = 'No contents')::int as no_solution,
      ROUND(100.0 * COUNT(*) FILTER (WHERE solution IS NULL OR solution = '' OR solution = 'No contents') / NULLIF(COUNT(*), 0), 2) as no_solution_pct,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY LENGTH(solution)) FILTER (WHERE solution IS NOT NULL AND solution != '' AND solution != 'No contents') as solution_length_median,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY LENGTH(solution)) FILTER (WHERE solution IS NOT NULL AND solution != '' AND solution != 'No contents') as solution_length_p95
    FROM staging_tickets
  `);

  const descriptionStats = await db.execute(sql`
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY LENGTH(description)) FILTER (WHERE description IS NOT NULL AND description != '' AND description != 'No contents') as desc_length_median,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY LENGTH(description)) FILTER (WHERE description IS NOT NULL AND description != '' AND description != 'No contents') as desc_length_p95
    FROM staging_tickets
  `);

  const agentStats = await db.execute(sql`
    SELECT
      COUNT(DISTINCT assigned_agent_id) FILTER (WHERE assigned_agent_id IS NOT NULL)::int as unique_agents,
      COUNT(DISTINCT resolved_by_id) FILTER (WHERE resolved_by_id IS NOT NULL)::int as unique_resolvers
    FROM staging_tickets
  `);

  const deletionStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE is_marked_for_deletion = true)::int as marked_for_deletion,
      ROUND(100.0 * COUNT(*) FILTER (WHERE is_marked_for_deletion = true) / NULLIF(COUNT(*), 0), 2) as deletion_pct
    FROM staging_tickets
  `);

  const originDist = await db.execute(sql`
    SELECT origin, COUNT(*)::int as cnt
    FROM staging_tickets
    GROUP BY origin
    ORDER BY cnt DESC
  `);

  const channelDist = await db.execute(sql`
    SELECT channel_id, COUNT(*)::int as cnt
    FROM staging_tickets
    GROUP BY channel_id
    ORDER BY cnt DESC
  `);

  const autoGenerated = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE solution ILIKE '%auto%' OR solution ILIKE '%automatisk%' OR solution ILIKE '%<div%' OR solution ILIKE '%template%')::int as possible_auto,
      ROUND(100.0 * COUNT(*) FILTER (WHERE solution ILIKE '%auto%' OR solution ILIKE '%automatisk%' OR solution ILIKE '%<div%' OR solution ILIKE '%template%') / NULLIF(COUNT(*) FILTER (WHERE solution IS NOT NULL AND solution != '' AND solution != 'No contents'), 0), 2) as auto_pct
    FROM staging_tickets
  `);

  const idRange = await db.execute(sql`
    SELECT MIN(ticket_id)::int as min_id, MAX(ticket_id)::int as max_id
    FROM staging_tickets
  `);

  return {
    total,
    idRange: idRange.rows[0],
    categoryDistribution: categoryDist.rows,
    statusDistribution: statusDist.rows,
    yearDistribution: yearDist.rows,
    reopenStats: reopenStats.rows[0],
    solutionStats: solutionStats.rows[0],
    descriptionStats: descriptionStats.rows[0],
    agentStats: agentStats.rows[0],
    deletionStats: deletionStats.rows[0],
    originDistribution: originDist.rows,
    channelDistribution: channelDist.rows,
    autoGenerated: autoGenerated.rows[0],
  };
}
