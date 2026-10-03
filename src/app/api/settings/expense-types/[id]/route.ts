import { listRoutes, patchListItem, deleteListItem } from "@/lib/settings/list-routes";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return patchListItem("expenseType", req, params);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return deleteListItem("expenseType", params);
}
