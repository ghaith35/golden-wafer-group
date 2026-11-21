-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "email" TEXT,
    "rc" TEXT,
    "nif" TEXT,
    "ai" TEXT,
    "nis" TEXT,
    "bankName" TEXT,
    "rib" TEXT,
    "logoUrl" TEXT,
    "signatureUrl" TEXT,
    "stampUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL DEFAULT 'ar',
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "expiryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creditSalesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "debtTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "remiseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "depositsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "multiDepotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "costingMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "facturePro" BOOLEAN NOT NULL DEFAULT false,
    "posEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vanBindingMode" TEXT NOT NULL DEFAULT 'LOCKED',
    "oversellAllowed" BOOLEAN NOT NULL DEFAULT true,
    "pieceSalesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transferConfirmRequired" BOOLEAN NOT NULL DEFAULT true,
    "gpsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qrStrictMode" BOOLEAN NOT NULL DEFAULT true,
    "ticketWidth" TEXT NOT NULL DEFAULT '80',
    "ticketLang" TEXT NOT NULL DEFAULT 'fr',
    "supplierFilterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "threePackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "workStartAt" TEXT,
    "maxDayHours" REAL DEFAULT 10,
    "remoteDomain" TEXT,
    CONSTRAINT "company_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_tiers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "expense_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Wilaya" (
    "code" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nameFr" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "secteurs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "secteurs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "secteurs_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "passwordView" TEXT,
    "qrToken" TEXT,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Vendeur',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "secteurId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_areas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_areas_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya" ("code") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_areas_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "super_admin_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "super_admin_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "super_admin_audits_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "super_admin_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DEPOT',
    "marque" TEXT,
    "matricule" TEXT,
    "imageUrl" TEXT,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLat" REAL,
    "lastLng" REAL,
    "lastSeenAt" DATETIME,
    "locateRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "stores_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "number" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "cashAmount" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "declaredById" TEXT,
    "confirmedById" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "opId" TEXT,
    CONSTRAINT "transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transfers_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transfers_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "declaredQty" DECIMAL NOT NULL,
    "confirmedQty" DECIMAL,
    CONSTRAINT "transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transfer_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "locationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_counts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_counts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" DECIMAL NOT NULL,
    "countedQty" DECIMAL NOT NULL,
    CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_count_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_losses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "baseQty" DECIMAL NOT NULL,
    "motive" TEXT NOT NULL,
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_losses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_losses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_losses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seasons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legacyQr" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "wilayaCode" INTEGER,
    "secteurId" TEXT,
    "activityType" TEXT,
    "rc" TEXT,
    "ai" TEXT,
    "nif" TEXT,
    "nis" TEXT,
    "rib" TEXT,
    "tierId" TEXT,
    "creditLimit" DECIMAL NOT NULL DEFAULT 0,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "gpsLat" REAL,
    "gpsLng" REAL,
    "portalSecretHash" TEXT,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "opId" TEXT,
    CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya" ("code") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customers_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customers_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "code" TEXT,
    "wilayaCode" INTEGER,
    "secteurId" TEXT,
    "notes" TEXT,
    CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "suppliers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya" ("code") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "suppliers_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "barcode" TEXT,
    "colisage" TEXT,
    "baseUnitId" TEXT,
    "saleUnitId" TEXT,
    "purchaseUnitId" TEXT,
    "salePrice" DECIMAL NOT NULL DEFAULT 0,
    "costPrice" DECIMAL NOT NULL DEFAULT 0,
    "stockQty" DECIMAL NOT NULL DEFAULT 0,
    "minStock" DECIMAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_saleUnitId_fkey" FOREIGN KEY ("saleUnitId") REFERENCES "units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_unit_conversions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "factor" DECIMAL NOT NULL,
    "barcode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_unit_conversions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_unit_conversions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_tier_prices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_tier_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_tier_prices_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT NOT NULL DEFAULT 'DEPOT',
    "number" TEXT NOT NULL,
    "clientId" TEXT,
    "locationId" TEXT,
    "tierId" TEXT,
    "createdById" TEXT,
    "tourneeId" TEXT,
    "sourceId" TEXT,
    "remise" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "paid" DECIMAL NOT NULL DEFAULT 0,
    "offList" BOOLEAN NOT NULL DEFAULT false,
    "qrScanned" BOOLEAN NOT NULL DEFAULT false,
    "isPortal" BOOLEAN NOT NULL DEFAULT false,
    "saleLat" REAL,
    "saleLng" REAL,
    "saleDistM" REAL,
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "opId" TEXT,
    CONSTRAINT "sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sales_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sales_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sales_tourneeId_fkey" FOREIGN KEY ("tourneeId") REFERENCES "tournees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sales_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sales" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "qty" DECIMAL NOT NULL,
    "baseQty" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "remise" DECIMAL NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL DEFAULT 0,
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "bonusRuleId" TEXT,
    CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "client_returns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "locationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "refundType" TEXT NOT NULL,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opId" TEXT,
    CONSTRAINT "client_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "client_returns_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "client_returns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "client_return_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "baseQty" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "lineTotal" DECIMAL NOT NULL,
    CONSTRAINT "client_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "client_returns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "client_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tournees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "locationId" TEXT NOT NULL,
    "secteurId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "startedLat" REAL,
    "startedLng" REAL,
    "finishedLat" REAL,
    "finishedLng" REAL,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tournees_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tournees_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tournee_stops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tourneeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visited" BOOLEAN NOT NULL DEFAULT false,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "total" DECIMAL NOT NULL DEFAULT 0,
    CONSTRAINT "tournee_stops_tourneeId_fkey" FOREIGN KEY ("tourneeId") REFERENCES "tournees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tournee_stops_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT NOT NULL,
    "label" TEXT,
    "phone" TEXT,
    "specs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token" TEXT,
    "activationKey" TEXT,
    "activationType" TEXT NOT NULL DEFAULT 'machine',
    "consumedByMachineId" TEXT,
    "trialStart" DATETIME,
    "trialEnd" DATETIME,
    "activatedAt" DATETIME,
    "contactName" TEXT,
    "city" TEXT,
    "workshop" TEXT,
    "email" TEXT,
    "deviceSpecs" JSONB,
    "trialIp" TEXT,
    "lastIp" TEXT,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "machine_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'trial',
    "expiresAt" DATETIME,
    "graceEndsAt" DATETIME,
    "activatedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "machine_subscriptions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines" ("machineId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "blocked_ips" (
    "ip" TEXT NOT NULL PRIMARY KEY,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "license_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT,
    "label" TEXT,
    "humanKey" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "consumedByMachineId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "trial_issues" (
    "machineId" TEXT NOT NULL PRIMARY KEY,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tunnel_slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subdomain" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tunnelId" TEXT,
    "token" TEXT,
    "clientMachineId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "client_deployments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domainOverride" TEXT,
    "overrideActive" BOOLEAN NOT NULL DEFAULT false,
    "machineId" TEXT,
    "tunnelSlotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "client_deployments_tunnelSlotId_fkey" FOREIGN KEY ("tunnelSlotId") REFERENCES "tunnel_slots" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "devices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_ops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT,
    "opId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "resultId" TEXT,
    "occurredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_ops_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sync_ops_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remise" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "paid" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "purchase_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "qty" DECIMAL NOT NULL,
    "freeQty" DECIMAL NOT NULL DEFAULT 0,
    "baseQty" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "remise" DECIMAL NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL NOT NULL,
    "expiryDate" DATETIME,
    "batchId" TEXT,
    CONSTRAINT "purchase_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchase_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT,
    "transferId" TEXT,
    "qty" DECIMAL NOT NULL,
    "initialQty" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "expiryDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_batches_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stock_batches_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "supplierId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "number" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "supplier_returns_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "baseQty" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "lineTotal" DECIMAL NOT NULL,
    CONSTRAINT "supplier_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "supplier_returns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "typeId" TEXT,
    "locationId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL NOT NULL,
    "expenseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "opId" TEXT,
    CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expenses_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "expense_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "versements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "kind" TEXT NOT NULL,
    "clientId" TEXT,
    "supplierId" TEXT,
    "transferId" TEXT,
    "purchaseInvoiceId" TEXT,
    "locationId" TEXT,
    "tourneeId" TEXT,
    "amount" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opId" TEXT,
    CONSTRAINT "versements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "versements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "versements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "versements_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "versements_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_closes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "vanId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "expected" DECIMAL NOT NULL DEFAULT 0,
    "collected" DECIMAL NOT NULL DEFAULT 0,
    "clientPayments" DECIMAL NOT NULL DEFAULT 0,
    "expenses" DECIMAL NOT NULL DEFAULT 0,
    "returnsCash" DECIMAL NOT NULL DEFAULT 0,
    "dueTotal" DECIMAL NOT NULL DEFAULT 0,
    "declared" DECIMAL,
    "declaredById" TEXT,
    "declaredAt" DATETIME,
    "remitted" DECIMAL NOT NULL DEFAULT 0,
    "difference" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "closedById" TEXT,
    "closedAt" DATETIME,
    "notes" TEXT,
    CONSTRAINT "daily_closes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "daily_closes_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deposits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deposits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextNo" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "client_distances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "distanceM" REAL NOT NULL,
    "durationS" REAL NOT NULL,
    "atLat" REAL NOT NULL,
    "atLng" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'estimate',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "client_distances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "client_distances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "client_distances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "three_pack_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "three_pack_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "three_pack_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colis" DECIMAL NOT NULL,
    CONSTRAINT "three_pack_items_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "three_pack_rules" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "three_pack_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_companyId_key" ON "company_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "units_companyId_name_key" ON "units"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "price_tiers_companyId_name_key" ON "price_tiers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_types_companyId_name_key" ON "expense_types"("companyId", "name");

-- CreateIndex
CREATE INDEX "secteurs_companyId_wilayaCode_idx" ON "secteurs"("companyId", "wilayaCode");

-- CreateIndex
CREATE UNIQUE INDEX "secteurs_companyId_wilayaCode_name_key" ON "secteurs"("companyId", "wilayaCode", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_qrToken_key" ON "users"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_username_key" ON "users"("companyId", "username");

-- CreateIndex
CREATE INDEX "user_areas_userId_idx" ON "user_areas"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "super_admin_users_username_key" ON "super_admin_users"("username");

-- CreateIndex
CREATE INDEX "super_admin_audits_adminId_createdAt_idx" ON "super_admin_audits"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stores_companyId_userId_key" ON "stores"("companyId", "userId");

-- CreateIndex
CREATE INDEX "transfers_companyId_status_idx" ON "transfers"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_companyId_number_key" ON "transfers"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_companyId_opId_key" ON "transfers"("companyId", "opId");

-- CreateIndex
CREATE INDEX "transfer_lines_transferId_idx" ON "transfer_lines"("transferId");

-- CreateIndex
CREATE INDEX "stock_counts_companyId_locationId_idx" ON "stock_counts"("companyId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_companyId_number_key" ON "stock_counts"("companyId", "number");

-- CreateIndex
CREATE INDEX "stock_count_lines_countId_idx" ON "stock_count_lines"("countId");

-- CreateIndex
CREATE INDEX "stock_losses_companyId_locationId_idx" ON "stock_losses"("companyId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_companyId_year_month_key" ON "seasons"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "customers_companyId_name_idx" ON "customers"("companyId", "name");

-- CreateIndex
CREATE INDEX "customers_companyId_secteurId_idx" ON "customers"("companyId", "secteurId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_code_key" ON "customers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_legacyQr_key" ON "customers"("companyId", "legacyQr");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_phone_key" ON "customers"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_opId_key" ON "customers"("companyId", "opId");

-- CreateIndex
CREATE INDEX "suppliers_companyId_name_idx" ON "suppliers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_code_key" ON "suppliers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_companyId_name_key" ON "product_categories"("companyId", "name");

-- CreateIndex
CREATE INDEX "products_companyId_name_idx" ON "products"("companyId", "name");

-- CreateIndex
CREATE INDEX "products_companyId_barcode_idx" ON "products"("companyId", "barcode");

-- CreateIndex
CREATE INDEX "products_companyId_reference_idx" ON "products"("companyId", "reference");

-- CreateIndex
CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_unit_conversions_barcode_idx" ON "product_unit_conversions"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_unit_conversions_productId_unitId_key" ON "product_unit_conversions"("productId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "product_tier_prices_productId_tierId_key" ON "product_tier_prices"("productId", "tierId");

-- CreateIndex
CREATE INDEX "sales_companyId_clientId_idx" ON "sales"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "sales_companyId_status_idx" ON "sales"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_kind_number_key" ON "sales"("companyId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_opId_key" ON "sales"("companyId", "opId");

-- CreateIndex
CREATE INDEX "sale_lines_saleId_idx" ON "sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "client_returns_companyId_clientId_idx" ON "client_returns"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_returns_companyId_number_key" ON "client_returns"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "client_returns_companyId_opId_key" ON "client_returns"("companyId", "opId");

-- CreateIndex
CREATE INDEX "client_return_lines_returnId_idx" ON "client_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "tournees_companyId_date_idx" ON "tournees"("companyId", "date");

-- CreateIndex
CREATE INDEX "tournees_companyId_locationId_idx" ON "tournees"("companyId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "tournee_stops_tourneeId_clientId_key" ON "tournee_stops"("tourneeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "machines_machineId_key" ON "machines"("machineId");

-- CreateIndex
CREATE INDEX "machines_status_createdAt_idx" ON "machines"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "machine_subscriptions_machineId_key" ON "machine_subscriptions"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "license_keys_humanKey_key" ON "license_keys"("humanKey");

-- CreateIndex
CREATE UNIQUE INDEX "tunnel_slots_subdomain_key" ON "tunnel_slots"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "client_deployments_client_key" ON "client_deployments"("client");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tokenHash_key" ON "devices"("tokenHash");

-- CreateIndex
CREATE INDEX "devices_companyId_idx" ON "devices"("companyId");

-- CreateIndex
CREATE INDEX "sync_ops_companyId_deviceId_idx" ON "sync_ops"("companyId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_ops_companyId_opId_key" ON "sync_ops"("companyId", "opId");

-- CreateIndex
CREATE INDEX "purchase_invoices_companyId_supplierId_idx" ON "purchase_invoices"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_companyId_number_key" ON "purchase_invoices"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lines_batchId_key" ON "purchase_lines"("batchId");

-- CreateIndex
CREATE INDEX "purchase_lines_invoiceId_idx" ON "purchase_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "stock_batches_companyId_productId_idx" ON "stock_batches"("companyId", "productId");

-- CreateIndex
CREATE INDEX "stock_batches_productId_expiryDate_idx" ON "stock_batches"("productId", "expiryDate");

-- CreateIndex
CREATE INDEX "supplier_returns_companyId_supplierId_idx" ON "supplier_returns"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_companyId_number_key" ON "supplier_returns"("companyId", "number");

-- CreateIndex
CREATE INDEX "supplier_return_lines_returnId_idx" ON "supplier_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "expenses_companyId_expenseDate_idx" ON "expenses"("companyId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_companyId_typeId_idx" ON "expenses"("companyId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_companyId_opId_key" ON "expenses"("companyId", "opId");

-- CreateIndex
CREATE INDEX "versements_companyId_date_idx" ON "versements"("companyId", "date");

-- CreateIndex
CREATE INDEX "versements_companyId_clientId_idx" ON "versements"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "versements_companyId_supplierId_idx" ON "versements"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "versements_companyId_locationId_date_idx" ON "versements"("companyId", "locationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "versements_companyId_opId_key" ON "versements"("companyId", "opId");

-- CreateIndex
CREATE INDEX "daily_closes_companyId_date_idx" ON "daily_closes"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closes_companyId_vanId_date_key" ON "daily_closes"("companyId", "vanId", "date");

-- CreateIndex
CREATE INDEX "deposits_companyId_clientId_idx" ON "deposits"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_companyId_storeId_type_year_key" ON "document_sequences"("companyId", "storeId", "type", "year");

-- CreateIndex
CREATE INDEX "client_distances_companyId_userId_idx" ON "client_distances"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "client_distances_companyId_userId_clientId_key" ON "client_distances"("companyId", "userId", "clientId");

-- CreateIndex
CREATE INDEX "three_pack_rules_companyId_idx" ON "three_pack_rules"("companyId");

-- CreateIndex
CREATE INDEX "three_pack_items_ruleId_idx" ON "three_pack_items"("ruleId");

-- CreateIndex
CREATE INDEX "three_pack_items_productId_idx" ON "three_pack_items"("productId");
