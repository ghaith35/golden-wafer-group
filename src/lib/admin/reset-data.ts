import { prisma } from "@/lib/db";

/// Per-section data reset (Settings → Data). Every scope deletes what it
/// names PLUS the records that cannot exist without it (a sale line needs its
/// product, a sale needs its client…), so the database never ends up with
/// dangling references. Kept on purpose: company, settings, admin accounts,
/// the main depot and the configuration lists (units, price tiers, sectors,
/// expense types).

export const RESET_SCOPES = [
  "clients", "suppliers", "products", "stock", "sales", "orders", "purchases",
  "transfers", "expenses", "cash", "tournees", "staff", "all",
] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

type SalesMode = "all" | "nonOrder" | "orders" | "withClient";
type Flags = Partial<{
  distances: boolean; devices: boolean; syncOps: boolean;
  versementsClient: boolean; versementsSupplier: boolean;
  deposits: boolean; dailyCloses: boolean; expenses: boolean;
  clientReturns: boolean; supplierReturns: boolean;
  sales: SalesMode; purchases: boolean;
  transfers: boolean; counts: boolean; losses: boolean;
  batches: "all" | "holding";
  tournees: boolean;
  products: boolean; customers: boolean; suppliers: boolean;
  vans: boolean; staffUsers: boolean;
  zeroBalancesClients: boolean; zeroBalancesSuppliers: boolean; zeroStock: boolean;
  sequences: boolean;
}>;

const EVERYTHING: Flags = {
  distances: true, devices: true, syncOps: true,
  versementsClient: true, versementsSupplier: true, deposits: true, dailyCloses: true, expenses: true,
  clientReturns: true, supplierReturns: true, sales: "all", purchases: true,
  transfers: true, counts: true, losses: true, batches: "all", tournees: true,
  products: true, customers: true, suppliers: true, vans: true, staffUsers: true,
  zeroBalancesClients: true, zeroBalancesSuppliers: true, zeroStock: true, sequences: true,
};

const SCOPES: Record<ResetScope, Flags> = {
  clients: { customers: true, distances: true, clientReturns: true, versementsClient: true, deposits: true, sales: "withClient" },
  suppliers: { suppliers: true, purchases: true, supplierReturns: true, versementsSupplier: true },
  products: {
    products: true, sales: "all", clientReturns: true, purchases: true, supplierReturns: true,
    transfers: true, counts: true, losses: true, batches: "all",
    versementsClient: true, versementsSupplier: true, zeroBalancesClients: true, zeroBalancesSuppliers: true, zeroStock: true,
  },
  stock: { transfers: true, counts: true, losses: true, batches: "all", zeroStock: true },
  sales: { sales: "nonOrder", clientReturns: true, versementsClient: true, deposits: true, zeroBalancesClients: true },
  orders: { sales: "orders" },
  purchases: { purchases: true, supplierReturns: true, versementsSupplier: true, zeroBalancesSuppliers: true },
  transfers: { transfers: true, batches: "holding" },
  expenses: { expenses: true },
  cash: { dailyCloses: true, deposits: true },
  tournees: { tournees: true },
  // vans + drivers/salespeople: their van-bound documents go with them
  staff: { vans: true, staffUsers: true, devices: true, syncOps: true, distances: true, tournees: true, transfers: true, counts: true, losses: true, clientReturns: true, dailyCloses: true, batches: "all" },
  all: EVERYTHING,
};

export type ResetCounts = Record<Exclude<ResetScope, "all">, number>;

export async function resetCounts(companyId: string): Promise<ResetCounts> {
  const c = { companyId };
  const [customers, suppliers, products, batches, nonOrder, orders, purchases, transfers, expenses, closes, deposits, tournees, vans, staff] =
    await Promise.all([
      prisma.customer.count({ where: c }),
      prisma.supplier.count({ where: c }),
      prisma.product.count({ where: c }),
      prisma.stockBatch.count({ where: { ...c, qty: { gt: 0 } } }),
      prisma.sale.count({ where: { ...c, kind: { not: "ORDER" } } }),
      prisma.sale.count({ where: { ...c, kind: "ORDER" } }),
      prisma.purchaseInvoice.count({ where: c }),
      prisma.transfer.count({ where: c }),
      prisma.expense.count({ where: c }),
      prisma.dailyClose.count({ where: c }),
      prisma.deposit.count({ where: c }),
      prisma.tournee.count({ where: c }),
      prisma.store.count({ where: { ...c, kind: "VAN" } }),
      prisma.user.count({ where: { ...c, role: { not: "Admin" } } }),
    ]);
  return {
    clients: customers, suppliers, products, stock: batches, sales: nonOrder, orders, purchases,
    transfers, expenses, cash: closes + deposits, tournees, staff: vans + staff,
  };
}

