import { NextRequest } from "next/server";
import { listRuns, deleteRun, clearRuns } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/history?search=&limit=  → past council runs, newest first.
export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams.get("search") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
    return Response.json({ runs: listRuns({ search, limit }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "history failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/history?id=N   → delete one run
// DELETE /api/history?all=1  → wipe history
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const all = req.nextUrl.searchParams.get("all");
    if (all === "1") clearRuns();
    else if (id) deleteRun(Number(id));
    else return Response.json({ error: "pass ?id= or ?all=1" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
