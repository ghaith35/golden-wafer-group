# DISTRIBUILI — Product

Wholesale **distribution / gros** ERP for Arabic-speaking markets (Algeria / Maghreb first).

## Users
Distributors with a depot + delivery vans. Owner needs margin, stock, and debt picture; salesmen/storekeepers need fast entry.

## Modules (roadmap)
1. **Clients & Suppliers** — profiles, balances, debt ledger
2. **Inventory** — products, categories, depots (stores), stock batches, FIFO costing
3. **Purchases** — supplier invoices, returns
4. **Sales** — orders, delivery, returns, discounts
5. **Cash & Debts** — payments, deposits, client/supplier balances
6. **Expenses, Reports, Settings**

## Stack (same as Jafraa/REPAIRE)
Next.js 16 + React 19 + TS strict, Tailwind v4, next-intl (ar/fr/en, ar default RTL),
Prisma 7 + Postgres (server) / SQLite-libSQL (offline Electron), jose JWT cookies,
Electron offline desktop, Docker home-server deploy.