/// Best-effort safety copy of the desktop (SQLite) database before wiping.
async function backupLocalDb(): Promise<string | null> {
  try {
    if (process.env.DISTRIBUILI_DB !== "local") return null;
    const url = process.env.DISTRIBUILI_SQLITE_URL ?? "";
    if (!url.startsWith("file:")) return null;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = url.slice(5).replace(/^\/\//, "/").split("?")[0];
    if (!fs.existsSync(src)) return null;
    const dir = path.join(path.dirname(src), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `before-reset-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    fs.copyFileSync(src, dest);
    return dest;
  } catch {
    return null;
  }
}

export async function resetScope(companyId: string, scope: ResetScope): Promise<{ backup: string | null }> {
  const f = SCOPES[scope];
  const backup = await backupLocalDb();
  await prisma.$transaction(
    async (tx) => {
      const co = { companyId };
      const vanIds = f.vans || scope === "staff"
        ? (await tx.store.findMany({ where: { ...co, kind: "VAN" }, select: { id: true } })).map((v) => v.id)
        : [];
      const staffOnly = scope === "staff";
      const atVans = <T extends string>(key: T) => (staffOnly ? { [key]: { in: vanIds } } : {});

      if (f.distances) await tx.clientDistance.deleteMany({ where: co });
      if (f.syncOps) await tx.syncOp.deleteMany({ where: co });
      if (f.devices) await tx.device.deleteMany({ where: co });

      if (f.versementsClient && f.versementsSupplier) await tx.versement.deleteMany({ where: co });
      else {
        if (f.versementsClient) await tx.versement.deleteMany({ where: { ...co, clientId: { not: null } } });
        if (f.versementsSupplier) await tx.versement.deleteMany({ where: { ...co, supplierId: { not: null } } });
      }
      if (f.deposits) await tx.deposit.deleteMany({ where: co });
      if (f.dailyCloses) await tx.dailyClose.deleteMany({ where: { ...co, ...atVans("vanId") } });
      if (f.expenses) await tx.expense.deleteMany({ where: co });

      if (f.clientReturns) await tx.clientReturn.deleteMany({ where: { ...co, ...atVans("locationId") } });
      if (f.supplierReturns) await tx.supplierReturn.deleteMany({ where: co });

      if (f.sales) {
        const kind =
          f.sales === "orders" ? { kind: "ORDER" as const }
          : f.sales === "nonOrder" ? { kind: { not: "ORDER" as const } }
          : {};
        const withClient = f.sales === "withClient" ? { clientId: { not: null } } : {};
        await tx.sale.deleteMany({ where: { ...co, ...kind, ...withClient } });
      }
      if (f.purchases) await tx.purchaseInvoice.deleteMany({ where: co });

      if (f.transfers) {
        await tx.transfer.deleteMany({
          where: staffOnly ? { ...co, OR: [{ fromLocationId: { in: vanIds } }, { toLocationId: { in: vanIds } }] } : co,
        });
      }
      if (f.counts) await tx.stockCount.deleteMany({ where: { ...co, ...atVans("locationId") } });
      if (f.losses) await tx.stockLoss.deleteMany({ where: { ...co, ...atVans("locationId") } });
      if (f.batches === "all") await tx.stockBatch.deleteMany({ where: staffOnly ? { ...co, storeId: { in: vanIds } } : co });
      if (f.batches === "holding") await tx.stockBatch.deleteMany({ where: { ...co, transferId: { not: null } } });

      if (f.tournees) await tx.tournee.deleteMany({ where: { ...co, ...atVans("locationId") } });

      if (f.products) {
        // 3pack rules reference products (Restrict): they go first (items cascade).
        await tx.threePackRule.deleteMany({ where: co });
        await tx.product.deleteMany({ where: co });
        await tx.productCategory.deleteMany({ where: co });
      }
      if (f.customers) await tx.customer.deleteMany({ where: co });
      if (f.suppliers) await tx.supplier.deleteMany({ where: co });

      if (f.vans) await tx.store.deleteMany({ where: { ...co, kind: "VAN" } });
      if (f.staffUsers) await tx.user.deleteMany({ where: { ...co, role: { not: "Admin" } } });

      if (f.zeroBalancesClients && !f.customers) await tx.customer.updateMany({ where: co, data: { balance: 0 } });
      if (f.zeroBalancesSuppliers && !f.suppliers) await tx.supplier.updateMany({ where: co, data: { balance: 0 } });
      if (f.zeroStock && !f.products) await tx.product.updateMany({ where: co, data: { stockQty: 0 } });
      if (f.sequences) {
        await tx.documentSequence.deleteMany({ where: co });
        await tx.season.deleteMany({ where: co });
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
  return { backup };
}
