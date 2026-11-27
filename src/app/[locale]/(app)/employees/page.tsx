import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listEmployeeRows } from "@/lib/employees/service";
import { EmployeesClient } from "./EmployeesClient";

/// Admin-only payroll: staff users (Livreur / Vendeur) with an "Employee"
/// toggle, fixed salary, advances and monthly payslips.
export default async function EmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const rows = await listEmployeeRows(session.companyId, year, month);
  return <EmployeesClient locale={locale} initialRows={rows} initialYear={year} initialMonth={month} />;
}
