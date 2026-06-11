"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { NativeSelect } from "@sah-helper/ui/components/native-select";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@sah-helper/ui/components/table";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ClientFileDrawer } from "@/components/client-file-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { usePacketDownload } from "@/lib/download";
import { formatCurrency, formatDate, type ClientStatus } from "@/lib/format";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id as Id<"clients">;
  const router = useRouter();

  const client = useQuery(api.clients.getClient, { clientId });
  const updateStatus = useMutation(api.clients.updateClientStatus);
  const deleteClient = useMutation(api.clients.deleteClient);
  const { download, downloading } = usePacketDownload(clientId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (client === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Skeleton className="mb-5 h-3.5 w-28" />
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="hidden h-8 w-44 sm:block" />
        </div>
        <div className="space-y-6">
          <div className="rounded-md border border-border bg-card p-4">
            <Skeleton className="mb-4 h-4 w-32" />
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <Skeleton className="mb-4 h-4 w-24" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (client === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <p className="mb-4 text-sm text-muted-foreground">Client not found.</p>
        <Link href="/dashboard">
          <Button variant="outline">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Clients
          </Button>
        </Link>
      </div>
    );
  }

  const handleStatusChange = async (status: ClientStatus) => {
    try {
      await updateStatus({ clientId, status });
      toast.success(`Status updated to ${status.charAt(0).toUpperCase()}${status.slice(1)}.`);
    } catch {
      toast.error("Could not update status.");
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteClient({ clientId });
      toast.success("Client deleted.");
      router.push("/dashboard");
    } catch {
      toast.error("Could not delete client.");
      setDeleting(false);
    }
  };

  const infoRows = [
    { label: "Client Name", value: client.name, mono: false },
    {
      label: "Address",
      value: `${client.street}, ${client.city}, ${client.state} ${client.zip}`,
      mono: false,
    },
    { label: "Phone", value: client.phone || "—", mono: true },
    { label: "Invoice #", value: client.invoiceNumber || "—", mono: true },
    { label: "Draw Count", value: `${client.drawCount} Draws`, mono: true },
    { label: "Contract Total", value: formatCurrency(client.total), mono: true },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mx-auto w-full max-w-3xl px-4 py-8"
    >
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to Clients
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <motion.h1
            layoutId={`client-name-${clientId}`}
            className="text-2xl font-semibold tracking-[-0.025em]"
          >
            {client.name}
          </motion.h1>
          <StatusBadge status={client.status as ClientStatus} />
        </div>
        <div className="w-full sm:w-44">
          <NativeSelect
            value={client.status}
            onChange={(e) => handleStatusChange(e.target.value as ClientStatus)}
            aria-label="Client status"
          >
            <option value="unsigned">Unsigned</option>
            <option value="signed">Signed</option>
            <option value="complete">Complete</option>
          </NativeSelect>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Client Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {infoRows.map(({ label, value, mono }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase">
                    {label}
                  </dt>
                  <dd className={`text-sm ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.lineItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">{item.description}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{item.qty}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(client.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Packet Files</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientFileDrawer clientId={clientId} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            size="lg"
            disabled={!client.packetStorageId || downloading}
            onClick={() => void download(client.packetDirty)}
            title={
              client.packetDirty
                ? "New files added — packet will be rebuilt on download."
                : undefined
            }
            className="relative"
          >
            <DownloadIcon data-icon="inline-start" />
            {downloading
              ? client.packetDirty
                ? "Rebuilding packet..."
                : "Downloading..."
              : "Download Packet.pdf"}
            {client.packetDirty && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
            )}
          </Button>
          <div className="text-xs text-muted-foreground">
            Created {formatDate(client.createdAt)} · Updated {formatDate(client.updatedAt)}
          </div>
        </div>

        <Card className="border border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Permanently delete this client and their generated packet.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              <Trash2Icon data-icon="inline-start" />
              Delete Client
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this client?"
        description="This will permanently delete this client and their packet. This cannot be undone."
        confirmLabel="Delete Client"
        confirming={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </motion.div>
  );
}
