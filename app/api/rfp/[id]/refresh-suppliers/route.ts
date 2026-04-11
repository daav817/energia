import { NextRequest, NextResponse } from "next/server";
import { CalendarEventType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { localDateFromDayInput } from "@/lib/calendar-date";
import { resendStoredRfpSupplierEmails } from "@/app/api/rfp/send/route";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { quoteDueDate?: unknown };
    const raw = typeof body.quoteDueDate === "string" ? body.quoteDueDate.trim() : "";
    const quoteDueDate = localDateFromDayInput(raw || null);
    if (!quoteDueDate) {
      return NextResponse.json(
        { error: "quoteDueDate is required (use YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const row = await prisma.rfpRequest.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        customerContactId: true,
        ldcUtility: true,
        energyType: true,
        customer: { select: { name: true } },
        suppliers: { select: { name: true } },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "RFP not found" }, { status: 404 });
    }

    await prisma.rfpRequest.update({
      where: { id },
      data: { quoteDueDate },
    });

    const custName = row.customer?.name ?? "Customer";
    const supplierNames = row.suppliers.map((s) => s.name).join(", ");
    const energyLabel = row.energyType === "ELECTRIC" ? "Electric" : "Natural gas";
    const updated = await prisma.calendarEvent.updateMany({
      where: {
        rfpRequestId: id,
        eventType: CalendarEventType.SUPPLIER_QUOTE_DUE_RFP,
      },
      data: {
        startAt: quoteDueDate,
        allDay: true,
        title: `Supplier quote due — RFP (${custName})`,
        description: [
          `Energy type: ${energyLabel}`,
          row.ldcUtility ? `Utility: ${row.ldcUtility}` : "",
          supplierNames ? `Suppliers: ${supplierNames}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });

    if (updated.count === 0) {
      await prisma.calendarEvent.create({
        data: {
          title: `Supplier quote due — RFP (${custName})`,
          description: [
            `Energy type: ${energyLabel}`,
            row.ldcUtility ? `Utility: ${row.ldcUtility}` : "",
            supplierNames ? `Suppliers: ${supplierNames}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          startAt: quoteDueDate,
          allDay: true,
          eventType: CalendarEventType.SUPPLIER_QUOTE_DUE_RFP,
          customerId: row.customerId,
          contactId: row.customerContactId,
          rfpRequestId: id,
        },
      });
    }

    const result = await resendStoredRfpSupplierEmails(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("RFP supplier refresh:", err);
    const message = err instanceof Error ? err.message : "Failed to refresh supplier emails";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
